import { expect, test } from "bun:test";
import { COMMAND_METADATA, COMMAND_TYPES, EVENT_STREAM_OWNERSHIP, EVENT_TYPES, compareDecimalCursors, canonicalSemanticCommand, semanticCommandSha256, validateFixture } from "../src/index.ts";

test("compares arbitrary precision decimal string cursors", () => {
  expect(compareDecimalCursors("9007199254740992", "9007199254740991")).toBe(1);
  expect(compareDecimalCursors("0", "0")).toBe(0);
  expect(() => compareDecimalCursors("01", "1")).toThrow(TypeError);
});

test("cursor comparison and fixture validation never crash on malformed inputs", () => {
  const malformed: unknown[] = [null, true, 1, "{}", [], {}, { valid: true }, { kind: "event", message: [] }];
  for (let index = 0; index < 100; index += 1) {
    malformed.push({
      name: `fuzz-${index}`,
      kind: index % 2 === 0 ? "event" : index,
      valid: index % 3 === 0,
      message: { cursor: index, payload: index % 5 === 0 ? null : { nested: [index] } },
    });
  }
  for (const value of malformed) expect(() => validateFixture(value)).not.toThrow();
});

test("serializes semantic commands with sorted keys and stable SHA-256", () => {
  const command = { type: "session.rename" as const, payload: { z: "café", a: [true, null] } };
  expect(canonicalSemanticCommand(command)).toBe('{"payload":{"a":[true,null],"z":"café"},"type":"session.rename"}');
  expect(semanticCommandSha256(command)).toBe("61a4c2925392bd0ca42625e716e0af099c8028131e9860701172549a99689c35");

  const decomposedKey = { type: "session.rename", payload: { ["e\u0301"]: "preserved", z: "cafe\u0301" } };
  expect(canonicalSemanticCommand(decomposedKey)).toBe('{"payload":{"z":"café","é":"preserved"},"type":"session.rename"}');
  expect(semanticCommandSha256(decomposedKey)).toBe("292a5206c553991fc8a658a397500ec796dae2e219bc9af9b7da06567953162d");
  const ringKey = { type: "session.rename", payload: { ["A\u030A"]: "ring" } };
  expect(canonicalSemanticCommand(ringKey)).toBe('{"payload":{"Å":"ring"},"type":"session.rename"}');
  expect(semanticCommandSha256(ringKey)).toBe("4ef2f19a2da657440f00dbee7d00e32df76acc392b09a35b0f774a4c96ca4da2");

  const keys = ["delta", "alpha", "charlie", "bravo"];
  const expected = canonicalSemanticCommand({ type: "property.order", payload: Object.fromEntries(keys.map((key, index) => [key, index])) });
  for (let shift = 0; shift < keys.length; shift += 1) {
    const rotated = [...keys.slice(shift), ...keys.slice(0, shift)].reverse();
    const payload = Object.fromEntries(rotated.map((key) => [key, keys.indexOf(key)]));
    expect(canonicalSemanticCommand({ type: "property.order", payload })).toBe(expected);
  }
});

test("validates fixture labels against compiled TypeBox validators", () => {
  expect(validateFixture({ name: "ok", kind: "event", valid: true, message: { protocol: { major: 1, minor: 0 }, messageId: "11111111-1111-4111-8111-111111111111", eventId: "22222222-2222-4222-8222-222222222222", type: "turn.settled", sentAt: "2026-07-12T00:00:00.000Z", streamId: "session:33333333-3333-4333-8333-333333333333", cursor: "9007199254740992", payload: {} } })).toBe(true);
  expect(validateFixture({ name: "bad", kind: "event", valid: false, message: { cursor: 4 } })).toBe(true);
});

test("requires a history snapshot revision while preserving additive response fields", () => {
  const base = {
    protocol: { major: 1, minor: 0 },
    messageId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    type: "session.history.page.result",
    sentAt: "2026-07-12T00:00:00.000Z",
  };
  expect(validateFixture({ name: "history", kind: "response", valid: true, message: { ...base, payload: { items: [], snapshotRevision: "7", futureField: true } } })).toBe(true);
  expect(validateFixture({ name: "history-missing-revision", kind: "response", valid: false, message: { ...base, payload: { items: [] } } })).toBe(true);
});

test("accepts only explicitly optional additive unknown events", () => {
  const base = { protocol: { major: 1, minor: 0 }, messageId: "11111111-1111-4111-8111-111111111111", eventId: "22222222-2222-4222-8222-222222222222", sentAt: "2026-07-12T00:00:00.000Z", streamId: "session:33333333-3333-4333-8333-333333333333", cursor: "1", type: "future.event" };
  expect(validateFixture({ name: "optional", kind: "event", valid: true, message: { ...base, payload: { optional: true } } })).toBe(true);
  expect(validateFixture({ name: "required", kind: "event", valid: false, message: { ...base, payload: { optional: false } } })).toBe(true);
});

test("declares mutation recovery/idempotency and exact event stream ownership", () => {
  expect(COMMAND_METADATA.map(({ type }) => type)).toEqual([...COMMAND_TYPES]);
  for (const command of COMMAND_METADATA) {
    expect(command.requiredCapability).toBe("commands.v1");
    expect(command.acceptedStates.length).toBeGreaterThan(0);
    expect(command.semanticHashFields).toEqual(["type", "payload"]);
    expect(command.idempotency).toBe("command-id-semantic-payload-sha256");
    expect(command.recovery).toBe("accepted-undispatched-dispatch-once;running-at-crash-indeterminate");
    expect(command.journaledEffects).toEqual(["command.state"]);
    expect(command.stableErrors).toContain("idempotency_conflict");
  }
  expect(Object.keys(EVENT_STREAM_OWNERSHIP).sort()).toEqual([...EVENT_TYPES].sort());
  expect(EVENT_STREAM_OWNERSHIP["host.state"]).toBe("host");
  expect(EVENT_STREAM_OWNERSHIP["turn.started"]).toBe("session");
  expect(EVENT_STREAM_OWNERSHIP["command.state"]).toBe("host-or-session");
  expect(EVENT_STREAM_OWNERSHIP["error.event"]).toBe("host-or-session");
});
