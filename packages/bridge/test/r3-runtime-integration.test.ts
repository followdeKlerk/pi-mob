import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdapterPort } from "../src/core/domain";
import { DurableBridgeRuntime, RuntimeProtocolError } from "../src/core/runtime";
import { BridgeStore } from "../src/core/store";
import { WorkspaceFileService } from "../src/core/workspace-files";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const connection = {
  connectionId: "33333333-3333-4333-8333-333333333333",
  installationId: "44444444-4444-4444-8444-444444444444",
  subscriptions: new Set<string>(),
};
const adapter: AdapterPort = { async dispatch() {} };

function runtimeFor(files?: WorkspaceFileService): DurableBridgeRuntime {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-r3-runtime-")), "bridge.sqlite");
  return new DurableBridgeRuntime({
    store: new BridgeStore(path),
    adapter,
    bridgeVersion: "test",
    piVersion: "0.80.6",
    hostDisplayName: "test",
    ...(files ? { workspaceFiles: files } : {}),
  });
}

test("R3 runtime routes bounded reads only through an installed workspace file service", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-mob-r3-root-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), "export const answer = 42;\n");
  const files = new WorkspaceFileService([{ workspaceId, canonicalPath: root }]);
  const runtime = runtimeFor(files);
  expect(runtime.optionalCapabilities()).toEqual(["files.v1"]);

  const response = runtime.control(connection, "workspace.file.read", {
    workspaceId,
    path: "src/main.ts",
    rangeStart: 1,
    rangeEnd: 1,
  });

  expect(response).toMatchObject({
    workspaceId,
    result: { path: "src/main.ts", content: "export const answer = 42;", rangeStart: 1, rangeEnd: 1 },
  });
  expect(() => runtime.control(connection, "workspace.file.read", {
    workspaceId,
    path: "../secret",
    rangeStart: 1,
    rangeEnd: 1,
  })).toThrow(RuntimeProtocolError);
});

test("R3 runtime reports unavailable rather than attempting filesystem reads without authority", () => {
  const runtime = runtimeFor();
  expect(runtime.optionalCapabilities()).toEqual([]);
  expect(() => runtime.control(connection, "workspace.tree.page", {
    workspaceId,
    pageSize: 1,
  })).toThrow(/unavailable/);
});
