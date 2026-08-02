import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore, BridgeStore, ExportRegistry, OneSessionPiAdapter, createBinaryHttpHandler, type PiRpcClient, type PiRpcRequestOptions } from "../src";

class ExportRpc implements PiRpcClient {
  requests: PiRpcRequestOptions[] = [];
  async request(request: PiRpcRequestOptions): Promise<unknown> {
    this.requests.push(request);
    if (request.method === "export_html") {
      const path = (request.params as Record<string, unknown>).outputPath as string;
      const content = Buffer.from("<!doctype html><title>Private export</title>");
      writeFileSync(path, content, { mode: 0o600 });
      return { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
    }
    return {};
  }
  on(_kind: "notification", _handler: (raw: unknown) => void): () => void { return () => undefined; }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-mob-export-"));
  const store = new BridgeStore(join(root, "bridge.sqlite"));
  const host = `host:${store.identity().hostId}`;
  const sessionId = "11111111-1111-4111-8111-111111111111";
  store.ensureStream(host, "host");
  store.ensureSession(sessionId, { sessionId, runtimeState: "idle", attentionState: "ready" });
  store.ensureStream(`session:${sessionId}`, "session", sessionId);
  const rpc = new ExportRpc();
  const registry = new ExportRegistry({ rootDir: join(root, "exports") });
  const adapter = new OneSessionPiAdapter({
    store, rpc, exportRegistry: registry,
    workspace: { workspaceId: "22222222-2222-4222-8222-222222222222", rootPath: root, displayName: "private", fingerprint: "fp", policyMode: "full" },
  });
  return { root, store, rpc, registry, adapter, sessionId };
}

describe("M13 opaque HTML exports", () => {
  test("adapter exports HTML and journals only opaque bounded metadata", async () => {
    const { root, store, rpc, adapter, sessionId } = setup();
    await adapter.dispatch({ commandId: "33333333-3333-4333-8333-333333333333", type: "session.export", scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}`, semanticHash: "hash", payload: { sessionId, format: "html" }, state: "accepted", dispatchCount: 0 });
    expect(rpc.requests.some((request) => request.method === "export_html")).toBe(true);
    const event = store.listEvents(`session:${sessionId}`).find((item) => item.type === "session.export")!;
    expect(event.payload).toMatchObject({ format: "html", status: "available", completion: { state: "completed" } });
    const encoded = JSON.stringify(event.payload);
    expect(encoded).not.toContain(root);
    expect(encoded).not.toContain("http://");
    expect(encoded).not.toContain("https://");
    expect(typeof event.payload.exportId).toBe("string");
    store.close();
  });

  test("private download has bounded disposition and expiry removes availability", async () => {
    let now = 1_700_000_000_000;
    const root = mkdtempSync(join(tmpdir(), "pi-mob-export-http-"));
    const registry = new ExportRegistry({ rootDir: root, now: () => now, ttlMs: 60_000 });
    const reserved = registry.register({ sessionId: "s", format: "html" });
    const body = Buffer.from("<html>ok</html>");
    writeFileSync(reserved.storagePath, body);
    registry.markCompleted(reserved.metadata.exportId, { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    const attachments = new AttachmentStore({ root: join(root, "attachments") });
    const handler = createBinaryHttpHandler({ attachments, exports: { getExport: (id) => registry.get(id), exportFile: (id) => registry.file(id) }, credentials: { verify: () => ({ kind: "valid", installationId: "00000000-0000-4000-8000-000000000000" }) } });
    const response = await handler(new Request(`https://private.ts.net/v1/exports/${reserved.metadata.exportId}`, { headers: { "X-Installation-Id": "00000000-0000-4000-8000-000000000000", "X-Installation-Credential": "x" } }));
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-disposition")).toMatch(/^attachment; filename="pi-session-/);
    expect(response!.headers.get("cache-control")).toBe("private, no-store");
    now += 60_001;
    const expired = await handler(new Request(`https://private.ts.net/v1/exports/${reserved.metadata.exportId}`, { headers: { "X-Installation-Id": "00000000-0000-4000-8000-000000000000", "X-Installation-Credential": "x" } }));
    expect(expired!.status).toBe(404);
    attachments.close();
  });

  test("operator delete and capacity stay bounded", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-export-cap-"));
    const registry = new ExportRegistry({ rootDir: root, maxExports: 1 });
    const first = registry.register({ sessionId: "s", format: "html" });
    expect(() => registry.register({ sessionId: "s", format: "html" })).toThrow("export_capacity");
    expect(registry.delete(first.metadata.exportId)?.status).toBe("deleted");
    expect(registry.get(first.metadata.exportId)).toBeNull();
  });
});
