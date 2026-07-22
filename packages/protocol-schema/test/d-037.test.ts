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
  FileNodeSchema,
  FILES_CAPABILITY,
  LIMITS,
  RESPONSE_TYPES,
  ResponseSchema,
  SUPPORTED_CAPABILITIES,
  TokenUsageSchema,
  WorkspacePathSchema,
  WORKSPACE_PATH_PATTERN,
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
    "workspace.tree.page.result": { workspaceId, rootRevision: "tree-r1", items: [{ path: "src/index.ts", kind: "file", depth: 0 }] },
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
  // The `foo/./bar` and `foo/../bar` traversals are rejected by the precise
  // segment check (a literal `.` or `..` segment is forbidden anywhere in
  // the path). They reach the union boundary as `workspace.file.metadata`
  // because that control exposes the `WorkspacePathSchema` directly.
  expect(controls.Check({ ...controlEnvelope, type: "workspace.file.metadata", payload: { workspaceId, path: "foo/./bar" } })).toBe(false);
  expect(controls.Check({ ...controlEnvelope, type: "workspace.file.metadata", payload: { workspaceId, path: "foo/../bar" } })).toBe(false);
  // Dotfiles like `.git/config` remain valid because the segment check
  // rejects only an exact `.` or `..` segment — not any path that happens
  // to contain a leading dot.
  expect(controls.Check({ ...controlEnvelope, type: "workspace.file.metadata", payload: { workspaceId, path: ".git/config" } })).toBe(true);
  expect(controls.Check({ ...controlEnvelope, type: "workspace.tree.page", payload: { workspaceId, pageSize: LIMITS.maxTreePageItems + 1, pageToken: null } })).toBe(false);
  expect(responses.Check({
    ...responseEnvelope,
    type: "workspace.tree.page.result",
    payload: { workspaceId, rootRevision: "tree-r1", items: Array.from({ length: LIMITS.maxTreePageItems + 1 }, (_, i) => ({ path: `f${i}`, kind: "file", depth: 0 })) },
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

test("D-037 restored commands retry.auto.set / retry.abort / extension.respond are wired back into COMMAND_TYPES", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  for (const type of ["retry.auto.set", "retry.abort", "extension.respond"] as const) {
    expect(COMMAND_TYPES).toContain(type);
  }
  // Valid payloads, with the required lease envelope for session commands.
  const retrySet = { ...commandEnvelope, type: "retry.auto.set", payload: { sessionId: uuid, enabled: true } };
  const retryAbort = { ...commandEnvelope, type: "retry.abort", payload: { sessionId: uuid } };
  const extensionRespond = {
    ...commandEnvelope,
    type: "extension.respond",
    payload: { sessionId: uuid, dialogId: uuid, response: { value: "ok" } },
  };
  expect(commands.Check(retrySet)).toBe(true);
  expect(commands.Check(retryAbort)).toBe(true);
  expect(commands.Check(extensionRespond)).toBe(true);
  // Session commands require a lease; dropping it is rejected.
  expect(commands.Check({ ...retrySet, leaseId: undefined })).toBe(false);
  expect(commands.Check({ ...retryAbort, leaseId: undefined })).toBe(false);
  expect(commands.Check({ ...extensionRespond, leaseId: undefined })).toBe(false);
  // Missing required payload fields are rejected.
  expect(commands.Check({ ...retrySet, payload: {} })).toBe(false);
  expect(commands.Check({ ...retryAbort, payload: {} })).toBe(false);
  expect(commands.Check({ ...extensionRespond, payload: { sessionId: uuid, dialogId: uuid } })).toBe(false);
  // Metadata shape is preserved (the review repair must not alter the
  // payload/metadata envelope; only COMMAND_TYPES membership is restored).
  for (const type of ["retry.auto.set", "retry.abort", "extension.respond"] as const) {
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

test("D-037 TokenUsageSchema accepts canonical decimal strings and rejects exponent / unsafe numbers", () => {
  const token = TypeCompiler.Compile(TokenUsageSchema);
  // Canonical decimal strings: "0" or a nonzero digit followed by 0..15 more
  // decimal digits (max 16 digits). usagePercent remains a numeric value.
  expect(token.Check({ inputTokens: "0", outputTokens: "0" })).toBe(true);
  expect(token.Check({ inputTokens: "1", outputTokens: "1" })).toBe(true);
  expect(token.Check({ inputTokens: "123", outputTokens: "456" })).toBe(true);
  expect(token.Check({ inputTokens: "9999999999999999", outputTokens: "0" })).toBe(true);
  // Optional decimal fields and a numeric usagePercent are accepted.
  expect(token.Check({
    inputTokens: "0",
    outputTokens: "0",
    cacheReadTokens: "0",
    cacheWriteTokens: "0",
    contextWindowTokens: "0",
    usagePercent: 0.5,
  })).toBe(true);
  // usagePercent stays numeric: a string is rejected, out-of-range is rejected.
  expect(token.Check({ inputTokens: "0", outputTokens: "0", usagePercent: "0.5" })).toBe(false);
  expect(token.Check({ inputTokens: "0", outputTokens: "0", usagePercent: -0.1 })).toBe(false);
  expect(token.Check({ inputTokens: "0", outputTokens: "0", usagePercent: 1.1 })).toBe(false);
  // Number-typed token counts (the legacy `Type.Integer` shape) are rejected:
  // the schema now requires a string so JS Number precision loss is impossible.
  expect(token.Check({ inputTokens: 0, outputTokens: 0 })).toBe(false);
  expect(token.Check({ inputTokens: 1, outputTokens: 1 })).toBe(false);
  // Number.MAX_SAFE_INTEGER+2 as a JS number loses precision; the schema
  // rejects it because token counts must be strings.
  expect(token.Check({ inputTokens: 9007199254740993, outputTokens: 0 })).toBe(false);
  // Exponent notation is rejected: "1e6" is not a canonical decimal string.
  expect(token.Check({ inputTokens: "1e6", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: "1E6", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: "-1", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: "+1", outputTokens: "0" })).toBe(false);
  // Leading zeros (other than the literal "0") are rejected.
  expect(token.Check({ inputTokens: "01", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: "00", outputTokens: "0" })).toBe(false);
  // Decimal points and whitespace are rejected.
  expect(token.Check({ inputTokens: "1.5", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: " 1", outputTokens: "0" })).toBe(false);
  // 17 digits exceeds the max16 cap and is rejected.
  expect(token.Check({ inputTokens: "99999999999999999", outputTokens: "0" })).toBe(false);
  // Empty / null / boolean are rejected.
  expect(token.Check({ inputTokens: "", outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: null, outputTokens: "0" })).toBe(false);
  expect(token.Check({ inputTokens: true, outputTokens: "0" })).toBe(false);
});

test("D-037 WorkspacePathSchema rejects '.' and '..' segments but permits dotfiles like .git", () => {
  const path = TypeCompiler.Compile(WorkspacePathSchema);
  // Dotfiles are valid: the segment check rejects only an exact `.` or
  // exact `..` segment, never a segment that merely starts with a dot.
  expect(path.Check(".git")).toBe(true);
  expect(path.Check(".git/config")).toBe(true);
  expect(path.Check("src/.git/config")).toBe(true);
  expect(path.Check("foo/.hidden")).toBe(true);
  expect(path.Check("a/.b")).toBe(true);
  // Segments that happen to start with `..` but are not exactly `..` are
  // valid — only the literal `..` segment is rejected.
  expect(path.Check("..foo")).toBe(true);
  expect(path.Check("foo..bar")).toBe(true);
  expect(path.Check("foo...bar")).toBe(true);
  // Canonical simple paths.
  expect(path.Check("src")).toBe(true);
  expect(path.Check("src/index.ts")).toBe(true);
  // The two traversals called out in the review are rejected.
  expect(path.Check("foo/./bar")).toBe(false);
  expect(path.Check("foo/../bar")).toBe(false);
  // Same literals at the start and the end are also rejected.
  expect(path.Check(".")).toBe(false);
  expect(path.Check("..")).toBe(false);
  expect(path.Check("./foo")).toBe(false);
  expect(path.Check("../secrets")).toBe(false);
  expect(path.Check("foo/.")).toBe(false);
  expect(path.Check("foo/..")).toBe(false);
  // Absolute paths, backslashes, double slashes, and control characters.
  expect(path.Check("/etc/passwd")).toBe(false);
  expect(path.Check("/")).toBe(false);
  expect(path.Check("foo\\bar")).toBe(false);
  expect(path.Check("\\windows\\path")).toBe(false);
  expect(path.Check("foo//bar")).toBe(false);
  expect(path.Check("foo\u0000bar")).toBe(false);
  expect(path.Check("foo\nbar")).toBe(false);
  expect(path.Check("foo\rbar")).toBe(false);
  // The pattern stays in sync with the schema's published pattern.
  expect(WORKSPACE_PATH_PATTERN).toBe("^(?!/)(?!.*//)(?!.*\\\\)(?!.*(?:^|/)\\.\\.?(?:/|$))[^\\x00-\\x1F\\x7F]{1,1024}$");
});

test("D-037 FileNodeSchema requires depth integer in [0, maxTreeDepth]", () => {
  const node = TypeCompiler.Compile(FileNodeSchema);
  // Boundary values: 0 and the inclusive upper bound (maxTreeDepth = 16).
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: 0 })).toBe(true);
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: LIMITS.maxTreeDepth })).toBe(true);
  // A directory entry carries the same required depth field.
  expect(node.Check({ path: "src", kind: "directory", depth: 1 })).toBe(true);
  // Above the cap: 17 is rejected, even though it's a valid JS integer.
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: LIMITS.maxTreeDepth + 1 })).toBe(false);
  // Negative depth is rejected.
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: -1 })).toBe(false);
  // Missing depth is rejected: the schema marks the field as required.
  expect(node.Check({ path: "src/index.ts", kind: "file" })).toBe(false);
  // Non-integer depth (string, fractional, boolean) is rejected.
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: "0" })).toBe(false);
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: 1.5 })).toBe(false);
  expect(node.Check({ path: "src/index.ts", kind: "file", depth: true })).toBe(false);
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
