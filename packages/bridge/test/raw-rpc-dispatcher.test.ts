import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  BridgeStore,
  handleRawRpcRequest,
  type PiRpcClient,
  type PiRpcRequestOptions,
} from "../src";

const sessionId = "11111111-1111-4111-8111-111111111111";

test("raw RPC dispatch preserves the Pi command and response body", async () => {
  const store = new BridgeStore(
    join(mkdtempSync(join(tmpdir(), "pi-mob-raw-rpc-")), "bridge.sqlite"),
  );
  store.ensureSession(sessionId, { runtimeState: "idle" });
  store.ensureStream(`session:${sessionId}`, "session", sessionId);
  const requests: PiRpcRequestOptions[] = [];
  const upstream = {
    type: "response",
    command: "get_state",
    success: true,
    data: { state: "idle" },
  };
  const rpc: PiRpcClient = {
    async request(options) {
      requests.push(options);
      return upstream;
    },
    on: () => () => undefined,
  };
  await handleRawRpcRequest(
    { resolveRpc: () => rpc },
    {
      commandId: "22222222-2222-4222-8222-222222222222",
      type: "pi.rpc.request",
      scopeKey: `session:${sessionId}`,
      streamId: `session:${sessionId}`,
      semanticHash: "hash",
      state: "running",
      dispatchCount: 1,
      payload: {
        sessionId,
        requestId: "raw-request-1",
        command: { type: "get_state" },
      },
    },
    store,
  );

  expect(requests).toEqual([
    {
      id: "raw-request-1",
      method: "get_state",
      params: { type: "get_state" },
    },
  ]);
  const event = store
    .listEvents(`session:${sessionId}`)
    .find((candidate) => candidate.type === "pi.rpc.response");
  expect(event?.payload).toEqual({
    sessionId,
    requestId: "raw-request-1",
    response: upstream,
  });
});
