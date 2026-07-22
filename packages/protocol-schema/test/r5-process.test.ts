import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  COMMAND_METADATA,
  COMMAND_TYPES,
  CommandSchema,
  CONTROL_TYPES,
  ControlSchema,
  ERROR_CODES,
  ErrorSchema,
  EVENT_STREAM_OWNERSHIP,
  EVENT_TYPES,
  EventSchema,
  LIMITS,
  ProcessOutputSchema,
  ProcessSnapshotSchema,
  RESPONSE_TYPES,
  ResponseSchema,
  SUPPORTED_CAPABILITIES,
} from "../src/index.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-07-15T00:00:00.000Z";
const revision = "process-r1";
const truncation = { retainedBytes: 2, totalBytes: 2, isTruncated: false };

const commandEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid,
  connectionId: uuid, commandId: uuid, leaseId: uuid, sentAt: timestamp,
};
const controlEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid,
  connectionId: uuid, sentAt: timestamp,
};
const responseEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid, sentAt: timestamp,
};
const eventEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, eventId: uuid,
  sentAt: timestamp, streamId: `session:${uuid}`, cursor: "1",
};

function processSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: uuid,
    processId: "process-1",
    revision,
    status: "running",
    command: "bun test",
    startedAt: timestamp,
    capability: "runtime.processes.v1",
    stale: false,
    supportedActions: ["stop"],
    ...overrides,
  };
}

function processOutput(overrides: Record<string, unknown> = {}) {
  return {
    processId: "process-1",
    revision,
    stream: "stdout",
    content: "ok",
    truncation,
    ...overrides,
  };
}

test("R5 registers additive process protocol families without removing established entries", () => {
  expect(COMMAND_TYPES).toEqual(expect.arrayContaining([
    "retry.auto.set", "retry.abort", "extension.respond",
    "context.pin", "context.unpin", "context.exclude", "context.refresh",
    "process.stop", "process.restart", "process.rerun",
  ]));
  expect(EVENT_TYPES).toEqual(expect.arrayContaining([
    "tool.output", "context.snapshot", "context.unavailable",
    "process.snapshot", "process.output", "process.unavailable", "process.error",
  ]));
  expect(CONTROL_TYPES).toEqual(expect.arrayContaining([
    "context.snapshot.request", "process.snapshot.request", "process.output.page",
  ]));
  expect(RESPONSE_TYPES).toEqual(expect.arrayContaining([
    "context.snapshot.result", "process.snapshot.result", "process.output.page.result",
  ]));
  expect(SUPPORTED_CAPABILITIES).toContain("runtime.processes.v1");
  expect(ERROR_CODES).toEqual(expect.arrayContaining([
    "process_unavailable", "process_not_found", "process_stale", "process_failed",
  ]));
});

test("R5 process snapshots cover statuses and authoritative optional runtime fields", () => {
  const snapshots = TypeCompiler.Compile(ProcessSnapshotSchema);
  for (const status of ["running", "completed", "failed", "stopped"]) {
    expect(snapshots.Check(processSnapshot({ status }))).toBe(true);
  }
  expect(snapshots.Check(processSnapshot({
    status: "failed",
    turnId: "turn-1",
    toolCallId: "tool-1",
    pid: 321,
    cwd: "packages/protocol-schema",
    finishedAt: timestamp,
    durationMs: 42,
    exitCode: 1,
    signal: "SIGTERM",
    ports: [{ port: 443, protocol: "tcp" }, { port: 5353, protocol: "udp" }],
    supportedActions: ["restart", "rerun"],
  }))).toBe(true);
  expect(snapshots.Check(processSnapshot({ status: "unknown" }))).toBe(false);
  expect(snapshots.Check(processSnapshot({ capability: "commands.v1" }))).toBe(false);
  expect(snapshots.Check(processSnapshot({ stale: "false" }))).toBe(false);
});

test("R5 process snapshots close fields and enforce identifiers, paths, ports, actions, and scalar bounds", () => {
  const snapshots = TypeCompiler.Compile(ProcessSnapshotSchema);
  const invalid: unknown[] = [
    processSnapshot({ private: "leak" }),
    processSnapshot({ processId: "" }),
    processSnapshot({ processId: "p".repeat(LIMITS.maxProcessIdLength + 1) }),
    processSnapshot({ command: "" }),
    processSnapshot({ command: "x".repeat(LIMITS.maxProcessCommandLength + 1) }),
    processSnapshot({ cwd: "/absolute" }),
    processSnapshot({ cwd: "src/../secret" }),
    processSnapshot({ cwd: "x".repeat(LIMITS.maxProcessCwdLength + 1) }),
    processSnapshot({ pid: 0 }),
    processSnapshot({ durationMs: -1 }),
    processSnapshot({ ports: [{ port: 0, protocol: "tcp" }] }),
    processSnapshot({ ports: [{ port: 65536, protocol: "tcp" }] }),
    processSnapshot({ ports: [{ port: 80, protocol: "http" }] }),
    processSnapshot({ ports: [{ port: 80, protocol: "tcp", private: true }] }),
    processSnapshot({ ports: Array.from({ length: LIMITS.maxProcessPorts + 1 }, () => ({ port: 80, protocol: "tcp" })) }),
    processSnapshot({ supportedActions: ["kill"] }),
    processSnapshot({ supportedActions: ["stop", "stop"] }),
  ];
  for (const value of invalid) expect(snapshots.Check(value)).toBe(false);
  expect(snapshots.Check(processSnapshot({ supportedActions: [] }))).toBe(true);
  expect(snapshots.Check(processSnapshot({ supportedActions: ["stop", "restart", "rerun"] }))).toBe(true);
});

