import { expect, test } from "bun:test";
import { normalizePiEvent } from "../src";

const sessionId = "11111111-1111-4111-8111-111111111111";

test("unknown Pi events pass through the raw RPC event channel verbatim", () => {
  const raw = {
    type: "future_pi_event",
    nested: { value: 1 },
    items: ["a", "b"],
  };
  expect(normalizePiEvent(raw, { sessionId })).toEqual([
    { type: "pi.rpc.event", payload: { sessionId, event: raw } },
  ]);
});
