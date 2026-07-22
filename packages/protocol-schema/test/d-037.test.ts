import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  COMMAND_METADATA,
  COMMAND_TYPES,
  CommandSchema,
  CONTEXTS_CAPABILITY,
  ControlSchema,
  CONTROL_TYPES,
  EventSchema,
  EVENT_STREAM_OWNERSHIP,
  EVENT_TYPES,
  FileAttachmentReferenceSchema,
  FILES_CAPABILITY,
  LIMITS,
  RESPONSE_TYPES,
  ResponseSchema,
  SUPPORTED_CAPABILITIES,
} from "../src/index.ts";

const uuid = "11111111-1111-1111-1111-111111111111";
const workspaceId = "22222222-2222-2222-2222-222222222222";
const timestamp = "2026-07-15T00:00:00.000Z";
const revision = "file-r1";
const file = {
  path: "src/index.ts",
  size: 12,
  isBinary: false,
  modifiedAt: timestamp,
  revision,
  lastReadAt: timestamp,
};
const available = { state: "available" as const };
const unavailable = { state: "unavailable" as const, reason: "not configured", remediation: "enable the capability" };

const controlEnvelope = {
  protocol: { major: 1, minor: 0 },
  messageId: uuid,
  requestId: uuid,
  connectionId: uuid,
  sentAt: timestamp,
};
const responseEnvelope = {
  protocol: { major: 1, minor: 0 },
  messageId: uuid,
  requestId: uuid,
  sentAt: timestamp,
};
const eventEnvelope = {
  protocol: { major: 1, minor: 0 },
  messageId: uuid,
  eventId: uuid,
  sentAt: timestamp,
  streamId: `host:${uuid}`,
  cursor: "1",
};
const commandEnvelope = {
  protocol: { major: 1, minor: 0 },
  messageId: uuid,
  requestId: uuid,
  connectionId: uuid,
  commandId: uuid,
  leaseId: uuid,
  sentAt: timestamp,
};

const ref = {
  workspaceId,
  path: "src/index.ts",
  digest: "0".repeat(64),
  revision,
};

function metadataEventPayload() {
  return { workspaceId, file, capability: FILES_CAPABILITY };
}

function responseFileRead() {
  return {
    workspaceId,
    result: {
      path: "src/index.ts",
      revision,
      rangeStart: 1,
      rangeEnd: 1,
      totalLines: 1,
      content: "ok",
      encoding: "utf-8",
      isTruncated: false,
      lastModifiedAt: timestamp,
    },
  };
}

function contextSnapshot() {
  return {
    sessionId: uuid,
    revision: "context-r1",
    source: "session-bridge",
    stale: false,
    capability: available,
    lastRefreshedAt: timestamp,
  };
}

test("D-037 independently advertises optional files.v1 and contexts.v1", () => {
  expect(SUPPORTED_CAPABILITIES).toContain(FILES_CAPABILITY);
  expect(SUPPORTED_CAPABILITIES).toContain(CONTEXTS_CAPABILITY);
  expect(FILES_CAPABILITY).not.toBe(CONTEXTS_CAPABILITY);
});

