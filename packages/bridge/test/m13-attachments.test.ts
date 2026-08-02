import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore, createBinaryHttpHandler, inspectImage } from "../src";
import { BridgeStore } from "../src/core/store";
import { generateInstallationCredential, hashCredential } from "../src/auth/credentials";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function setup(now = 1_700_000_000_000) {
  let clock = now;
  const store = new AttachmentStore({ root: mkdtempSync(join(tmpdir(), "pi-mob-att-")), now: () => clock, chunkMinBytes: 1 });
  return { store, advance: (ms: number) => { clock += ms; } };
}

describe("M13 attachment security", () => {
  test("valid PNG uploads once and retry deduplicates without path disclosure", async () => {
    const { store } = setup();
    const bridge = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-att-rs-")), "bridge.sqlite"));
    const installationId = "11111111-2222-4333-8444-555555555555";
    const plain = generateInstallationCredential();
    bridge.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential(plain),
      enrollmentSecretHash: "1".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    const handler = createBinaryHttpHandler({
      attachments: store,
      credentials: { verify: (id, supplied) => bridge.findInstallationCredential(id)?.credentialHash === hashCredential(supplied) ? { kind: "valid", installationId: id } : { kind: "wrong" } },
    });
    const reqHeaders = { "X-Installation-Id": installationId, "X-Installation-Credential": plain };
    const form = () => { const value = new FormData(); value.set("installationId", installationId); value.set("clientUploadId", "upload-a"); value.set("content", new File([PNG], "one.png", { type: "application/octet-stream" })); return value; };
    const first = await handler(new Request("https://host.test/v1/attachments", { method: "POST", body: form(), headers: reqHeaders }));
    expect(first!.status).toBe(201);
    const body = await first!.json() as Record<string, unknown>;
    expect(body).toMatchObject({ mimeType: "image/png", width: 1, height: 1, bytes: PNG.length, sha256: digest(PNG) });
    expect(JSON.stringify(body)).not.toContain(store.configuration.toString());
    const second = await handler(new Request("https://host.test/v1/attachments", { method: "POST", body: form(), headers: reqHeaders }));
    expect(second!.status).toBe(200);
    expect((await second!.json() as Record<string, unknown>).attachmentId).toBe(body.attachmentId);
    store.close();
    bridge.close();
  });

  test("same client upload id with different digest conflicts", () => {
    const { store } = setup();
    const first = store.begin({ clientUploadId: "i:u", contentType: "image/png", totalBytes: PNG.length, chunkSize: PNG.length, sha256: digest(PNG) });
    expect(first.kind).toBe("created");
    const other = store.begin({ clientUploadId: "i:u", contentType: "image/png", totalBytes: PNG.length + 1, chunkSize: PNG.length + 1, sha256: "0".repeat(64) });
    expect(other.kind).toBe("conflict");
    store.close();
  });

  test("malformed and decompression-sized images reject before storage", () => {
    expect(() => inspectImage(Uint8Array.of(1, 2, 3))).toThrow("not a JPEG or PNG");
    const bomb = PNG.slice();
    new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength).setUint32(16, 100000);
    expect(() => inspectImage(bomb)).toThrow("dimensions");
  });

  test("completed orphan expires, retained queue reference survives", () => {
    const { store, advance } = setup();
    const started = store.begin({ contentType: "image/png", totalBytes: PNG.length, chunkSize: PNG.length, sha256: digest(PNG) });
    const completed = store.appendChunk(started.record.id, { payload: PNG, offset: 0, contentSha256: digest(PNG) }).record;
    store.retain(completed.id, completed.expiresAt + 24 * 60 * 60_000);
    advance(24 * 60 * 60_000 + 1);
    expect(store.resolve(completed.id).available).toBe(true);
    advance(24 * 60 * 60_000 + 1);
    expect(store.resolve(completed.id).available).toBe(false);
    expect(store.sweep().removed).toContain(completed.id);
    store.close();
  });

  test("oversized declaration fails without allocation", () => {
    const { store } = setup();
    expect(() => store.begin({ contentType: "image/png", totalBytes: 10 * 1024 * 1024 + 1 })).toThrow("exceeds");
    store.close();
  });
});
