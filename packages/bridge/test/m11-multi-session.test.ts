import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { createBridgeServer } from "../src/core/server";
import { BridgeStore } from "../src/core/store";
import type { AdapterPort } from "../src/core/domain";
import { hashCredential } from "../src/auth/credentials";

const installationCredential = (installationId: string) => `pc_test_${installationId}`;
const INSTALLATION_A = "11111111-1111-4111-8111-111111111111";
const INSTALLATION_B = "22222222-2222-4222-8222-222222222222";
const INSTALLATION_C = "33333333-3333-4333-8333-333333333333";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SESSION_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const servers: Array<ReturnType<typeof createBridgeServer>> = [];
const stores: BridgeStore[] = [];

function startRuntime(now = Date.now()): { store: BridgeStore; server: ReturnType<typeof createBridgeServer> } {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-m11-")), "bridge.sqlite");
  const store = new BridgeStore(path, () => now);
  const adapter: AdapterPort = { async dispatch() {} };
  for (const installationId of [INSTALLATION_A, INSTALLATION_B, INSTALLATION_C]) {
    store.upsertInstallationCredential({ installationId, credentialHash: hashCredential(installationCredential(installationId)), enrollmentSecretHash: hashCredential(`enrollment_${installationId}`, "enrollment"), enrollmentSource: "seed", createdAt: Date.now(), lastSeenAt: Date.now() });
  }
  const runtime = new DurableBridgeRuntime({
    store, adapter, bridgeVersion: "fixture", piVersion: "0.82.0", hostDisplayName: "fixture",
  });
  runtime.setReadyForTest(true);
  const server = createBridgeServer({ runtime, port: 0 });
  stores.push(store);
  servers.push(server);
  return { store, server };
}

