import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RpcProcess } from "../../src/pi/rpc-process";
import { resolvePiLaunchConfig } from "../../src/pi/launch-config";
import { OneSessionPiAdapter, type PiRpcClient, type PiRpcRequestOptions } from "../../src/pi/one-session-adapter";
import { BridgeStore } from "../../src/core/store";

/**
 * Shared harness for the integration tests under `test/integration/`.
 *
 * The spec demands that parity be demonstrated **empirically** by
 * exercising a real Pi subprocess. Each test in this directory spawns
 * the locally installed Pi 0.82.0 binary in `--mode rpc` mode and
 * drives it through the same wire protocol that `RpcProcess` consumes.
 *
 * Three entry points are provided:
 *
 *   - `spawnDirectPi` — raw `Bun.spawn` of Pi; the "owner-like"
 *     reference path used in the parity tests.
 *   - `spawnBridgePi` — the bridge's own `RpcProcess` over the same
 *     Pi binary; the "bridge-managed Pi" path used in the parity
 *     tests.
 *   - `spawnBridgeAdapter` — a `OneSessionPiAdapter` wired to a
 *     `FakeRpcClient`; used by raw RPC dispatcher tests that
 *     exercise the bridge's own dispatcher without a real Pi.
 *
 * All three return a {@link PiHandle} with the same surface so tests
 * can compare without conditional code.
 */

const fs = createRequire(import.meta.url)("node:fs") as {
  existsSync(p: string): boolean;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
};

const PINNED_PI = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/pi");

function resolvePinnedPi(): string | null {
  return fs.existsSync(PINNED_PI) ? PINNED_PI : null;
}

export const PI_EXECUTABLE = process.env.PI_MOB_PI_RPC_BIN
  ?? resolvePinnedPi()
  ?? Bun.which("pi")
  ?? "";

export class PiBinaryMissingError extends Error {
  override readonly name = "PiBinaryMissingError";
  constructor(path: string) {
    super(`Pi binary not found at ${path}. Set PI_MOB_PI_RPC_BIN to override.`);
  }
}

export function requirePiBinary(): string {
  if (!PI_EXECUTABLE || !fs.existsSync(PI_EXECUTABLE)) {
    throw new PiBinaryMissingError(PI_EXECUTABLE);
  }
  return PI_EXECUTABLE;
}

