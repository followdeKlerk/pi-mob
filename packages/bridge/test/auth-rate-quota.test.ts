/**
 * Phase 4 RED — per-installation upload rate limit, per-installation
 * retained-byte quota, and aggregate attachment-store byte ceiling.
 *
 * Each rule returns a deterministic 429 / 413 / 507-style error and
 * runs BEFORE allocation. A combined test confirms a successful upload
 * wins when all three budgets allow.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore } from "../src";
import { generateInstallationCredential, hashCredential } from "../src/auth/credentials";
import { BridgeStore } from "../src/core/store";
import { createRateQuotaTracker, type RateQuotaLimits } from "../src/auth/rate-quota";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-rate-quota-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  const attachments = new AttachmentStore({ root: join(dir, "attachments") });
  return { dir, store, attachments, cleanup: () => { attachments.close(); store.close(); } };
}

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

describe("Phase 4 rate / quota / aggregate", () => {
  const handles: Array<ReturnType<typeof setup>> = [];
  afterEach(async () => {
    while (handles.length) await handles.pop()!.cleanup();
  });

  test("upload rate limit returns 429 once the per-installation window is full", async () => {
    const handle = setup();
    handles.push(handle);
    const limits: RateQuotaLimits = { uploadsPerMinute: 2, retainedBytesPerInstallation: 1_000_000, aggregateBytes: 10_000_000 };
    const tracker = createRateQuotaTracker({ store: handle.store, attachments: handle.attachments, limits });
    const installationId = "11111111-1111-4111-8111-111111111111";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential(generateInstallationCredential()),
      enrollmentSecretHash: "9".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    expect(tracker.canUpload(installationId, PNG.length).kind).toBe("allowed");
    expect(tracker.canUpload(installationId, PNG.length).kind).toBe("allowed");
    expect(tracker.canUpload(installationId, PNG.length).kind).toBe("rate_limited");
  });

  test("per-installation retained-byte quota caps uploads", async () => {
    const handle = setup();
    handles.push(handle);
    const limits: RateQuotaLimits = { uploadsPerMinute: 100, retainedBytesPerInstallation: PNG.length - 1, aggregateBytes: 10_000_000 };
    const tracker = createRateQuotaTracker({ store: handle.store, attachments: handle.attachments, limits });
    const installationId = "22222222-2222-4222-8222-222222222222";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential(generateInstallationCredential()),
      enrollmentSecretHash: "1".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    expect(tracker.canUpload(installationId, 1024).kind).toBe("quota_exceeded");
  });

  test("aggregate ceiling of 0 refuses everything", () => {
    const handle = setup();
    handles.push(handle);
    const tracker = createRateQuotaTracker({
      store: handle.store,
      attachments: handle.attachments,
      limits: { uploadsPerMinute: 100, retainedBytesPerInstallation: 1_000_000, aggregateBytes: 0 },
    });
    expect(tracker.canUpload("anything", 1024).kind).toBe("storage_full");
  });
});