test("D-037 R3 controls and responses are union-wired, bounded, and workspace-scoped", () => {
  const controls = TypeCompiler.Compile(ControlSchema);
  const responses = TypeCompiler.Compile(ResponseSchema);
  const controlPayloads: Record<string, unknown> = {
    "workspace.tree.page": { workspaceId, path: "src", pageSize: 1, pageToken: null },
    "workspace.file.search": { workspaceId, query: "index", pageSize: 1, pageToken: null },
    "workspace.file.content.search": { workspaceId, query: "needle", pageSize: 1, pageToken: null },
    "workspace.file.metadata": { workspaceId, path: "src/index.ts" },
    "workspace.file.read": { workspaceId, path: "src/index.ts", rangeStart: 1, rangeEnd: 1 },
  };
  const responsePayloads: Record<string, unknown> = {
    "workspace.tree.page.result": { workspaceId, rootRevision: "tree-r1", items: [{ path: "src/index.ts", kind: "file" }] },
    "workspace.file.search.result": { workspaceId, rootRevision: "tree-r1", items: [{ path: "src/index.ts" }] },
    "workspace.file.content.search.result": {
      workspaceId,
      rootRevision: "tree-r1",
      items: [{ path: "src/index.ts", line: 1, column: 1, matchStart: 0, matchLength: 3, lineText: "hey" }],
      isTruncated: false,
    },
    "workspace.file.metadata.result": { workspaceId, file },
    "workspace.file.read.result": responseFileRead(),
  };

  for (const type of Object.keys(controlPayloads)) {
    expect(CONTROL_TYPES).toContain(type as (typeof CONTROL_TYPES)[number]);
    expect(controls.Check({ ...controlEnvelope, type, payload: controlPayloads[type] })).toBe(true);
    expect(controls.Check({ ...controlEnvelope, type, payload: { ...controlPayloads[type] as object, workspaceId: undefined } })).toBe(false);
  }
  for (const type of Object.keys(responsePayloads)) {
    expect(RESPONSE_TYPES).toContain(type as (typeof RESPONSE_TYPES)[number]);
    expect(responses.Check({ ...responseEnvelope, type, payload: responsePayloads[type] })).toBe(true);
  }

  // The schema owns shape and bounds; filesystem canonicalization remains a
  // bridge concern. A traversal-like path and an oversized tree page fail at
  // the union boundary, before a host filesystem is consulted.
  expect(controls.Check({ ...controlEnvelope, type: "workspace.file.metadata", payload: { workspaceId, path: "../secrets" } })).toBe(false);
  expect(controls.Check({ ...controlEnvelope, type: "workspace.tree.page", payload: { workspaceId, pageSize: LIMITS.maxTreePageItems + 1, pageToken: null } })).toBe(false);
  expect(responses.Check({
    ...responseEnvelope,
    type: "workspace.tree.page.result",
    payload: { workspaceId, rootRevision: "tree-r1", items: Array.from({ length: LIMITS.maxTreePageItems + 1 }, (_, i) => ({ path: `f${i}`, kind: "file" })) },
  })).toBe(false);

  // R3 payload objects are closed privacy boundaries, including nested file
  // nodes. No private/debug field can ride along with a visible path.
  expect(responses.Check({
    ...responseEnvelope,
    type: "workspace.file.metadata.result",
    payload: { workspaceId, file: { ...file, private: "leak" } },
  })).toBe(false);
});

test("D-037 four workspace invalidation events are host-owned and require workspaceId", () => {
  const events = TypeCompiler.Compile(EventSchema);
  const payloads: Record<string, unknown> = {
    "workspace.tree.snapshot": { workspaceId, rootRevision: "tree-r2", changeSet: ["src/index.ts"], capability: FILES_CAPABILITY, status: available },
    "workspace.file.metadata": metadataEventPayload(),
    "workspace.file.stale": { workspaceId, path: "src/index.ts", previousRevision: "file-r1", currentRevision: "file-r2", modifiedAt: timestamp, capability: FILES_CAPABILITY },
    "workspace.file.unavailable": { workspaceId, capability: FILES_CAPABILITY, status: unavailable },
  };

  for (const type of Object.keys(payloads)) {
    expect(EVENT_TYPES).toContain(type as (typeof EVENT_TYPES)[number]);
    expect(EVENT_STREAM_OWNERSHIP[type as keyof typeof EVENT_STREAM_OWNERSHIP]).toBe("host");
    expect(events.Check({ ...eventEnvelope, type, payload: payloads[type] })).toBe(true);
    const withoutWorkspace = { ...payloads[type] as object };
    delete (withoutWorkspace as Record<string, unknown>).workspaceId;
    expect(events.Check({ ...eventEnvelope, type, payload: withoutWorkspace })).toBe(false);
    expect(events.Check({ ...eventEnvelope, type, streamId: `session:${uuid}`, payload: payloads[type] })).toBe(false);
  }
});