test("R5 keeps stdout and stderr distinct, bounded, revision-bound, paged, and closed", () => {
  const outputs = TypeCompiler.Compile(ProcessOutputSchema);
  const controls = TypeCompiler.Compile(ControlSchema);
  const responses = TypeCompiler.Compile(ResponseSchema);

  for (const stream of ["stdout", "stderr"]) {
    expect(outputs.Check(processOutput({ stream }))).toBe(true);
    expect(controls.Check({ ...controlEnvelope, type: "process.output.page", payload: {
      sessionId: uuid, processId: "process-1", revision, stream, cursor: "9007199254740993", pageToken: "next",
    } })).toBe(true);
    expect(responses.Check({ ...responseEnvelope, type: "process.output.page.result", payload: processOutput({ stream, cursor: "2", pageToken: "next" }) })).toBe(true);
  }
  expect(outputs.Check(processOutput({ stream: "combined" }))).toBe(false);
  expect(outputs.Check(processOutput({ content: "x".repeat(LIMITS.maxProcessOutputLength + 1) }))).toBe(false);
  expect(outputs.Check(processOutput({ private: "leak" }))).toBe(false);
  expect(outputs.Check(processOutput({ truncation: { ...truncation, private: true } }))).toBe(false);
  expect(outputs.Check(processOutput({ cursor: "01" }))).toBe(false);
  expect(controls.Check({ ...controlEnvelope, type: "process.output.page", payload: {
    sessionId: uuid, processId: "process-1", revision, stream: "stdout", private: true,
  } })).toBe(false);
});

test("R5 snapshot reads are bounded and process event payloads are closed session-stream records", () => {
  const controls = TypeCompiler.Compile(ControlSchema);
  const responses = TypeCompiler.Compile(ResponseSchema);
  const events = TypeCompiler.Compile(EventSchema);

  expect(controls.Check({ ...controlEnvelope, type: "process.snapshot.request", payload: { sessionId: uuid } })).toBe(true);
  expect(controls.Check({ ...controlEnvelope, type: "process.snapshot.request", payload: { sessionId: uuid, private: true } })).toBe(false);
  expect(responses.Check({ ...responseEnvelope, type: "process.snapshot.result", payload: { items: [processSnapshot()] } })).toBe(true);
  expect(responses.Check({ ...responseEnvelope, type: "process.snapshot.result", payload: {
    items: Array.from({ length: LIMITS.maxProcessSnapshotItems + 1 }, (_, index) => processSnapshot({ processId: `p-${index}` })),
  } })).toBe(false);
  expect(responses.Check({ ...responseEnvelope, type: "process.snapshot.result", payload: { items: [], private: true } })).toBe(false);

  const payloads = {
    "process.snapshot": processSnapshot(),
    "process.output": processOutput(),
    "process.unavailable": { sessionId: uuid, capability: "runtime.processes.v1", status: { state: "unavailable", reason: "Pi contract absent", remediation: "upgrade Pi" } },
    "process.error": { sessionId: uuid, processId: "process-1", revision, error: { code: "process_failed", message: "failed", retryable: false } },
  } as const;
  for (const [type, payload] of Object.entries(payloads)) {
    expect(EVENT_STREAM_OWNERSHIP[type as keyof typeof EVENT_STREAM_OWNERSHIP]).toBe("session");
    expect(events.Check({ ...eventEnvelope, type, payload })).toBe(true);
    expect(events.Check({ ...eventEnvelope, type, streamId: `host:${uuid}`, payload })).toBe(false);
    expect(events.Check({ ...eventEnvelope, type, payload: { ...payload, private: true } })).toBe(false);
  }
});

test("R5 unavailable status is truthful for every capability state", () => {
  const events = TypeCompiler.Compile(EventSchema);
  for (const state of ["available", "degraded", "unavailable", "stale"] as const) {
    const status = state === "available"
      ? { state }
      : { state, reason: `${state} reason`, remediation: `${state} remediation` };
    expect(events.Check({ ...eventEnvelope, type: "process.unavailable", payload: {
      sessionId: uuid, capability: "runtime.processes.v1", status,
    } })).toBe(true);
  }
  expect(events.Check({ ...eventEnvelope, type: "process.unavailable", payload: {
    sessionId: uuid, capability: "runtime.processes.v1", status: { state: "stale" },
  } })).toBe(false);
  expect(events.Check({ ...eventEnvelope, type: "process.unavailable", payload: {
    sessionId: uuid, capability: "runtime.processes.v1", status: { state: "unavailable", reason: "why", remediation: "fix", private: true },
  } })).toBe(false);
});

test("R5 process actions are durable session commands with lease, revision, metadata, and stable errors", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  for (const type of ["process.stop", "process.restart", "process.rerun"] as const) {
    const message = { ...commandEnvelope, type, payload: {
      sessionId: uuid, processId: "process-1", expectedRevision: revision, lease: "session",
    } };
    expect(commands.Check(message)).toBe(true);
    expect(commands.Check({ ...message, leaseId: undefined })).toBe(false);
    expect(commands.Check({ ...message, payload: { ...message.payload, expectedRevision: undefined } })).toBe(false);
    expect(commands.Check({ ...message, payload: { ...message.payload, private: true } })).toBe(false);
    expect(COMMAND_METADATA.find((entry) => entry.type === type)).toMatchObject({
      scope: "session",
      requiresLeaseId: true,
      requiredCapability: "commands.v1",
      semanticHashFields: ["type", "payload"],
      idempotency: "command-id-semantic-payload-sha256",
    });
  }

  const errors = TypeCompiler.Compile(ErrorSchema);
  for (const code of ["process_unavailable", "process_not_found", "process_stale", "process_failed"]) {
    expect(errors.Check({ ...responseEnvelope, type: "error", payload: {
      code, message: code, retryable: false, details: {},
    } })).toBe(true);
  }
});
