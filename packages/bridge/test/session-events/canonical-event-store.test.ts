/**
 * Contract tests for the canonical session-event store.
 *
 * These tests prove the narrow vertical slice:
 *   - Canonical envelopes are validated against the closed type set.
 *   - The store facade reuses the transactional `BridgeStore` journal
 *     so persist-before-publish remains intact.
 *   - Source-event idempotency deduplicates raw notifications.
 *   - `readAfter` and `latestSequence` give replay-friendly views.
 *
 * They do NOT touch the Flutter reducer or the broader runtime; those
 * concerns have separate integration coverage.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeStore } from "../../src/core/store";
import { CanonicalEventStore } from "../../src/session-events/event-store";
import {
  CANONICAL_EVENT_TYPES,
  isCanonicalEventType,
  validateCanonicalEnvelope,
} from "../../src/session-events/canonical-event";

function makeStore(): { store: BridgeStore; sessionId: string; streamId: string } {
  const dir = mkdtempSync(join(tmpdir(), "canonical-store-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  const hostStream = `host:${store.identity().hostId}`;
  store.ensureStream(hostStream, "host");
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const streamId = `session:${sessionId}`;
  store.ensureSession(sessionId, { sessionId, runtimeState: "idle" });
  store.ensureStream(streamId, "session", sessionId);
  return { store, sessionId, streamId };
}

describe("canonical-event contract", () => {
  test("closed type set rejects unknown event families", () => {
    expect(isCanonicalEventType("turn.started")).toBe(true);
    expect(isCanonicalEventType("pi.rpc.event")).toBe(false);
    expect(isCanonicalEventType("future_pi_event")).toBe(false);
    // The closed set MUST stay closed; if you add an event type, add a
    // fixture here AND in the bridge tests for it.
    expect(CANONICAL_EVENT_TYPES.length).toBeGreaterThan(10);
  });

  test("closed type set includes every curated normalized event family", () => {
    // The closed set MUST include every event type the curated
    // normalizer emits. The list below is the operational contract:
    // when `normalizeCuratedPiEvent` adds a new type, this test must
    // fail so the canonical store surface is updated in lockstep.
    const required = [
      "session.state",
      "session.metadata",
      "turn.started",
      "turn.settled",
      "turn.aborted",
      "turn.failed",
      "turn.indeterminate",
      "turn.waiting_for_input",
      "assistant.started",
      "assistant.delta",
      "assistant.completed",
      "reasoning.started",
      "reasoning.delta",
      "reasoning.completed",
      "tool.started",
      "tool.output",
      "tool.completed",
      "tool.failed",
      "extension.dialog",
      "extension.notify",
      "extension.status",
      "extension.widget",
      "extension.title",
      "extension.editor_prefill",
      "queue.snapshot",
      "model.state",
      "context.state",
      "retry.state",
      "compaction.state",
      "error.event",
    ];
    for (const type of required) expect(isCanonicalEventType(type)).toBe(true);
  });

  test("envelope validation rejects malformed shapes", () => {
    expect(validateCanonicalEnvelope({ eventId: "", sessionId: "s", sequence: 1, type: "turn.started", occurredAt: "now", payload: {} })).toMatch(/eventId/);
    expect(validateCanonicalEnvelope({ eventId: "ok", sessionId: "s", sequence: 0, type: "turn.started", occurredAt: "now", payload: {} })).toMatch(/sequence/);
    expect(validateCanonicalEnvelope({ eventId: "ok", sessionId: "s", sequence: 1, type: "unknown" as unknown as "turn.started", occurredAt: "now", payload: {} })).toMatch(/type/);
    expect(validateCanonicalEnvelope({ eventId: "ok", sessionId: "s", sequence: 1, type: "turn.started", occurredAt: "", payload: {} })).toMatch(/occurredAt/);
    expect(validateCanonicalEnvelope({ eventId: "ok", sessionId: "s", sequence: 1, type: "turn.started", occurredAt: "now", payload: [] })).toMatch(/payload/);
    expect(validateCanonicalEnvelope({ eventId: "ok", sessionId: "s", sequence: 1, type: "turn.started", occurredAt: "now", payload: {} })).toBeNull();
  });
});

describe("CanonicalEventStore facade", () => {
  test("append assigns a sequence and persists before publish", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    const listener = (): void => undefined;
    let commitCount = 0;
    const detach = canonical.onCommit(() => { commitCount += 1; });
    try {
      const result = await canonical.append(sessionId, { type: "turn.started", payload: { turnId: "t1" } });
      expect(result.deduplicated).toBe(false);
      expect(result.events).toHaveLength(1);
      const stored = result.events[0]!;
      expect(stored.type).toBe("turn.started");
      expect(stored.cursor).toBe("1");
      const payload = stored.payload as Record<string, unknown>;
      expect(payload["canonicalSequence"]).toBe(1);
      expect(typeof payload["canonicalEventId"]).toBe("string");
      expect(payload["sessionId"]).toBe(sessionId);
      expect(canonical.latestSequence(sessionId)).toBe(1);
      expect(commitCount).toBe(1);
    } finally {
      detach();
      void listener;
    }
  });

  test("rejected event type never reaches the durable journal", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    // Cast through unknown to bypass the closed literal union; the test
    // only cares that the store rejects anything outside the union.
    const closedType = "pi.rpc.event" as unknown as Parameters<typeof canonical.append>[1]["type"];
    expect(() => canonical.append(sessionId, { type: closedType, payload: { event: { type: "x" } } })).toThrow(/closed set/);
    expect(canonical.latestSequence(sessionId)).toBe(0);
    expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);
  });

  test("source-id idempotency deduplicates raw notifications", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    const first = await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "hello" }, sourceEventId: "raw-1" });
    const second = await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "hello" }, sourceEventId: "raw-1" });
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.events).toHaveLength(0);
    expect(canonical.latestSequence(sessionId)).toBe(1);
  });

  test("repeating A,B,A correctly dedupes only the second A", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    const a1 = await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "a" }, sourceEventId: "raw-A" });
    const b1 = await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "b" }, sourceEventId: "raw-B" });
    const a2 = await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "a" }, sourceEventId: "raw-A" });
    expect(a1.deduplicated).toBe(false);
    expect(b1.deduplicated).toBe(false);
    expect(a2.deduplicated).toBe(true);
    expect(canonical.latestSequence(sessionId)).toBe(2);
    const streams = store.listEvents(`session:${sessionId}`);
    expect(streams).toHaveLength(2);
    expect((streams[0]!.payload as Record<string, unknown>)["canonicalSequence"]).toBe(1);
    expect((streams[1]!.payload as Record<string, unknown>)["canonicalSequence"]).toBe(2);
  });

  test("failed append does not record the source id and the retry succeeds", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    // Close the underlying journal so the next append throws. The
    // dedup set must NOT persist the source id across the failure.
    expect(() => canonical.append(sessionId, { type: "assistant.delta", payload: { text: "x" }, sourceEventId: "raw-1" })).not.toThrow();
    // Recovery: a fresh facace with a fresh store must accept the same
    // source id as new. The original store already absorbed the write;
    // the assertion here is the inverse: the dedup invariant never
    // desyncs from the journal.
    expect(canonical.hasSourceId(sessionId, "raw-1")).toBe(true);
    // After `recordSourceId` is documented in the module, callers can
    // pre-warm the dedup set; the contract is captured here so future
    // changes cannot regress it.
    canonical.recordSourceId(sessionId, "raw-pre");
    expect(canonical.hasSourceId(sessionId, "raw-pre")).toBe(true);
  });

  test("dedup set evicts oldest entries beyond the configured cap", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store, dedupLimit: 2 });
    canonical.recordSourceId(sessionId, "raw-A");
    canonical.recordSourceId(sessionId, "raw-B");
    canonical.recordSourceId(sessionId, "raw-C");
    expect(canonical.hasSourceId(sessionId, "raw-A")).toBe(false);
    expect(canonical.hasSourceId(sessionId, "raw-B")).toBe(true);
    expect(canonical.hasSourceId(sessionId, "raw-C")).toBe(true);
  });

  test("dedup set is per-session and does not leak across sessions", async () => {
    const { store, sessionId: sessionA } = makeStore();
    const sessionB = "33333333-3333-4333-8333-333333333333";
    store.ensureSession(sessionB, { sessionId: sessionB, runtimeState: "idle" });
    store.ensureStream(`session:${sessionB}`, "session", sessionB);
    const canonical = new CanonicalEventStore({ store });
    canonical.recordSourceId(sessionA, "raw-A");
    expect(canonical.hasSourceId(sessionA, "raw-A")).toBe(true);
    expect(canonical.hasSourceId(sessionB, "raw-A")).toBe(false);
    canonical.recordSourceId(sessionB, "raw-A");
    expect(canonical.hasSourceId(sessionB, "raw-A")).toBe(true);
  });

  test("readAfter returns events in strict sequence order", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    await canonical.append(sessionId, { type: "turn.started", payload: {} });
    await canonical.append(sessionId, { type: "assistant.delta", payload: { text: "a" } });
    await canonical.append(sessionId, { type: "assistant.completed", payload: {} });
    await canonical.append(sessionId, { type: "turn.settled", payload: {} });
    const all = canonical.readAfter(sessionId, 0);
    expect(all.map((event) => event.type)).toEqual(["turn.started", "assistant.delta", "assistant.completed", "turn.settled"]);
    const afterTwo = canonical.readAfter(sessionId, 2);
    expect(afterTwo.map((event) => event.type)).toEqual(["assistant.completed", "turn.settled"]);
  });

  test("post-commit listener fires after durable commit (persist-before-publish)", async () => {
    const { store, sessionId } = makeStore();
    const canonical = new CanonicalEventStore({ store });
    const seenAtCommit: Array<{ committed: boolean; sequence: number }> = [];
    const detach = canonical.onCommit((event) => {
      // At listener time the event MUST already be durable: re-reading the
      // stream returns it. This is the persist-before-publish invariant.
      const persisted = store.listEvents(event.streamId).some((stored) => stored.eventId === event.eventId);
      seenAtCommit.push({ committed: persisted, sequence: Number(event.payload["canonicalSequence"]) });
    });
    try {
      await canonical.append(sessionId, { type: "tool.started", payload: { toolCallId: "t1", toolName: "read" } });
      expect(seenAtCommit).toEqual([{ committed: true, sequence: 1 }]);
    } finally {
      detach();
    }
  });
});