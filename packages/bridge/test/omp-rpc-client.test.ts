import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OmpRpcClient, OmpRpcError } from "../src/omp/rpc-client";

function fixture(root: string, maxFrameBytes?: number): string {
  const executable = join(root, "omp-fixture.mjs");
  writeFileSync(
    executable,
    `#!${process.execPath}
import { createInterface } from "node:readline";
process.stdout.write(JSON.stringify({ type: "ready"${maxFrameBytes === undefined ? "" : `, maxFrameBytes: ${maxFrameBytes}`} }) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true, data: { received: true } }) + "\\n");
}
`,
    { mode: 0o700 },
  );
  return executable;
}

describe("OMP RPC request frame limits", () => {
  test("accepts image-sized requests up to the negotiated frame limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-omp-frame-"));
    const client = new OmpRpcClient({
      executable: fixture(root, 1_048_576),
      cwd: root,
      sessionDir: root,
      closeGracePeriodMs: 10,
    });
    try {
      await client.start();
      await expect(
        client.request(
          "prompt",
          {
            images: [
              {
                type: "image",
                mimeType: "image/jpeg",
                data: "a".repeat(280_000),
              },
            ],
          },
          { timeoutMs: 15_000 },
        ),
      ).resolves.toEqual({ received: true });
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("rejects requests above the negotiated frame limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-omp-frame-"));
    const client = new OmpRpcClient({
      executable: fixture(root, 1_048_576),
      cwd: root,
      sessionDir: root,
      closeGracePeriodMs: 10,
    });
    try {
      await client.start();
      await expect(
        client.request("prompt", {
          images: [{ type: "image", data: "a".repeat(1_048_576) }],
        }),
      ).rejects.toBeInstanceOf(OmpRpcError);
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("retains the 64 KiB default when OMP does not negotiate a frame limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-omp-frame-"));
    const client = new OmpRpcClient({
      executable: fixture(root),
      cwd: root,
      sessionDir: root,
      closeGracePeriodMs: 10,
    });
    try {
      await client.start();
      await expect(
        client.request("prompt", { message: "a".repeat(70_000) }),
      ).rejects.toBeInstanceOf(OmpRpcError);
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