export function createWorkspace(prefix = "pi-mob-integration-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function createSessionDir(workspace: string): string {
  const dir = join(workspace, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const DIRECT_PI_STDERR_LIMIT = 8_192;

function redactDiagnostic(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+|Bearer\s+\S+/g, "redacted")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "redacted")
    .replace(/\/(?:Users|home|private|tmp|var\/folders)\/[^\s"'<>`]+/g, "<path>");
}

function summarizeStderr(value: string): string {
  const redacted = redactDiagnostic(value.replace(/\r\n/g, "\n").trim());
  if (!redacted) return "no stderr";
  return redacted.replace(/\s+/g, " ").slice(-1_000);
}

function formatExitDiagnostic(exitCode: number | null, signal: string | null, stderrText: string): string {
  const status = exitCode !== null
    ? `exit code ${exitCode}`
    : signal !== null
      ? `signal ${signal}`
      : "unknown exit status";
  return `Pi subprocess exited (${status}): ${summarizeStderr(stderrText)}`;
}

export interface PiResponse {
  readonly data: unknown;
  readonly success: boolean;
  readonly error: string | null;
  readonly command: string;
}

export interface PiHandle {
  readonly pid: number | undefined;
  readonly bridgeEvents: ReadonlyArray<unknown>;
  request(id: string, method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<PiResponse>;
  close(): Promise<void>;
}

interface DirectPiHandle extends PiHandle {
  readonly bridgeEvents: unknown[];
}

export async function spawnDirectPi(opts: {
  cwd: string;
  env: Record<string, string>;
  args?: readonly string[];
  timeoutMs?: number;
}): Promise<DirectPiHandle> {
  const executable = requirePiBinary();
  const sessionDir = createSessionDir(opts.cwd);
  const args = [
    "--mode", "rpc",
    "--session-dir", sessionDir,
    ...(opts.args ?? []),
  ];
  const proc = Bun.spawn({
    cmd: [executable, ...args],
    env: opts.env,
    cwd: opts.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const { JsonlDecoder } = await import("../../src/pi/jsonl");
  const decoder = new JsonlDecoder();
  const events: unknown[] = [];
  const pending = new Map<string, {
    resolve: (value: PiResponse) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }>();
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  const textDecoder = new TextDecoder("utf-8", { fatal: false });
  let stderrText = "";

  const rejectPending = (reason: Error): void => {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(reason);
    }
    pending.clear();
  };

  const stdoutDone = (async () => {
    try {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        for (const rec of decoder.push(value)) {
          const record = rec.value as Record<string, unknown>;
          if (record.type === "response" && typeof record.id === "string" && pending.has(record.id)) {
            const waiter = pending.get(record.id)!;
            pending.delete(record.id);
            if (waiter.timer) clearTimeout(waiter.timer);
            const success = record.success === true;
            waiter.resolve({
              success,
              data: success ? record.data : null,
              error: success ? null : (typeof record.error === "string" ? record.error : "unknown"),
              command: typeof record.command === "string" ? record.command : "",
            });
          } else {
            events.push(record);
          }
        }
      }
    } catch {
      // A stream failure is handled by the exit path.
    } finally {
      stdoutReader.releaseLock();
    }
  })().catch(() => undefined);

  const stderrDone = (async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        stderrText = (stderrText + textDecoder.decode(value, { stream: true })).slice(-DIRECT_PI_STDERR_LIMIT);
      }
      stderrText = (stderrText + textDecoder.decode()).slice(-DIRECT_PI_STDERR_LIMIT);
    } catch {
      // stderr is best-effort diagnostics only.
    } finally {
      stderrReader.releaseLock();
    }
  })().catch(() => undefined);

  const exitWatcher = proc.exited
    .then(async (code) => {
      await Promise.allSettled([stdoutDone, stderrDone]);
      if (pending.size > 0) {
        const signal = typeof proc.signalCode === "string" ? proc.signalCode : null;
        rejectPending(new Error(formatExitDiagnostic(code, signal, stderrText)));
      }
    })
    .catch(async () => {
      await Promise.allSettled([stdoutDone, stderrDone]);
      if (pending.size > 0) {
        const signal = typeof proc.signalCode === "string" ? proc.signalCode : null;
        rejectPending(new Error(formatExitDiagnostic(proc.exitCode, signal, stderrText)));
      }
    });

  return {
    pid: proc.pid,
    bridgeEvents: events,
    async request(id: string, method: string, params?: Record<string, unknown>, timeoutMs?: number) {
      const timeout = timeoutMs ?? opts.timeoutMs ?? 20_000;
      if (proc.exitCode !== null) {
        throw new Error(formatExitDiagnostic(proc.exitCode, typeof proc.signalCode === "string" ? proc.signalCode : null, stderrText));
      }
      return new Promise<PiResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`request ${id} (${method}) timed out after ${timeout}ms`));
        }, timeout);
        if (typeof (timer as { unref?: () => void }).unref === "function") {
          (timer as { unref: () => void }).unref();
        }
        pending.set(id, { resolve, reject, timer });
        const payload: Record<string, unknown> = { id, type: method };
        if (params) Object.assign(payload, params);
        const line = JSON.stringify(payload) + "\n";
        try {
          const result = proc.stdin.write(new TextEncoder().encode(line));
          if (result instanceof Promise) {
            result.catch((err) => {
              if (pending.has(id)) {
                pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            });
          }
        } catch (err) {
          if (pending.has(id)) {
            pending.delete(id);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });
    },
    async close() {
      try { await proc.stdin.end(); } catch { /* pipe may already be closed */ }
      try { proc.kill("SIGTERM"); } catch { /* already exited */ }
      try {
        await Promise.race([
          exitWatcher,
          new Promise<void>((r) => setTimeout(r, 1_000)),
        ]);
      } catch { /* ignore */ }
      try { if (proc.exitCode === null) proc.kill("SIGKILL"); } catch { /* ignore */ }
      await Promise.allSettled([exitWatcher, stdoutDone, stderrDone]);
    },
  };
}