interface Client { readonly ws: WebSocket; readonly inbox: Record<string, unknown>[]; readonly waiters: Array<(value: Record<string, unknown>) => void>; helloAccepted: Record<string, unknown>; }
function makeClient(server: ReturnType<typeof createBridgeServer>, installationId: string): Promise<{ client: Client; connectionId: string }> {
  return new Promise((resolve, reject) => {
    const inbox: Record<string, unknown>[] = [];
    const waiters: Array<(value: Record<string, unknown>) => void> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/ws`, { perMessageDeflate: false });
    const client: Client = {
      ws, inbox, waiters, helloAccepted: {},
    };
    ws.onmessage = (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(value); else inbox.push(value);
    };
    ws.onerror = () => reject(new Error("websocket connection failed"));
    ws.onopen = () => {
      ws.send(JSON.stringify(envelope("hello", {
        mobileVersion: "1", platform: "ios", installationId,
        installationCredential: installationCredential(installationId),
        requiredCapabilities: ["streams.v1", "commands.v1", "controller_leases.v1"],
        optionalCapabilities: [],
      })));
      const next = (): void => {
        const value = inbox.shift();
        if (value && value.type === "hello.accepted") {
          client.helloAccepted = value.payload as Record<string, unknown>;
          resolve({ client, connectionId: client.helloAccepted.connectionId as string });
        }
        else if (value) { next(); return; }
        else waiters.push((v) => {
          if (v.type === "hello.accepted") {
            client.helloAccepted = v.payload as Record<string, unknown>;
            resolve({ client, connectionId: client.helloAccepted.connectionId as string });
          }
          else inbox.push(v);
        });
      };
      next();
    };
  });
}
function envelope(type: string, payload: Record<string, unknown>, connectionId?: string): Record<string, unknown> {
  return {
    protocol: { major: 1, minor: 0 },
    messageId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    ...(connectionId ? { connectionId } : {}),
    type, sentAt: new Date().toISOString(), payload,
  };
}
function send(client: Client, value: Record<string, unknown>): void { client.ws.send(JSON.stringify(value)); }
function next(client: Client): Promise<Record<string, unknown>> {
  if (client.inbox.length > 0) return Promise.resolve(client.inbox.shift()!);
  return new Promise((resolve) => client.waiters.push(resolve));
}
async function collect(client: Client, predicate: (value: Record<string, unknown>) => boolean, max = 200): Promise<Record<string, unknown>> {
  for (let i = 0; i < max; i += 1) {
    const value = await next(client);
    if (predicate(value)) return value;
  }
  throw new Error("timed out waiting for matching message");
}
async function page(client: Client, connectionId: string, input: { filter?: string; query?: string; sort?: string; pageSize: number; pageToken?: string | null }): Promise<Record<string, unknown>> {
  send(client, envelope("session.list", {
    filter: input.filter ?? "all",
    query: input.query ?? null,
    sort: input.sort ?? "activity",
    pageSize: input.pageSize,
    pageToken: input.pageToken ?? null,
  }, connectionId));
  return next(client);
}
function items(result: Record<string, unknown>): Array<Record<string, unknown>> { return (result.payload as Record<string, unknown>).items as Array<Record<string, unknown>>; }
function snapshotRevision(result: Record<string, unknown>): string { return (result.payload as Record<string, unknown>).snapshotRevision as string; }
function nextPageToken(result: Record<string, unknown>): string | undefined { return (result.payload as Record<string, unknown>).nextPageToken as string | undefined; }
async function subscribe(client: Client, connectionId: string, streams: Array<{ streamId: string; detail: "full" | "summary" }>): Promise<void> {
  send(client, envelope("subscription.set", { streams }, connectionId));
  await collect(client, (v) => v.type === "subscription.accepted" || v.type === "error");
}
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const store of stores.splice(0)) store.close();
});

describe("M11 host summary add/change/remove correctness", () => {
  test("add emits a session.summary event, change emits with changedKeys, remove emits session.removed", () => {
    const { store } = startRuntime();
    const added = store.addSessionSummary(SESSION_A, { name: "alpha", runtimeState: "idle" });
    expect(added.added).toBe(true);
    expect(added.event.type).toBe("session.summary");
    expect(added.event.payload).toMatchObject({ sessionId: SESSION_A, name: "alpha" });
    const hostStream = `host:${store.identity().hostId}`;
    const replayed = store.listEvents(hostStream, "0", added.event.cursor);
    expect(replayed.find((e) => e.type === "session.summary")).toBeDefined();

    const changed = store.changeSessionSummary(SESSION_A, { attentionState: "needs_attention", queueCount: 2 });
    expect(changed.event.type).toBe("session.summary");
    expect(changed.event.payload).toMatchObject({ sessionId: SESSION_A, attentionState: "needs_attention", queueCount: 2 });
    expect((changed.event.payload.changedKeys as string[]).sort()).toEqual(["attentionState", "queueCount"]);

    const removed = store.removeSessionSummary(SESSION_A);
    expect(removed).not.toBeNull();
    expect(removed!.event.type).toBe("session.removed");
    expect(removed!.event.payload).toMatchObject({ sessionId: SESSION_A });
    expect(store.sessionExists(SESSION_A)).toBe(false);
    // Idempotent: second remove returns null.
    expect(store.removeSessionSummary(SESSION_A)).toBeNull();
  });

  test("add is idempotent and re-add after remove restores the directory entry", () => {
    const { store } = startRuntime();
    const first = store.addSessionSummary(SESSION_B, { name: "beta" });
    expect(first.added).toBe(true);
    const second = store.addSessionSummary(SESSION_B, { name: "beta" });
    expect(second.added).toBe(false);
    store.removeSessionSummary(SESSION_B);
    const restored = store.addSessionSummary(SESSION_B, { name: "beta-2" });
    expect(restored.added).toBe(true);
    expect(restored.event.payload).toMatchObject({ name: "beta-2", sessionId: SESSION_B });
  });
});

describe("M11 paginated session.list with opaque revision-bound token", () => {
  test("pages 8 sessions across three pages newest-first with stable order", async () => {
    const { store, server } = startRuntime();
    const ids = [SESSION_A, SESSION_B, SESSION_C, SESSION_D, SESSION_E, "f0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000002", "f0000000-0000-4000-8000-000000000003"];
    ids.forEach((id, index) => {
      store.addSessionSummary(id, { name: id.slice(0, 4), lastActivityAt: index + 1 });
    });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);

    const first = await page(client, connectionId, { pageSize: 3, sort: "activity" });
    expect(items(first).map((i) => i.sessionId)).toEqual(["f0000000-0000-4000-8000-000000000003", "f0000000-0000-4000-8000-000000000002", "f0000000-0000-4000-8000-000000000001"]);
    const firstToken = nextPageToken(first);
    expect(firstToken).toBeDefined();
    expect(firstToken!.length).toBeGreaterThan(20);

    const second = await page(client, connectionId, { pageSize: 3, sort: "activity", pageToken: firstToken! });
    expect(items(second).map((i) => i.sessionId)).toEqual([SESSION_E, SESSION_D, SESSION_C]);
    const third = await page(client, connectionId, { pageSize: 3, sort: "activity", pageToken: nextPageToken(second)! });
    expect(items(third).map((i) => i.sessionId)).toEqual([SESSION_B, SESSION_A]);
    expect(nextPageToken(third)).toBeUndefined();
    expect(snapshotRevision(first)).toBe(snapshotRevision(second));
    expect(snapshotRevision(first)).toBe(snapshotRevision(third));
    client.ws.close();
  });

  test("filter=needs_attention returns only the matching attention states", async () => {
    const { store, server } = startRuntime();
    store.addSessionSummary(SESSION_A, { name: "alpha", attentionState: "ready" });
    store.addSessionSummary(SESSION_B, { name: "beta", attentionState: "needs_attention" });
    store.addSessionSummary(SESSION_C, { name: "gamma", attentionState: "needs_attention" });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    const result = await page(client, connectionId, { filter: "needs_attention", pageSize: 50 });
    const ids = items(result).map((i) => i.sessionId).sort();
    expect(ids).toEqual([SESSION_B, SESSION_C].sort());
    client.ws.close();
  });

  test("hides inactive sessions older than seven days while retaining active and durable state", async () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    const { store, server } = startRuntime(now);
    const stale = now - (8 * 24 * 60 * 60 * 1000);
    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    store.addSessionSummary(SESSION_A, { name: "stale", runtimeState: "stopped", lastActivityAt: new Date(stale).toISOString() });
    store.addSessionSummary(SESSION_B, { name: "active", runtimeState: "running", lastActivityAt: new Date(stale).toISOString() });
    store.addSessionSummary(SESSION_C, { name: "boundary", runtimeState: "stopped", lastActivityAt: new Date(cutoff).toISOString() });
    store.addSessionSummary(SESSION_D, { name: "attention", runtimeState: "stopped", attentionState: "needs_attention", lastActivityAt: new Date(stale).toISOString() });
    store.addSessionSummary(SESSION_E, { name: "queued", runtimeState: "stopped", queueCount: 1, lastActivityAt: new Date(stale).toISOString() });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    expect(client.helloAccepted.sessionVisibilityCutoff).toBe(new Date(cutoff).toISOString());

    const result = await page(client, connectionId, { pageSize: 50 });
    expect(items(result).map((item) => item.sessionId).sort()).toEqual([SESSION_B, SESSION_C, SESSION_D, SESSION_E].sort());
    expect(store.sessionExists(SESSION_A)).toBe(true);
    expect(store.sessionState(SESSION_A)?.name).toBe("stale");

    send(client, envelope("subscription.set", {
      streams: [{ streamId: `host:${store.identity().hostId}`, detail: "full" }],
    }, connectionId));
    const messages: Record<string, unknown>[] = [];
    while (true) {
      const message = await next(client);
      if (message.type === "stream.sync.complete") break;
      messages.push(message);
    }
    const wire = JSON.stringify(messages);
    expect(wire.includes(SESSION_A)).toBe(false);
    expect(wire.includes(SESSION_B)).toBe(true);
    expect(wire.includes(SESSION_C)).toBe(true);
    store.changeSessionSummary(SESSION_A, { name: "still stale" });
    store.changeSessionSummary(SESSION_B, { name: "active again" });
    const firstLive = await next(client);
    const secondLive = await next(client);
    expect(firstLive.type).toBe("host.state");
    expect(JSON.stringify(firstLive)).not.toContain(SESSION_A);
    expect(secondLive.type).toBe("session.summary");
    expect((secondLive.payload as Record<string, unknown>).sessionId).toBe(SESSION_B);
    client.ws.close();
  });

  test("query substring search is case-insensitive across display name and sessionId", async () => {
    const { store, server } = startRuntime();
    store.addSessionSummary(SESSION_A, { name: "Daily driver" });
    store.addSessionSummary(SESSION_B, { name: "Refactor agent" });
    store.addSessionSummary(SESSION_C, { name: "Code review" });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    const code = await page(client, connectionId, { query: "code", pageSize: 50 });
    expect(items(code).map((i) => i.name)).toEqual(["Code review"]);
    const refactor = await page(client, connectionId, { query: "REFAC", pageSize: 50 });
    expect(items(refactor).map((i) => i.name)).toEqual(["Refactor agent"]);
    client.ws.close();
  });

  test("sort by queueCount desc and by name asc work as advertised", async () => {
    const { store, server } = startRuntime();
    store.addSessionSummary(SESSION_A, { name: "alpha", queueCount: 0 });
    store.addSessionSummary(SESSION_B, { name: "bravo", queueCount: 5 });
    store.addSessionSummary(SESSION_C, { name: "charlie", queueCount: 2 });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    const byQueue = await page(client, connectionId, { sort: "queue", pageSize: 50 });
    expect(items(byQueue).map((i) => i.sessionId)).toEqual([SESSION_B, SESSION_C, SESSION_A]);
    const byName = await page(client, connectionId, { sort: "name", pageSize: 50 });
    expect(items(byName).map((i) => i.name)).toEqual(["alpha", "bravo", "charlie"]);
    client.ws.close();
  });

  test("page token tampering, host-generation change, and bound-query mismatch are rejected", async () => {
    const { store, server } = startRuntime();
    for (const id of [SESSION_A, SESSION_B, SESSION_C, SESSION_D]) store.addSessionSummary(id, { name: id });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    const first = await page(client, connectionId, { pageSize: 2 });
    const token = nextPageToken(first)!;
    const tampered = await page(client, connectionId, { pageSize: 2, pageToken: `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}` });
    expect(tampered.type).toBe("error");
    expect((tampered.payload as Record<string, unknown>).code).toBe("invalid_message");

    // Bump host generation (simulates restore / install migration).
    store.incrementHostGeneration();
    const afterBump = await page(client, connectionId, { pageSize: 2, pageToken: token });
    expect(afterBump.type).toBe("error");
    expect((afterBump.payload as Record<string, unknown>).code).toBe("invalid_message");

    // Sort mismatch must be rejected even when host generation matches.
    const wrong = await page(client, connectionId, { pageSize: 2, sort: "queue", pageToken: token });
    expect(wrong.type).toBe("error");
    expect((wrong.payload as Record<string, unknown>).code).toBe("invalid_message");
    client.ws.close();
  });
});

describe("M11 subscription enforcement: one full + <=5 summary", () => {
  test("accepts one full session plus five summary subscriptions, rejects a second full", async () => {
    const { store, server } = startRuntime();
    store.addSessionSummary(SESSION_A, { name: "alpha" });
    store.addSessionSummary(SESSION_B, { name: "bravo" });
    store.addSessionSummary(SESSION_C, { name: "charlie" });
    store.addSessionSummary(SESSION_D, { name: "delta" });
    store.addSessionSummary(SESSION_E, { name: "echo" });
    const { client, connectionId } = await makeClient(server, INSTALLATION_A);
    const hostStream = `host:${store.identity().hostId}`;
    await subscribe(client, connectionId, [
      { streamId: hostStream, detail: "summary" },
      { streamId: `session:${SESSION_A}`, detail: "full" },
      { streamId: `session:${SESSION_B}`, detail: "summary" },
      { streamId: `session:${SESSION_C}`, detail: "summary" },
      { streamId: `session:${SESSION_D}`, detail: "summary" },
      { streamId: `session:${SESSION_E}`, detail: "summary" },
    ]);
    // Now try a second full subscription; the server should reject it.
    send(client, envelope("subscription.set", { streams: [
      { streamId: hostStream, detail: "summary" },
      { streamId: `session:${SESSION_A}`, detail: "full" },
      { streamId: `session:${SESSION_B}`, detail: "full" }, // second full
    ] }, connectionId));
    const error = await collect(client, (value) => value.type === "error");
    expect(error.type).toBe("error");
    expect((error.payload as Record<string, unknown>).code).toBe("invalid_state");
    client.ws.close();
  });
});

describe("M11 multi-client lease uniqueness, race, and explicit takeover", () => {
  test("two clients racing acquire: only one becomes controller, the other is rejected", () => {
    const { store } = startRuntime();
    const errors: string[] = [];
    let winners = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const scope = `session:00000000-0000-4000-8000-${attempt.toString(16).padStart(12, "0")}`;
      const installationA = `${attempt}-${INSTALLATION_A}`;
      const installationB = `${attempt}-${INSTALLATION_B}`;
      try {
        store.acquireLease(scope, installationA, "connA");
        winners += 1;
        try { store.acquireLease(scope, installationB, "connB"); winners += 1; throw new Error("expected conflict"); }
        catch (error) { if (!(error instanceof Error) || !/already active/i.test(error.message)) throw error; }
      } catch (error) { errors.push((error as Error).message); }
    }
    expect(winners).toBe(20);
    expect(errors).toEqual([]);
  });

  test("explicit takeover revokes the previous controller and binds to the new client", () => {
    const { store } = startRuntime();
    const original = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA");
    const takeover = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_B, "connB", store.now(), true);
    expect(takeover.leaseId).not.toBe(original.leaseId);
    expect(takeover.installationId).toBe(INSTALLATION_B);
    expect(store.leaseById(original.leaseId)?.revokedAt).not.toBeNull();
    // The previous controller can no longer renew.
    expect(() => store.renewLease(`session:${SESSION_A}`, original.leaseId, "connA")).toThrow();
  });

  test("expired lease is reclaimable by the same installation without explicit takeover", () => {
    const { store } = startRuntime();
    const start = store.now();
    const original = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA", start);
    // Step forward past expiry (45s lease).
    const reclaim = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA2", start + 46_000);
    expect(reclaim.leaseId).not.toBe(original.leaseId);
    expect(store.leaseById(original.leaseId)?.takeoverReason).toBe("expired");
  });

  test("stale connection: renew after expiry throws; takeover from new connection is allowed", () => {
    const { store } = startRuntime();
    const start = store.now();
    const lease = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA", start);
    // Renew after expiry (45s).
    expect(() => store.renewLease(`session:${SESSION_A}`, lease.leaseId, "connA", start + 50_000)).toThrow();
    const fresh = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_B, "connB", start + 50_000, true);
    expect(fresh.leaseId).not.toBe(lease.leaseId);
  });

  test("release from a non-owner is rejected; release from the owner is durable", () => {
    const { store } = startRuntime();
    const lease = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA");
    expect(() => store.releaseLease(`session:${SESSION_A}`, lease.leaseId, INSTALLATION_B, "connB")).toThrow();
    // After release, the scope is unowned.
    store.releaseLease(`session:${SESSION_A}`, lease.leaseId, INSTALLATION_A, "connA");
    expect(store.lease(`session:${SESSION_A}`)).toBeNull();
    const next = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_B, "connB");
    expect(next.leaseId).not.toBe(lease.leaseId);
  });

  test("disconnect marks the lease reclaimable for 60s; same installation can reclaim during that window", () => {
    const { store } = startRuntime();
    const start = store.now();
    const lease = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA", start);
    store.disconnectConnection("connA", start + 5_000);
    // Same installation reconnects with a new connection id and reclaims
    // without needing an explicit takeover.
    const reclaim = store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA-new", start + 30_000);
    expect(reclaim.leaseId).not.toBe(lease.leaseId);
    expect(store.leaseById(lease.leaseId)?.takeoverReason).toBe("same_installation_reclaim");
  });

  test("lease uniqueness is enforced at the SQL boundary (UNIQUE partial index)", () => {
    const { store } = startRuntime();
    const path = (store as unknown as { path: string }).path;
    // Bypass the public API and try to insert a second active lease for the
    // same scope. The UNIQUE INDEX controller_leases_one_active_scope must
    // reject the duplicate at the database boundary.
    store.acquireLease(`session:${SESSION_A}`, INSTALLATION_A, "connA");
    const db = (store as unknown as { db: { query: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
    expect(() => db.query("INSERT INTO controller_leases(lease_id,scope_key,installation_id,connection_id,acquired_at,renewed_at,expires_at,reclaimable_until,disconnected_at,takeover_reason,revoked_at,updated_at) VALUES('dup',?,?,?,?,?,?,NULL,NULL,NULL,NULL,?)").run(`session:${SESSION_A}`, INSTALLATION_B, "connB", store.now(), store.now(), store.now() + 45_000, store.now())).toThrow();
    expect(path).toBeTruthy();
  });

  test("stress: 20 concurrent acquisition attempts across 5 clients on 4 scopes produce one controller per scope", async () => {
    const { store } = startRuntime();
    const scopes = [`session:${SESSION_A}`, `session:${SESSION_B}`, `session:${SESSION_C}`, `session:${SESSION_D}`];
    const installations = [INSTALLATION_A, INSTALLATION_B, INSTALLATION_C, "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
    const attempts: Array<{ scope: string; installation: string; connection: string }> = [];
    for (let i = 0; i < 20; i += 1) {
      const scope = scopes[i % scopes.length]!;
      const installation = installations[i % installations.length]!;
      const connection = `conn-${i}`;
      attempts.push({ scope, installation, connection });
    }
    const results = await Promise.all(attempts.map(async ({ scope, installation, connection }) => {
      try { return { scope, installation, connection, ok: true, leaseId: store.acquireLease(scope, installation, connection).leaseId }; }
      catch (error) { return { scope, installation, connection, ok: false, error: (error as Error).message }; }
    }));
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    // At least one winner per scope.
    const scopesWithWinner = new Set(winners.map((r) => r.scope));
    expect(scopesWithWinner.size).toBe(scopes.length);
    // Every loser reported a conflict.
    for (const loser of losers) expect(loser.error).toMatch(/already active/);
    // Exactly one active lease per scope.
    for (const scope of scopes) {
      const history = store.leaseHistory(scope);
      const active = history.filter((lease) => lease.revokedAt === null);
      expect(active).toHaveLength(1);
    }
  });
});