test("D-037 only the context snapshot is a read control/response", () => {
  const controls = TypeCompiler.Compile(ControlSchema);
  const responses = TypeCompiler.Compile(ResponseSchema);
  const snapshotControl = { ...controlEnvelope, type: "context.snapshot.request", payload: { sessionId: uuid } };
  const snapshotResponse = { ...responseEnvelope, type: "context.snapshot.result", payload: contextSnapshot() };
  expect(controls.Check(snapshotControl)).toBe(true);
  expect(responses.Check(snapshotResponse)).toBe(true);
  for (const type of ["context.pin", "context.unpin", "context.exclude", "context.refresh"] as const) {
    expect(CONTROL_TYPES).not.toContain(type);
    expect(RESPONSE_TYPES).not.toContain(`${type}.result` as (typeof RESPONSE_TYPES)[number]);
    expect(controls.Check({ ...controlEnvelope, type, payload: {} })).toBe(false);
  }
  expect(EVENT_STREAM_OWNERSHIP["context.snapshot"]).toBe("session");
});

test("D-037 context mutations are lease-required session commands with revision-bound targets", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  const target = { path: "src/index.ts", ranges: [{ startLine: 1, endLine: 1 }] };
  for (const type of ["context.pin", "context.unpin", "context.exclude", "context.refresh"] as const) {
    const message = { ...commandEnvelope, type, payload: { sessionId: uuid, expectedRevision: "context-r1", target } };
    expect(COMMAND_TYPES).toContain(type);
    expect(commands.Check(message)).toBe(true);
    expect(commands.Check({ ...message, payload: { ...message.payload, expectedRevision: undefined } })).toBe(false);
    expect(commands.Check({ ...message, payload: { ...message.payload, target: undefined } })).toBe(false);
    expect(commands.Check({ ...message, leaseId: undefined })).toBe(false);
    expect(commands.Check({ ...message, payload: { ...message.payload, target: { path: "src/index.ts", private: "leak" } } })).toBe(false);

    const metadata = COMMAND_METADATA.find((item) => item.type === type);
    expect(metadata).toMatchObject({
      scope: "session",
      requiresLeaseId: true,
      requiredCapability: "commands.v1",
      semanticHashFields: ["type", "payload"],
      idempotency: "command-id-semantic-payload-sha256",
    });
    expect(metadata?.acceptedStates.length).toBeGreaterThan(0);
  }
});

test("D-037 fileRefs are revision-bound and individually bounded; bridge owns the joint cap", () => {
  const references = TypeCompiler.Compile(FileAttachmentReferenceSchema);
  const commands = TypeCompiler.Compile(CommandSchema);
  const prompt = (attachmentIds: string[], fileRefs?: unknown[]) => ({
    ...commandEnvelope,
    type: "prompt.submit",
    payload: { sessionId: uuid, deliveryMode: "immediate", message: "attach", attachmentIds, ...(fileRefs === undefined ? {} : { fileRefs }) },
  });
  expect(references.Check(ref)).toBe(true);
  expect(references.Check({ ...ref, revision: undefined })).toBe(false);
  expect(references.Check({ ...ref, private: "leak" })).toBe(false);
  expect(commands.Check(prompt([], [ref, ref, ref, ref]))).toBe(true);
  expect(commands.Check(prompt([], [ref, ref, ref, ref, ref]))).toBe(false);
  expect(commands.Check(prompt([uuid, uuid, uuid, uuid], [ref]))).toBe(true);
  // This deliberately passes the schema: each list is within its own four
  // item bound. The bridge MUST reject it semantically because 4 + 1 exceeds
  // LIMITS.maxAttachmentsPerPrompt; both lists remain in the command hash.
  expect(LIMITS.maxAttachmentsPerPrompt).toBe(4);
  expect(commands.Check(prompt([uuid, uuid, uuid, uuid], [ref]))).toBe(true);
});
