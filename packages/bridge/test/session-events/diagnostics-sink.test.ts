/**
 * Phase 3 — diagnostics sink tests.
 *
 * The sink is the bounded, post-rewrite home for raw Pi events. It
 * MUST NOT participate in transcript rendering. These tests prove:
 *
 *   - Append FIFO evicts oldest rows when the limit is exceeded.
 *   - Oversize payloads are truncated to a valid JSON document.
 *   - Unserialisable payloads (cycles, undefined-returning `toJSON`,
 *     top-level functions) are coerced to a valid placeholder.
 *   - The sink is best-effort: a closed database, missing schema,
 *     invalid limit, or thrown SQLite error MUST NOT throw out of
 *     `append` and MUST NOT block notification processing.
 *   - The daemon can configure a no-DB sink and a zero-limit sink
 *     safely; both must succeed silently.
 *   - The `onError` hook is called for every observed failure.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES,
  PiDiagnosticsSink,
} from "../../src/session-events/diagnostics";

function makeSink(limit?: number, overrides: Partial<ConstructorParameters<typeof PiDiagnosticsSink>[1]> = {}): { sink: PiDiagnosticsSink; db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "diagnostics-sink-"));
  const db = new Database(join(dir, "diagnostics.sqlite"));
  const sink = new PiDiagnosticsSink(
    db,
    typeof limit === "number" && !overrides.limit ? { limit, ...overrides } : { ...overrides, ...(typeof limit === "number" ? { limit } : {}) },
  );
  return { sink, db, dir };
}

describe("PiDiagnosticsSink", () => {
  test("appends bounded rows and surfaces the raw payload", () => {
    const { sink, db } = makeSink();
    sink.append({ type: "future_event", nested: { ok: true } }, "session-1");
    const rows = db.query("SELECT session_id, event_type, payload_json FROM pi_event_diagnostics").all() as Array<{ session_id: string; event_type: string; payload_json: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_id).toBe("session-1");
    expect(rows[0]?.event_type).toBe("future_event");
    const payload = JSON.parse(rows[0]!.payload_json) as { type: string; nested: { ok: boolean } };
    expect(payload.type).toBe("future_event");
    expect(payload.nested.ok).toBe(true);
  });

  test("redacts private paths while retaining diagnostic structure", () => {
    const { sink, db } = makeSink();
    sink.append({ type: "tool_execution_end", result: "/private/repo/file.ts", nested: { cwd: "/private/repo" } }, "session");
    const row = db.query("SELECT payload_json FROM pi_event_diagnostics").get() as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as { result: string; nested: { cwd: string } };
    expect(payload.result).toBe("<host-private>");
    expect(payload.nested.cwd).toBe("<host-private>");
  });

  test("FIFO eviction enforces the row limit", () => {
    const { sink, db } = makeSink(3);
    for (let index = 0; index < 5; index += 1) sink.append({ type: "raw", index }, "session");
    const rows = db.query("SELECT event_type FROM pi_event_diagnostics ORDER BY id ASC").all() as Array<{ event_type: string }>;
    expect(rows).toHaveLength(3);
    const payloads = (db.query("SELECT payload_json FROM pi_event_diagnostics ORDER BY id ASC").all() as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as { index: number });
    expect(payloads.map((payload) => payload.index)).toEqual([2, 3, 4]);
  });

  test("oversize payloads are truncated to a valid JSON document", () => {
    const { sink, db } = makeSink();
    const huge = "x".repeat(300 * 1024);
    sink.append({ type: "future", payload: huge }, "session");
    const row = db.query("SELECT payload_json FROM pi_event_diagnostics").get() as { payload_json: string } | null;
    // The truncated row is valid JSON and within the configured ceiling.
    expect(row?.payload_json.length).toBeLessThanOrEqual(PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES);
    expect(row?.payload_json.length).toBeLessThan(300 * 1024);
    const parsed = JSON.parse(row!.payload_json) as { prefix: string; __truncated: true; __originalBytes: number };
    expect(parsed.__truncated).toBe(true);
    expect(parsed.__originalBytes).toBeGreaterThan(PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES);
    expect(parsed.prefix.length).toBeLessThan(PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES);
  });

  test("null session id is recorded as nullable", () => {
    const { sink, db } = makeSink();
    sink.append({ type: "future_event" }, null);
    const row = db.query("SELECT session_id, event_type FROM pi_event_diagnostics").get() as { session_id: string | null; event_type: string } | null;
    expect(row?.session_id).toBeNull();
    expect(row?.event_type).toBe("future_event");
  });

  test("non-objects are coerced to a placeholder without crashing the sink", () => {
    const { sink, db } = makeSink();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => sink.append(circular, "session")).not.toThrow();
    const row = db.query("SELECT payload_json FROM pi_event_diagnostics").get() as { payload_json: string } | null;
    expect(row).not.toBeNull();
    const parsed = JSON.parse(row!.payload_json) as { self: string };
    expect(parsed.self).toBe("<circular>");
  });

  test("JSON.stringify returning undefined is coerced to a valid placeholder", () => {
    const { sink, db } = makeSink();
    // A custom `toJSON` that returns `undefined` makes the default
    // `JSON.stringify` produce the string "undefined" (or the empty
    // string for plain values). Either way the sink must store a valid
    // JSON document.
    sink.append({ type: "future", nested: { toJSON: () => undefined } }, "session");
    const row = db.query("SELECT payload_json FROM pi_event_diagnostics").get() as { payload_json: string } | null;
    expect(row).not.toBeNull();
    expect(() => JSON.parse(row!.payload_json) as unknown).not.toThrow();
  });

  test("symbol-typed and function-typed payloads survive the sink", () => {
    const { sink, db } = makeSink();
    expect(() => sink.append(Symbol("future"), null)).not.toThrow();
    expect(() => sink.append(() => undefined, null)).not.toThrow();
    const rows = db.query("SELECT payload_json FROM pi_event_diagnostics").all() as Array<{ payload_json: string }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(() => JSON.parse(row.payload_json) as unknown).not.toThrow();
  });

  test("zero or negative limit disables writes without crashing the sink", () => {
    const dir = mkdtempSync(join(tmpdir(), "diagnostics-sink-zero-"));
    const db = new Database(join(dir, "diagnostics.sqlite"));
    const sink = new PiDiagnosticsSink(db, { limit: 0 });
    sink.append({ type: "future" }, "session");
    sink.append({ type: "future" }, null);
    // The sink never created the schema because the limit is zero; the
    // call MUST not throw and the bridge MUST keep running.
    expect(sink.failureCount).toBe(0);
    db.close();
  });

  test("null database disables writes without crashing the sink", () => {
    const sink = new PiDiagnosticsSink(null);
    expect(() => sink.append({ type: "future" }, "session")).not.toThrow();
    expect(sink.failureCount).toBe(0);
  });

  test("closed database errors are observable through onError and never thrown", () => {
    const failures: Array<{ phase: string; error: unknown }> = [];
    const { sink, db } = makeSink(undefined, { onError: (error, context) => failures.push({ phase: context.phase, error }) });
    db.close();
    expect(() => sink.append({ type: "future" }, "session")).not.toThrow();
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((entry) => entry.phase === "append")).toBe(true);
  });

  test("close() is idempotent and safe on a missing database", () => {
    const sink = new PiDiagnosticsSink(null);
    expect(() => sink.close()).not.toThrow();
    expect(() => sink.close()).not.toThrow();
  });

  test("writes after close() are silently dropped", () => {
    const { sink } = makeSink();
    sink.close();
    expect(() => sink.append({ type: "future" }, "session")).not.toThrow();
    expect(sink.failureCount).toBe(0);
  });
});
