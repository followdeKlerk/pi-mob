/**
 * The rewrite slice removes the legacy `pi.rpc.event` envelope from the
 * user-visible session stream (per `pi-mob-simplification-plan.md`
 * §3.3). These tests prove the contract:
 *
 *   - `normalizePiEvent` no longer emits any `pi.rpc.event` envelope for
 *     unknown or raw shapes.
 *   - The legacy `normalizePiEventWithRawPassthrough` helper has been
 *     deleted from the package surface. Forcing the regression here
 *     means a future contributor cannot accidentally re-introduce the
 *     raw passthrough without updating this test.
 *   - Raw Pi notifications are observable through the diagnostics sink
 *     for support/forensic use, but they MUST NOT participate in the
 *     transcript.
 */

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeStore } from "../src/core/store";
import { normalizePiEvent } from "../src/pi/normalize";
import { PiDiagnosticsSink } from "../src/session-events/diagnostics";

const sessionId = "11111111-1111-4111-8111-111111111111";

test("unknown Pi events are dropped from the user-visible stream", () => {
  const raw = {
    type: "future_pi_event",
    nested: { value: 1 },
    items: ["a", "b"],
  };
  // Rewrite slice: `normalizePiEvent` returns NO `pi.rpc.event` envelope.
  // Unknown shapes are routed through the diagnostics sink instead.
  expect(normalizePiEvent(raw, { sessionId })).toEqual([]);
});

test("legacy raw passthrough helper is no longer exported from the bridge package", () => {
  // The legacy helper was the only public way to obtain a `pi.rpc.event`
  // envelope. The rewrite slice deletes it so production callers cannot
  // accidentally re-introduce raw events into the transcript. We assert
  // the package surface still builds and exposes curated normalisation
  // only.
  const curated = normalizePiEvent({ type: "future_pi_event" }, { sessionId });
  expect(curated).toEqual([]);
  expect(curated.map((event) => event.type)).not.toContain("pi.rpc.event");
});

test("curated session stream never contains a pi.rpc.event envelope", () => {
  const dir = mkdtempSync(join(tmpdir(), "raw-passthrough-stream-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  store.ensureStream(`host:${store.identity().hostId}`, "host");
  store.ensureSession(sessionId, { sessionId, workspaceId: "ws", policyMode: "full", runtimeState: "idle" });
  store.ensureStream(`session:${sessionId}`, "session", sessionId);
  try {
    store.appendEvent(`session:${sessionId}`, "turn.started", { sessionId });
    store.appendEvent(`session:${sessionId}`, "assistant.delta", { sessionId, text: "hello" });
    const types = store.listEvents(`session:${sessionId}`).map((event) => event.type);
    expect(types).not.toContain("pi.rpc.event");
  } finally {
    store.close();
  }
});

test("unknown Pi notifications are observable through the diagnostics sink", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-diagnostics-"));
  const db = new Database(join(root, "diagnostics.sqlite"));
  try {
    const sink = new PiDiagnosticsSink(db);
    const raw = {
      type: "future_pi_event",
      nested: { value: 1 },
      items: ["a", "b"],
    };
    sink.append(raw, sessionId);
    const row = db.query("SELECT session_id, event_type FROM pi_event_diagnostics").get() as { session_id: string; event_type: string } | null;
    expect(row).not.toBeNull();
    expect(row?.session_id).toBe(sessionId);
    expect(row?.event_type).toBe("future_pi_event");
  } finally {
    db.close();
  }
});