interface BridgePiHandle extends PiHandle {
  readonly inner: RpcProcess;
}

export async function spawnBridgePi(opts: {
  cwd: string;
  env: Record<string, string>;
  args?: readonly string[];
  timeoutMs?: number;
}): Promise<BridgePiHandle> {
  const executable = requirePiBinary();
  const sessionDir = createSessionDir(opts.cwd);
  const args = [
    "--mode", "rpc",
    "--session-dir", sessionDir,
    ...(opts.args ?? []),
  ];
  const rpc = new RpcProcess({
    launchConfig: resolvePiLaunchConfig({
      executable,
      cwd: opts.cwd,
      args,
      env: opts.env,
    }),
    defaultRequestTimeoutMs: opts.timeoutMs ?? 20_000,
    closeGracePeriodMs: 1_000,
  });
  const events: unknown[] = [];
  rpc.on("notification", (value) => { events.push(value); });
  await rpc.start();

  return {
    pid: rpc.pid,
    bridgeEvents: events,
    inner: rpc,
    async request(id: string, method: string, params?: Record<string, unknown>, timeoutMs?: number) {
      const hasParams = params !== undefined && Object.keys(params).length > 0;
      try {
        const result = await rpc.request({
          id,
          method,
          ...(hasParams ? { params } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        return {
          success: true,
          data: result,
          error: null,
          command: method,
        };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
          command: method,
        };
      }
    },
    async close() {
      await rpc.close();
    },
  };
}

export interface RecordedRpcRequest {
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface FakeRpcResponse {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface FakeRpcClientOptions {
  /** How the fake responds to each request. */
  readonly responder?: (req: RecordedRpcRequest) => FakeRpcResponse | Promise<FakeRpcResponse>;
  /** Optional upstream "events" the fake will emit after start. */
  readonly initialEvents?: ReadonlyArray<unknown>;
}

/**
 * A `PiRpcClient` that records every `request()` call and returns a
 * deterministic response. Used by the adapter-bound tests so we can
 * assert on the *bridge's* handling of the request without depending
 * on a real Pi subprocess.
 */
export class FakeRpcClient implements PiRpcClient {
  readonly requests: RecordedRpcRequest[] = [];
  readonly notifications: unknown[] = [];
  private readonly handlers = new Set<(value: unknown) => void>();
  private readonly responder: FakeRpcClientOptions["responder"];
  private readonly initialEvents: ReadonlyArray<unknown>;
  private lifecycle = "stopped";

  constructor(options: FakeRpcClientOptions = {}) {
    this.responder = options.responder;
    this.initialEvents = options.initialEvents ?? [];
  }

  async start(): Promise<void> {
    this.lifecycle = "idle";
    for (const event of this.initialEvents) this.emit(event);
  }

  async request(options: PiRpcRequestOptions): Promise<unknown> {
    this.requests.push({
      id: options.id ?? "<missing>",
      method: options.method,
      params: (options.params ?? {}) as Record<string, unknown>,
    });
    const response = this.responder
      ? await this.responder(this.requests[this.requests.length - 1]!)
      : { success: true, data: { echoed: options.method } };
    if (response.success) return { success: true, command: options.method, data: response.data };
    return { success: false, command: options.method, error: response.error ?? "unknown" };
  }

  on(kind: "notification", handler: (value: unknown) => void): () => void {
    if (kind !== "notification") return () => undefined;
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  lifecycleState(): string { return this.lifecycle; }
  markDispatchStart(): void { this.lifecycle = "running"; }
  async manualRetry(): Promise<void> { this.lifecycle = "idle"; }
  isDraining(): boolean { return false; }

  emit(event: unknown): void {
    this.notifications.push(event);
    for (const handler of this.handlers) handler(event);
  }
}

export interface AdapterHandle {
  readonly adapter: OneSessionPiAdapter;
  readonly store: BridgeStore;
  readonly fake: FakeRpcClient;
  close(): Promise<void>;
}

export async function spawnBridgeAdapter(opts: {
  workspace: string;
  responder?: FakeRpcClientOptions["responder"];
  initialEvents?: ReadonlyArray<unknown>;
}): Promise<AdapterHandle> {
  const stateDir = createSessionDir(opts.workspace);
  const store = new BridgeStore(join(stateDir, "bridge.sqlite"));
  const fake = new FakeRpcClient({
    ...(opts.responder ? { responder: opts.responder } : {}),
    initialEvents: opts.initialEvents ?? [],
  });
  const adapter = new OneSessionPiAdapter({
    store,
    rpc: fake,
    workspace: {
      workspaceId: "ws-integration",
      rootPath: opts.workspace,
      displayName: "integration",
      fingerprint: "integration-fingerprint",
      policyMode: "full",
    },
  });
  return {
    adapter,
    store,
    fake,
    async close() {
      adapter.close();
      store.close();
    },
  };
}

/**
 * Normalize a Pi response for parity comparison. Strips unstable
 * fields (paths, timestamps, session IDs, message counts, PIDs) so
 * two seemingly identical responses can be compared structurally.
 */
export function normalizeForParity(value: unknown): unknown {
  const strip = (input: unknown, depth = 0): unknown => {
    if (depth > 12) return "[depth-limited]";
    if (input === null || input === undefined) return null;
    if (typeof input === "string") {
      return input
        .replace(/\/Users\/[^/\s"]+\/[^"\s]*/g, "<path>")
        .replace(/\/tmp\/[^"\s]*/g, "<tmp-path>")
        .replace(/\/var\/folders\/[^"\s]*/g, "<mac-tmp>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<iso-time>")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
    }
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (Array.isArray(input)) return input.map((item) => strip(item, depth + 1));
    if (typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        if (key === "sessionFile" || key === "sessionId" || key === "createdAt"
            || key === "lastActivityAt" || key === "pid") continue;
        if (key === "messageCount" || key === "pendingMessageCount" || key === "pendingCount") continue;
        out[key] = strip(val, depth + 1);
      }
      return out;
    }
    return null;
  };
  return strip(value);
}

/**
 * Returns `null` on semantic equivalence, or a human-readable diff
 * path on divergence. Two values are equivalent when they have the
 * same shape and the same primitive values at the same keys.
 */
export function semanticDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: type mismatch (${typeof a} vs ${typeof b})`;
  if (a === null || b === null) return `${path}: null vs ${JSON.stringify(b)}`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "boolean") {
    return `${path}: value mismatch (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return `${path}: array vs non-array`;
    if (a.length !== b.length) return `${path}: array length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const diff = semanticDiff(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keysA = Object.keys(ao).sort();
    const keysB = Object.keys(bo).sort();
    if (keysA.join(",") !== keysB.join(",")) {
      return `${path}: key set differs (${keysA.join(",")} vs ${keysB.join(",")})`;
    }
    for (const key of keysA) {
      const diff = semanticDiff(ao[key], bo[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return `${path}: structural mismatch (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
}

export default {
  PI_EXECUTABLE,
  requirePiBinary,
  createWorkspace,
  createSessionDir,
  spawnDirectPi,
  spawnBridgePi,
  spawnBridgeAdapter,
  FakeRpcClient,
  normalizeForParity,
  semanticDiff,
};
