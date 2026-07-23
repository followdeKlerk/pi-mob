import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore, BridgeStore, DurableBridgeRuntime, ExportRegistry, createBinaryHttpHandler, type AdapterPort } from "../src";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("M13 admission, retention, and cleanup", () => {
  test("unavailable attachment rejects before durable prompt acceptance", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "m13-admit-")), "db.sqlite"));
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const stream = `session:${sessionId}`;
    store.ensureSession(sessionId, { sessionId, runtimeState: "idle", attentionState: "ready" });
    store.ensureStream(stream, "session", sessionId);
    const connection = { connectionId: "connection", installationId: "installation", subscriptions: new Set<string>() };
    store.acceptCommand({
      commandId: "22222222-2222-4222-8222-222222222222", type: "controller.acquire", scopeKey: stream, streamId: stream, semanticHash: "lease", payload: { scope: "session", sessionId },
      leaseMutation: { action: "acquire", scopeKey: stream, installationId: connection.installationId, connectionId: connection.connectionId },
    });
    const adapter: AdapterPort = {
      async dispatch() {},
      validateCommand(type, payload) {
        if (type === "prompt.submit" && Array.isArray(payload.attachmentIds) && payload.attachmentIds.length) throw new Error("attachment_unavailable");
      },
    };
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "fixture", piVersion: "0.80.6", hostDisplayName: "fixture" });
    runtime.setReadyForTest(true);
    const commandId = "33333333-3333-4333-8333-333333333333";
    expect(() => runtime.command(connection, {
      type: "prompt.submit", commandId, leaseId: store.lease(stream)!.leaseId,
      payload: { sessionId, deliveryMode: "immediate", message: "image", attachmentIds: ["44444444-4444-4444-8444-444444444444"] },
    })).toThrow("unavailable");
    expect(store.command(commandId)).toBeNull();
    store.close();
  });

  test("same digest retry tolerates safe filename changes", () => {
    const store = new AttachmentStore({ root: mkdtempSync(join(tmpdir(), "m13-retry-")), chunkMinBytes: 1 });
    const first = store.begin({ clientUploadId: "install:upload", contentType: "image/png", filename: "first.png", totalBytes: PNG.length, chunkSize: PNG.length, sha256: sha(PNG) });
    const retry = store.begin({ clientUploadId: "install:upload", contentType: "image/png", filename: "renamed.png", totalBytes: PNG.length, chunkSize: PNG.length, sha256: sha(PNG) });
    expect(retry.kind).toBe("duplicate");
    expect(retry.record.id).toBe(first.record.id);
    store.close();
  });

  test("pending and failed exports are never downloadable; completed survives restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "m13-export-restart-"));
    let registry = new ExportRegistry({ rootDir: root });
    const pending = registry.register({ sessionId: "s", format: "html" });
    writeFileSync(pending.storagePath, "partial");
    const attachments = new AttachmentStore({ root: join(root, "attachments") });
    let handler = createBinaryHttpHandler({ attachments, exports: { getExport: (id) => registry.get(id), exportFile: (id) => registry.file(id) } });
    expect((await handler(new Request(`https://private/v1/exports/${pending.metadata.exportId}`)))!.status).toBe(404);
    registry.markFailed(pending.metadata.exportId, "render failed");
    expect((await handler(new Request(`https://private/v1/exports/${pending.metadata.exportId}`)))!.status).toBe(404);

    const completed = registry.register({ sessionId: "s", format: "html" });
    const html = Buffer.from("<html>complete</html>");
    writeFileSync(completed.storagePath, html);
    registry.markCompleted(completed.metadata.exportId, { bytes: html.length, sha256: sha(html) });
    registry = new ExportRegistry({ rootDir: root });
    handler = createBinaryHttpHandler({ attachments, exports: { getExport: (id) => registry.get(id), exportFile: (id) => registry.file(id) } });
    expect((await handler(new Request(`https://private/v1/exports/${completed.metadata.exportId}`)))!.status).toBe(200);
    attachments.close();
  });
});
