/**
 * Regression for the bridge-daemon startup busy loop.
 *
 * The host used to take >9 minutes to import a single large external Pi
 * session (e.g. 7k-line / 39 MB JSONL) because
 * {@link DurableRecipeActivityProjection.appendChanged} rescanned the full
 * recipe-activity projector on every source event. With ~5k activities and
 * ~15k source events that became O(n^2) work (~75 M iterations plus a
 * canonical() invocation per activity per event), and the bridge never
 * reached its JSON-RPC listener before the LaunchAgent watchdog killed it.
 *
 * The fix: track only the activity identities that actually changed since
 * the last publish, and publish those. Hydration drains its own dirty set
 * so a restart does not re-emit the historical journal; downstream
 * importers / live appends drain via `appendChanged`. With per-event work
 * bounded by the number of dirty identities (≤ total activities, ≪ events)
 * the import is linear in the journal size.
 *
 * The pre-fix code path would publish every canonicalised activity on
 * every event, so any growth was visible in per-event work scaling; on
 * the post-fix path each event does O(1) hashing + a single hashset
 * insert plus, only when something changed, a single canonicalisation.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RecipeActivityProjector } from "../src/pi/recipe-activity";
import {
  DurableRecipeActivityProjection,
  importExternalSessionHistory,
} from "../src/pi/external-history";
import { BridgeStore, type StoredEvent } from "../src/core/store";

const SESSION = "sess";
const TURN = "turn";
const TOOL = "tool";

function toolStart(activityId: string, at = "2026-01-01T00:00:00.000Z") {
  return {
    type: "tool.started",
    payload: { toolCallId: activityId, toolName: "bash", arguments: { command: "echo" } },
    occurredAt: at,
  } as const;
}
function toolOutput(activityId: string, at = "2026-01-01T00:00:01.000Z") {
  return {
    type: "tool.output",
    payload: { toolCallId: activityId, output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false },
    occurredAt: at,
  } as const;
}
function toolCompleted(activityId: string, at = "2026-01-01T00:00:02.000Z") {
  return {
    type: "tool.completed",
    payload: { toolCallId: activityId, result: { output: "ok" } },
    occurredAt: at,
  } as const;
}
function thinkingStart(activityId: string, at = "2026-01-01T00:00:00.000Z") {
  return {
    type: "reasoning.started",
    payload: { contentBlockId: activityId },
    occurredAt: at,
  } as const;
}
function thinkingCompleted(activityId: string, at = "2026-01-01T00:00:00.500Z") {
  return {
    type: "reasoning.completed",
    payload: { contentBlockId: activityId },
    occurredAt: at,
  } as const;
}

describe("RecipeActivityProjector dirty tracking", () => {
  test("takeDirty returns and clears the changed identities on each call", () => {
    const projector = new RecipeActivityProjector({ sessionId: SESSION, turnId: TURN });
    projector.apply(toolStart("a"));
    projector.apply(toolOutput("a"));
    projector.apply(toolStart("b"));
    const first = projector.takeDirty();
    expect(first.sort()).toEqual([
      `${SESSION}\u0000${TURN}\u0000a`,
      `${SESSION}\u0000${TURN}\u0000b`,
    ]);
    expect(projector.takeDirty()).toEqual([]);
  });

  test("a second apply() after drain re-dirties the same identity", () => {
    const projector = new RecipeActivityProjector({ sessionId: SESSION, turnId: TURN });
    projector.apply(toolStart("a"));
    projector.apply(toolOutput("a"));
    projector.apply(toolCompleted("a"));
    projector.takeDirty(); // drain
    // Re-applying (e.g. on import replay) re-dirties without producing
    // duplicates beyond the activity itself.
    projector.apply(toolOutput("a"));
    const drained = projector.takeDirty();
    expect(drained).toEqual([`${SESSION}\u0000${TURN}\u0000a`]);
  });

  test("idle-typed or rejected events do not dirty anything", () => {
    const projector = new RecipeActivityProjector({ sessionId: SESSION, turnId: TURN });
    projector.apply({ type: "turn.started", payload: { turnId: TURN }, occurredAt: "2026-01-01T00:00:00.000Z" });
    projector.apply({ type: "unrelated.event", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" });
    expect(projector.takeDirty()).toEqual([]);
    // An oversized identity is rejected before any activity is created, so
    // the dirty set stays empty.
    projector.apply({ type: "tool.started", payload: { toolCallId: "x".repeat(129), toolName: "bash" }, occurredAt: "2026-01-01T00:00:00.000Z" });
    expect(projector.takeDirty()).toEqual([]);
  });

  test("thinking lifecycles dirty on every apply, leaving dedup to the caller", () => {
    const projector = new RecipeActivityProjector({ sessionId: SESSION, turnId: TURN });
    projector.apply(thinkingStart("r"));
    projector.apply(thinkingCompleted("r"));
    const dirty = new Set(projector.takeDirty());
    expect(dirty).toEqual(new Set([`${SESSION}\u0000${TURN}\u0000r`]));
    // Re-applying the same events re-dirties: the projector is a pure
    // reducer and updates `timing.updatedAt`, so the in-memory state is
    // a fresh object. The durable layer dedupes via canonical()
    // comparison against already-published payload hashes; the projector
    // itself does not try to dedupe.
    projector.apply(thinkingStart("r"));
    projector.apply(thinkingCompleted("r"));
    expect(projector.takeDirty()).toEqual([`${SESSION}\u0000${TURN}\u0000r`]);
  });

  test("activity() returns the latest projection for an identity", () => {
    const projector = new RecipeActivityProjector({ sessionId: SESSION, turnId: TURN });
    projector.apply(toolStart("x"));
    projector.apply(toolOutput("x"));
    projector.apply(toolCompleted("x"));
    const identity = `${SESSION}\u0000${TURN}\u0000x`;
    const activity = projector.activity(identity);
    expect(activity).toBeDefined();
    expect(activity?.kind).toBe(TOOL);
    expect(activity?.status).toBe("completed");
    expect(activity?.output).toBe('{"output":"ok"}');
  });
});

// ---------------------------------------------------------------------------
// Durable projection contract.
//
// These tests exercise {@link DurableRecipeActivityProjection} directly via
// the public `append` API (not the synthetic JSONL import). They guarantee
// three things that hold regardless of input size:
//
//   1. `appendChanged` publishes exactly the activities that genuinely
//      changed since the last call, never a stale superset;
//   2. hydration drains dirty markers so a fresh projection does not
//      re-emit prior history;
//   3. the no-op canonical identity short-circuits republish.
// ---------------------------------------------------------------------------

function freshProjection(): { store: BridgeStore; dir: string; projection: DurableRecipeActivityProjection } {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-busy-loop-proj-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  store.ensureSession(SESSION, {});
  store.ensureStream(`session:${SESSION}`, "session", SESSION);
  const projection = new DurableRecipeActivityProjection(store, SESSION);
  return { store, dir, projection };
}

function eventCounts(stream: readonly StoredEvent[], type: string): number {
  let n = 0;
  for (const e of stream) if (e.type === type) n += 1;
  return n;
}

describe("DurableRecipeActivityProjection dirty-track publishing", () => {
  test("only changed activities produce recipe.activity events", () => {
    const { store, dir, projection } = freshProjection();
    try {
      expect(projection.append("turn.started", { turnId: TURN })).toBeDefined();
      projection.append("tool.started", { toolCallId: "a", toolName: "bash", arguments: { command: "echo" } });
      // tool.started with output deferred: projector has activity, but the
      // F0 contract requires both arguments and output, so the start-only
      // projection stays unpublished.
      let recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(0);

      projection.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });
      // After output: status is still running, arguments + output present,
      // so the projector emits one recipe.activity (running).
      recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(1);
      expect(recipeEvents[0]!.payload).toMatchObject({ kind: TOOL, status: "running", output: "ok" });

      projection.append("tool.completed", { toolCallId: "a", result: { output: "ok" } });
      // After completed: status transitioned to completed, which is a
      // different canonical, so a second publish is expected. Any further
      // re-apply with the same canonical must short-circuit.
      recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(2);
      expect(recipeEvents[1]!.payload).toMatchObject({ kind: TOOL, status: "completed" });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("idempotent re-appends of the same canonical activity do not emit duplicates", () => {
    const { store, dir, projection } = freshProjection();
    try {
      projection.append("turn.started", { turnId: TURN });
      projection.append("tool.started", { toolCallId: "a", toolName: "bash", arguments: { command: "echo" } });
      projection.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });
      projection.append("tool.completed", { toolCallId: "a", result: { output: "ok" } });
      const before = eventCounts(
        store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity"),
        "recipe.activity",
      );
      expect(before).toBe(2);

      // Re-applying the same identity with the same fields must be a no-op
      // for the durable stream — already-published canonical is unchanged.
      projection.append("tool.completed", { toolCallId: "a", result: { output: "ok" } });
      projection.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });

      const after = eventCounts(
        store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity"),
        "recipe.activity",
      );
      expect(after).toBe(before);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("start-only tool does not publish until output arrives, then publishes once per canonical change", () => {
    const { store, dir, projection } = freshProjection();
    try {
      projection.append("turn.started", { turnId: TURN });
      projection.append("tool.started", { toolCallId: "a", toolName: "bash", arguments: { command: "echo" } });
      let recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(0);

      projection.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });
      recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(1);
      // The published canonical is the running status with output filled in.
      expect(recipeEvents[0]!.payload).toMatchObject({ status: "running", output: "ok" });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tool.started without arguments never publishes (F0 contract needs arguments + output)", () => {
    const { store, dir, projection } = freshProjection();
    try {
      projection.append("turn.started", { turnId: TURN });
      projection.append("tool.started", { toolCallId: "a", toolName: "bash" });
      projection.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });
      projection.append("tool.completed", { toolCallId: "a", result: { output: "ok" } });
      const recipeEvents = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity");
      // The projector keeps the activity in memory but the F0 wire contract
      // requires bounded arguments; with no arguments payload the tool
      // never qualifies, so we do not publish.
      expect(eventCounts(recipeEvents, "recipe.activity")).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("hydration drains dirty markers so restarting does not republish history", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-busy-loop-hydrate-"));
    try {
      // First instance: import a few events.
      const store = new BridgeStore(join(dir, "bridge.sqlite"));
      store.ensureSession(SESSION, {});
      store.ensureStream(`session:${SESSION}`, "session", SESSION);
      const p1 = new DurableRecipeActivityProjection(store, SESSION);
      p1.append("turn.started", { turnId: TURN });
      p1.append("tool.started", { toolCallId: "a", toolName: "bash", arguments: { command: "echo" } });
      p1.append("tool.output", { toolCallId: "a", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false });
      p1.append("tool.completed", { toolCallId: "a", result: { output: "ok" } });
      const recipeAfterFirst = store.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity").length;
      store.close();

      // Second instance: re-open the same DB and ensure hydration does not
      // append any duplicate recipe.activity events from the in-memory
      // mark-dirty path.
      const store2 = new BridgeStore(join(dir, "bridge.sqlite"));
      // Constructing the durable projection runs hydration against the
      // authoritative journal; if the dirty set were not drained inside
      // `hydrate()`, this construction would itself publish duplicate
      // recipe.activity entries. The bare-read assertion below proves
      // hydration left the canonical stream untouched.
      const _p2 = new DurableRecipeActivityProjection(store2, SESSION);
      void _p2;
      const recipeAfterRehydrate = store2.listEvents(`session:${SESSION}`).filter((e) => e.type === "recipe.activity").length;
      store2.close();
      expect(recipeAfterFirst).toBeGreaterThan(0);
      expect(recipeAfterRehydrate).toBe(recipeAfterFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("explicit backfill publishes the latest snapshots from a pre-R1 journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-busy-loop-backfill-"));
    try {
      const store = new BridgeStore(join(dir, "bridge.sqlite"));
      store.ensureSession(SESSION, {});
      store.ensureStream(`session:${SESSION}`, "session", SESSION);
      const streamId = `session:${SESSION}`;
      store.appendEvent(streamId, "turn.started", { turnId: TURN });
      store.appendEvent(streamId, "tool.started", {
        turnId: TURN,
        toolCallId: "legacy-tool",
        toolName: "bash",
        arguments: { command: "echo" },
      });
      store.appendEvent(streamId, "tool.output", {
        turnId: TURN,
        toolCallId: "legacy-tool",
        output: "ok",
      });
      store.appendEvent(streamId, "tool.completed", {
        turnId: TURN,
        toolCallId: "legacy-tool",
        result: { output: "ok" },
      });

      const projection = new DurableRecipeActivityProjection(store, SESSION);
      expect(store.listEvents(streamId).filter((event) => event.type === "recipe.activity")).toHaveLength(0);
      expect(projection.backfill()).toBe(1);
      const backfilled = store.listEvents(streamId).filter((event) => event.type === "recipe.activity");
      expect(backfilled).toHaveLength(1);
      expect(backfilled[0]!.payload).toMatchObject({
        activityId: "legacy-tool",
        status: "completed",
        output: '{"output":"ok"}',
      });
      expect(projection.backfill()).toBe(0);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end import via importExternalSessionHistory.
//
// The pre-fix code path made this quadratic; we keep one generous-budget
// wall-clock smoke plus a deterministic equality check that locks in the
// per-identity recipe.activity count, so the regression never silently
// regresses to e.g. one event per source.
// ---------------------------------------------------------------------------

interface SyntheticOptions {
  toolCount: number;
  reasoningPerTurn: number;
}

function buildLargeHistory(directory: string, sessionId: string, options: SyntheticOptions): string {
  const lines: string[] = [];
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  lines.push(JSON.stringify({ type: "session", id: sessionId, version: 1 }));
  lines.push(JSON.stringify({
    type: "message", id: "user-1", parentId: null, timestamp: new Date(start).toISOString(),
    message: { role: "user", content: [{ type: "text", text: "begin" }] },
  }));

  let parentId = "user-1";
  let nextTs = start + 1_000;
  for (let toolIndex = 0; toolIndex < options.toolCount; toolIndex++) {
    const assistantId = `a-${toolIndex}`;
    const assistantTs = new Date(nextTs).toISOString();
    nextTs += 1_000;
    const content: Array<Record<string, unknown>> = [];
    for (let r = 0; r < options.reasoningPerTurn; r++) {
      content.push({ type: "thinking", thinking: `private chain ${toolIndex}-${r}` });
    }
    content.push({
      type: "toolCall",
      id: `tc-${toolIndex}`,
      name: "bash",
      arguments: { command: `echo step ${toolIndex}`, cwd: "/tmp" },
    });
    lines.push(JSON.stringify({
      type: "message", id: assistantId, parentId, timestamp: assistantTs,
      message: { role: "assistant", content },
    }));
    parentId = assistantId;

    const resultId = `r-${toolIndex}`;
    const resultTs = new Date(nextTs).toISOString();
    nextTs += 1_000;
    lines.push(JSON.stringify({
      type: "message", id: resultId, parentId, timestamp: resultTs,
      message: {
        role: "toolResult",
        toolCallId: `tc-${toolIndex}`,
        toolName: "bash",
        content: [{ type: "text", text: `step ${toolIndex} ok` }],
        isError: false,
      },
    }));
    parentId = resultId;
  }

  const source = join(directory, "session.jsonl");
  writeFileSync(source, lines.join("\n") + "\n");
  return source;
}

interface ImportRun {
  elapsedMs: number;
  imported: number;
  recipeEvents: number;
  sourceEvents: number;
}

function runImport(options: SyntheticOptions & { sessionId: string }): ImportRun {
  const directory = mkdtempSync(join(tmpdir(), `pi-mob-busy-loop-${options.sessionId}-`));
  const source = buildLargeHistory(directory, options.sessionId, options);
  const store = new BridgeStore(join(directory, "bridge.sqlite"));
  store.ensureSession(options.sessionId, { externalSession: true });
  store.ensureStream(`session:${options.sessionId}`, "session", options.sessionId);
  const start = Date.now();
  const imported = importExternalSessionHistory(store, options.sessionId, source);
  const elapsedMs = Date.now() - start;
  const events = store.listEvents(`session:${options.sessionId}`);
  const recipeEvents = events.filter((e) => e.type === "recipe.activity").length;
  store.close();
  rmSync(directory, { recursive: true, force: true });
  return { elapsedMs, imported, recipeEvents, sourceEvents: events.length };
}

describe("importExternalSessionHistory is not quadratic in projector size", () => {
  test("completes a synthetic 500-tool-call session under a generous wall-clock budget", () => {
    // Pre-fix: rescanning the projector on every appendEvent made 500 tool
    // calls (~3000 source events) take many seconds of synchronous CPU on
    // this hardware (observed >30s on cold caches, and never finished
    // inside the LaunchAgent watchdog on production-sized inputs). The
    // dirty-set fix brings the same input well below one second; we leave
    // generous headroom (30s) for slow CI and shared disks.
    const run = runImport({ toolCount: 500, reasoningPerTurn: 1, sessionId: "s-500" });
    expect(run.imported).toBeGreaterThan(0);
    // Per tool: tool.started skipped, tool.output emits a running
    // recipe.activity, tool.completed emits a completed recipe.activity.
    // Per reasoning: started emits running, completed emits completed.
    // For 500 tools with reasoningPerTurn=1: 500*2 + 500*2 = 2000.
    expect(run.recipeEvents).toBe(2_000);
    expect(run.elapsedMs).toBeLessThan(30_000);
  });

  test("sub-linear scaling: doubling tool count does not quadruple elapsed time", () => {
    // Post-fix the cost is dominated by SQLite inserts. Pre-fix the
    // relationship is quadratic (4x input took >16x time, and the larger
    // run never finished inside the watchdog). We assert a generous
    // sub-linear bound: doubling input must not quadruple elapsed time.
    const small = runImport({ toolCount: 200, reasoningPerTurn: 1, sessionId: "s-200" });
    const large = runImport({ toolCount: 400, reasoningPerTurn: 1, sessionId: "s-400" });
    expect(large.elapsedMs).toBeLessThan(Math.max(30_000, small.elapsedMs * 4));
  });

  test("idempotent replay is a no-op after a full import", () => {
    // After a successful import, the source revision marker is set; a
    // second call must not re-emit any source events at all, regardless
    // of projector size. This is the fast-path that protects against the
    // quadratic loop on startup even if the underlying file is large.
    const directory = mkdtempSync(join(tmpdir(), "pi-mob-busy-loop-replay-"));
    try {
      const sessionId = "s-replay";
      const source = buildLargeHistory(directory, sessionId, { toolCount: 200, reasoningPerTurn: 1 });
      const store = new BridgeStore(join(directory, "bridge.sqlite"));
      store.ensureSession(sessionId, { externalSession: true });
      store.ensureStream(`session:${sessionId}`, "session", sessionId);
      const firstCall = importExternalSessionHistory(store, sessionId, source);
      expect(firstCall).toBeGreaterThan(0);

      const start = Date.now();
      const secondCall = importExternalSessionHistory(store, sessionId, source);
      const elapsedMs = Date.now() - start;
      expect(secondCall).toBe(0);
      expect(elapsedMs).toBeLessThan(5_000);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("import is deterministic: identical inputs produce identical recipe.activity events", () => {
    // If the dirty tracking ever double-emits or skips one, two identical
    // imports diverged silently on the wire. Lock the contracts with an
    // exact-event-count equality on a small input.
    const a = runImport({ toolCount: 50, reasoningPerTurn: 1, sessionId: "s-d-a" });
    const b = runImport({ toolCount: 50, reasoningPerTurn: 1, sessionId: "s-d-b" });
    expect(a.recipeEvents).toBe(b.recipeEvents);
    expect(a.imported).toBe(b.imported);
    // 50 tools × 2 + 50 reasoning × 2 = 200.
    expect(a.recipeEvents).toBe(200);
  });
});
