import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND_TYPES, CONTROL_TYPES, ERROR_CODES, EVENT_TYPES, LIMITS, RESPONSE_TYPES } from "@pi-mob/protocol-schema";

const corpus = resolve(process.env.PROTOCOL_FIXTURES_OUT_DIR ?? new URL("../corpus", import.meta.url).pathname);
const FILE_CONTENT = 'const fixture = true;\n';
const FILE_SIZE = Buffer.byteLength(FILE_CONTENT, "utf8");
const FILE_SHA256 = createHash("sha256").update(FILE_CONTENT, "utf8").digest("hex");
const FILE_LINES = FILE_CONTENT.split(/\r?\n/);
const FILE_LINE_TEXT = FILE_LINES[0] ?? "";
const FILE_LINE_COUNT = FILE_CONTENT.endsWith("\n") ? FILE_LINES.length - 1 : FILE_LINES.length;
const FILE_RANGE = { startLine: 1, endLine: FILE_LINE_COUNT };
const FILE_MATCH = "fixture";
const FILE_MATCH_START = FILE_LINE_TEXT.indexOf(FILE_MATCH);
const uuid = (digit: string): string => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const ids = { messageId: uuid("1"), requestId: uuid("2"), commandId: uuid("3"), eventId: uuid("4"), installationId: uuid("5"), sessionId: uuid("6"), leaseId: uuid("7"), workspaceId: uuid("8") };
const processFixture = {
  processId: "process-fixture",
  revision: "process-r1",
  command: "bun test packages/protocol-fixtures",
  startedAt: "2026-07-12T00:00:01.000Z",
  turnId: "turn-fixture",
  toolCallId: "tool-fixture",
  pid: 4123,
  cwd: "packages/protocol-fixtures",
  ports: [{ port: 4173, protocol: "tcp" }, { port: 5353, protocol: "udp" }],
};
const base = { protocol: { major: 1, minor: 0 }, messageId: ids.messageId, sentAt: "2026-07-12T00:00:00.000Z", payload: {} };
type Kind = "hello" | "command" | "control" | "event" | "response" | "error" | "pairing" | "attachment" | "export";
type FixtureExpectation = "expected-invalid" | "semantic-invalid";
interface Entry { readonly file: string; readonly valid: boolean; readonly kind: Kind; readonly expectation?: FixtureExpectation; }
const entries: Entry[] = [];
function emit(name: string, kind: Kind, valid: boolean, message: unknown, expectation?: FixtureExpectation, semanticExpectation?: Record<string, unknown>): void {
  const file = `${name}.json`;
  writeFileSync(resolve(corpus, file), `${JSON.stringify({ name, kind, valid, message, ...(expectation === undefined ? {} : { expectation }), ...(semanticExpectation === undefined ? {} : { semanticExpectation }) }, null, 2)}\n`);
  entries.push({ file, valid, kind, ...(expectation === undefined ? {} : { expectation }) });
}
function commandEnvelope(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type, payload };
}
function fileReference(revision = "file-r1"): Record<string, unknown> {
  return { workspaceId: ids.workspaceId, path: "src/index.ts", digest: FILE_SHA256, revision };
}
function fileName(prefix: string, type: string): string { return `${prefix}-${type.replaceAll(".", "-")}-valid`; }
function processSnapshot(status: "running" | "completed" | "failed" | "stopped" = "running", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: ids.sessionId,
    ...processFixture,
    status,
    capability: "runtime.processes.v1",
    stale: false,
    supportedActions: status === "running" ? ["stop"] : ["restart", "rerun"],
    ...(status === "running" ? {} : { finishedAt: "2026-07-12T00:00:03.000Z", durationMs: 2000, exitCode: status === "failed" ? 1 : 0 }),
    ...overrides,
  };
}
function processOutput(stream: "stdout" | "stderr" = "stdout", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = stream === "stdout" ? "ok: process completed\n" : "warning: fixture stderr\n";
  return {
    sessionId: ids.sessionId,
    processId: processFixture.processId,
    revision: processFixture.revision,
    stream,
    content,
    truncation: { retainedBytes: Buffer.byteLength(content, "utf8"), totalBytes: Buffer.byteLength(content, "utf8"), isTruncated: false },
    cursor: "9007199254740992",
    pageToken: "page-2",
    ...overrides,
  };
}
function processCommandPayload(): Record<string, unknown> {
  return { sessionId: ids.sessionId, processId: processFixture.processId, expectedRevision: processFixture.revision, lease: "session" };
}
function gitSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspaceId: ids.workspaceId,
    revision: "git-r1",
    repositoryUrl: "https://example.test/pi-mob",
    repository: "pi-mob/pi-mob",
    detached: false,
    branch: "feature/git-ci",
    workingTreeState: "dirty",
    changedCount: 2,
    ahead: 1,
    behind: 0,
    latestCommit: {
      sha: "a".repeat(40),
      message: "Add Git/CI attention protocol",
      author: "Pi Mobile",
      authoredAt: base.sentAt,
      url: "https://example.test/pi-mob/commit/aaa",
    },
    pullRequest: {
      number: 42,
      title: "Add Git/CI attention protocol",
      url: "https://example.test/pi-mob/pull/42",
    },
    ciStatus: { state: "failure" },
    failedChecks: [{
      name: "protocol-schema",
      status: "failure",
      summary: "schema check failed",
      logSummary: "protocol schema generation differs from checked-in artifacts",
      url: "https://example.test/pi-mob/checks/1",
    }],
    supportedActions: ["refresh", "commit_through_pi", "push_through_pi", "open_external"],
    capability: "git-ci.v1",
    lastRefreshedAt: base.sentAt,
    ...overrides,
  };
}
function gitCommandPayload(type: string): Record<string, unknown> {
  const isPush = type === "git.push.request";
  return {
    sessionId: ids.sessionId,
    workspaceId: ids.workspaceId,
    expectedRevision: "git-r1",
    confirmation: {
      confirmationId: isPush ? "confirm-push-1" : "confirm-commit-1",
      summary: isPush ? "Push the current branch through Pi" : "Commit the reviewed changes through Pi",
    },
    summaryHint: isPush ? "Push Git/CI attention protocol" : "Add Git/CI attention protocol",
  };
}
function processUnavailablePayload(): Record<string, unknown> {
  return { sessionId: ids.sessionId, capability: "runtime.processes.v1", status: { state: "unavailable", reason: "Process supervision is not advertised by this host.", remediation: "Upgrade the host bridge or refresh capabilities.", source: "runtime-bridge", revision: "process-r1" } };
}
function processErrorPayload(): Record<string, unknown> {
  return { sessionId: ids.sessionId, processId: processFixture.processId, revision: processFixture.revision, error: { code: "process_failed", message: "The supervised process exited unsuccessfully.", retryable: false, recommendedDelayMs: null } };
}
function commandPayload(type: string): Record<string, unknown> {
  if (type === "controller.acquire" || type === "controller.takeover" || type === "controller.release") return { scope: "session", sessionId: ids.sessionId };
  if (type === "host.display_name.set") return { displayName: "fixture host" };
  if (type === "workspace.trust.approve") return { workspaceId: ids.sessionId, fingerprint: "fixture" };
  if (type === "notification.device.register") return { deviceId: ids.sessionId, platform: "ios", token: "fixture" };
  if (type === "notification.device.unregister") return { deviceId: ids.sessionId };
  if (type === "session.create") return { workspaceId: ids.sessionId, policyMode: "full" };
  if (type === "session.rename") return { sessionId: ids.sessionId, name: "fixture" };
  if (type === "session.policy.set") return { sessionId: ids.sessionId, policyMode: "full" };
  if (type === "session.fork") return { sessionId: ids.sessionId, entryId: "fixture-entry" };
  if (type === "session.export") return { sessionId: ids.sessionId, format: "html" };
  if (type === "prompt.submit") return { sessionId: ids.sessionId, deliveryMode: "immediate", message: "fixture", attachmentIds: [] };
  if (["process.stop", "process.restart", "process.rerun"].includes(type)) return processCommandPayload();
  if (["git.commit.request", "git.push.request"].includes(type)) return gitCommandPayload(type);
  if (type === "context.pin") return { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { kind: "file", path: "src/index.ts", ranges: [FILE_RANGE], revision: "file-r1" } };
  if (type === "context.unpin") return { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { kind: "file", path: "src/index.ts", revision: "file-r1" } };
  if (type === "context.exclude") return { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { kind: "source", sourceId: "source-fixture", revision: "file-r1" } };
  if (type === "context.refresh") return { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { kind: "all" } };
  if (type === "queue.remove") return { sessionId: ids.sessionId, queueItemId: ids.sessionId };
  if (["model.set"].includes(type)) return { sessionId: ids.sessionId, modelId: "fixture" };
  if (["thinking.set"].includes(type)) return { sessionId: ids.sessionId, level: "low" };
  if (["steering_mode.set", "follow_up_mode.set", "compaction.auto.set", "retry.auto.set"].includes(type)) return { sessionId: ids.sessionId, enabled: true };
  if (type === "extension.respond") return { sessionId: ids.sessionId, dialogId: ids.sessionId, response: {} };
  return { sessionId: ids.sessionId };
}
function eventEnvelope(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "9007199254740992", type, payload };
}
function recipeActivity(kind: "thinking" | "tool", extra: Record<string, unknown> = {}): Record<string, unknown> {
  const common = { kind, sessionId: ids.sessionId, turnId: "turn-fixture", activityId: "activity-fixture", ordinal: 0, status: "running", timing: { startedAt: base.sentAt }, title: "Fixture activity" };
  return kind === "thinking" ? { ...common, providerSummary: { kind: "provider_summary", provider: "fixture", model: "fixture-model", summary: "Provider supplied summary" }, ...extra } : { ...common, toolName: "fixture-tool", arguments: "{}", output: "fixture output", ...extra };
}
function capabilityStatus(state: "unavailable" | "stale"): Record<string, unknown> {
  return { state, reason: `fixture ${state}`, remediation: "refresh capability", source: "fixture", revision: "r1" };
}
function planSnapshot(): Record<string, unknown> {
  return { planId: "plan-fixture", revision: "r1", sessionId: ids.sessionId, turnId: "turn-fixture", source: "fixture", stale: false, capability: { state: "available", source: "fixture", revision: "r1" }, steps: ["pending", "running", "completed", "blocked", "skipped"].map((status, i) => ({ stepId: `step-${i}`, title: `Step ${i}`, status })) };
}
function fileMetadata(): Record<string, unknown> {
  return { path: "src/index.ts", size: FILE_SIZE, sha256: FILE_SHA256, isBinary: false, modifiedAt: base.sentAt, revision: "file-r1", lastReadAt: base.sentAt, languageHint: "typescript" };
}
function fileReadResult(): Record<string, unknown> {
  return { path: "src/index.ts", revision: "file-r1", rangeStart: FILE_RANGE.startLine, rangeEnd: FILE_RANGE.endLine, totalLines: FILE_LINE_COUNT, content: FILE_CONTENT, encoding: "utf-8", isTruncated: false, lastModifiedAt: base.sentAt };
}
function contextSnapshot(): Record<string, unknown> {
  const available = { state: "available", source: "session-bridge", revision: "context-r1", lastRefreshedAt: base.sentAt };
  return {
    sessionId: ids.sessionId,
    revision: "context-r1",
    source: "session-bridge",
    stale: false,
    capability: available,
    model: { provider: "fixture-provider", modelId: "fixture-model" },
    thinkingLevel: "low",
    instructions: "Fixture workspace instructions.",
    pinnedFiles: [{ path: "src/index.ts", pinnedAt: base.sentAt, ranges: [FILE_RANGE], revision: "file-r1" }],
    tokenUsage: { inputTokens: "128", outputTokens: "32", cacheReadTokens: "16", cacheWriteTokens: "0", contextWindowTokens: "8192", usagePercent: 0.02 },
    compacted: false,
    sources: [{ sourceId: "source-fixture", sourceKind: "file", summary: "Pinned fixture file", stale: false, capability: available, revision: "file-r1", lastRefreshedAt: base.sentAt }],
    lastRefreshedAt: base.sentAt,
  };
}

function eventPayload(type: string): Record<string, unknown> {
  if (type === "session.summary") return { sessionId: ids.sessionId, runtimeState: "idle", queueCount: 0 };
  if (type === "recipe.unavailable") return { capability: "recipes.v1", status: capabilityStatus("unavailable") };
  if (type === "plan.snapshot") return planSnapshot();
  if (type === "plan.unavailable") return { capability: "plans.v1", status: capabilityStatus("stale") };
  if (type === "workspace.tree.snapshot") return { workspaceId: ids.workspaceId, rootRevision: "tree-r2", changeSet: ["src/index.ts"], capability: "files.v1", status: { state: "available", source: "workspace-index", revision: "tree-r2", lastRefreshedAt: base.sentAt } };
  if (type === "workspace.file.metadata") return { workspaceId: ids.workspaceId, file: fileMetadata(), previousRevision: "file-r0", capability: "files.v1" };
  if (type === "workspace.file.stale") return { workspaceId: ids.workspaceId, path: "src/index.ts", previousRevision: "file-r1", currentRevision: "file-r2", modifiedAt: base.sentAt, capability: "files.v1" };
  if (type === "workspace.file.unavailable") return { workspaceId: ids.workspaceId, capability: "files.v1", status: capabilityStatus("unavailable") };
  if (type === "context.snapshot") return contextSnapshot();
  if (type === "context.unavailable") return { sessionId: ids.sessionId, capability: "contexts.v1", status: capabilityStatus("unavailable") };
  if (type === "process.snapshot") return processSnapshot();
  if (type === "process.output") return processOutput();
  if (type === "process.unavailable") return processUnavailablePayload();
  if (type === "process.error") return processErrorPayload();
  if (type === "git.summary") return gitSummary();
  if (type === "git.unavailable") return { workspaceId: ids.workspaceId, capability: "git-ci.v1", status: { state: "unavailable", reason: "Git provider is not configured", remediation: "Configure the provider and refresh" } };

  if (type === "controller.state") return { scope: "session", sessionId: ids.sessionId, mode: "controller", leaseId: ids.leaseId, installationId: ids.installationId, expiresAt: "2026-07-12T00:00:45.000Z", reclaimableUntil: "2026-07-12T00:01:00.000Z" };
  if (type === "command.state") return { commandId: ids.commandId, commandType: "prompt.submit", state: "accepted", errorCode: null };
  if (type === "tool.output") return { toolCallId: ids.sessionId, retainedBytes: 0, totalBytes: 0, isTruncated: false };
  if (type === "extension.dialog") return { dialogId: ids.sessionId, method: "confirm", expiresAt: "2026-07-12T00:05:00.000Z" };
  if (type === "queue.snapshot") return { items: [] };
  return { sessionId: ids.sessionId };
}
function responsePayload(type: string): Record<string, unknown> {
  if (type === "hello.accepted") return { connectionId: ids.installationId, hostId: ids.sessionId, hostGeneration: "1", hostDisplayName: "fixture", bridgeVersion: "1", piVersion: "1", serverTime: base.sentAt, capabilities: ["streams.v1", "commands.v1", "runtime.processes.v1", "git-ci.v1"], limits: { maxJsonBytes: 1048576, maxAttachmentBytes: 10485760, maxAttachmentsPerPrompt: 4, maxPromptAttachmentBytes: 26214400, maxQueuedFollowUps: 10, maxSessionPageSize: 100, maxBackgroundSessionSubscriptions: 5 } };
  if (type === "subscription.accepted") return { streams: [{ streamId: `host:${ids.sessionId}`, mode: "replay" }] };
  if (type === "stream.sync.complete") return { streamId: `session:${ids.sessionId}`, currentCursor: "1", mode: "replay" };
  if (type === "stream.snapshot.begin") return { snapshotId: ids.sessionId, streamId: `session:${ids.sessionId}`, baselineCursor: "1" };
  if (type === "stream.snapshot.part") return { snapshotId: ids.sessionId, part: 0, items: [] };
  if (type === "stream.snapshot.end") return { snapshotId: ids.sessionId, partCount: 1 };
  if (type === "command.receipt") return { state: "accepted", duplicate: false };
  if (type === "command.current.result") return { commandId: ids.commandId, state: "accepted" };
  if (type === "controller.renew.result") return { leaseId: ids.leaseId, expiresAt: 1784089300000 };
  if (type === "session.list.result" || type === "session.history.page.result") return { items: [], snapshotRevision: "1" };
  if (type === "workspace.tree.page.result") return { workspaceId: ids.workspaceId, rootRevision: "tree-r1", path: "src", items: [{ path: "src/index.ts", kind: "file", depth: 0, size: FILE_SIZE, modifiedAt: base.sentAt, sha256: FILE_SHA256, isBinary: false, languageHint: "typescript" }] };
  if (type === "workspace.file.search.result") return { workspaceId: ids.workspaceId, rootRevision: "tree-r1", items: [{ path: "src/index.ts", matchStart: 4, matchLength: 5 }] };
  if (type === "workspace.file.content.search.result") return { workspaceId: ids.workspaceId, rootRevision: "tree-r1", items: [{ path: "src/index.ts", line: FILE_RANGE.startLine, column: FILE_MATCH_START + 1, matchStart: FILE_MATCH_START, matchLength: FILE_MATCH.length, lineText: FILE_LINE_TEXT }], isTruncated: false };
  if (type === "workspace.file.metadata.result") return { workspaceId: ids.workspaceId, file: fileMetadata() };
  if (type === "workspace.file.read.result") return { workspaceId: ids.workspaceId, result: fileReadResult() };
  if (type === "context.snapshot.result") return contextSnapshot();
  if (type === "process.snapshot.result") return { items: [processSnapshot()] };
  if (type === "process.output.page.result") return processOutput();
  if (type === "git.summary.result") return gitSummary();
  return { items: [] };
}
function controlPayload(type: string): Record<string, unknown> {
  if (type === "subscription.set") return { streams: [{ streamId: `host:${ids.sessionId}`, afterCursor: "1", detail: "full" }] };
  if (type === "cursor.ack") return { cursors: { [`host:${ids.sessionId}`]: "1" } };
  if (type === "controller.renew") return { leaseId: ids.leaseId };
  if (type === "session.snapshot.request") return { sessionId: ids.sessionId };
  if (type === "session.list") return { query: null, sort: "attention_then_activity", pageSize: 100, pageToken: null };
  if (type === "session.history.page") return { sessionId: ids.sessionId, pageSize: 100, pageToken: null };
  if (type === "workspace.search") return { query: "fixture" };
  if (type === "workspace.tree.page") return { workspaceId: ids.workspaceId, path: "src", rootRevision: "tree-r1", pageSize: 1, pageToken: null };
  if (type === "workspace.file.search") return { workspaceId: ids.workspaceId, query: "index", path: "src", pageSize: 1, pageToken: null };
  if (type === "workspace.file.content.search") return { workspaceId: ids.workspaceId, query: "fixture", path: "src", pageSize: 1, pageToken: null };
  if (type === "workspace.file.metadata") return { workspaceId: ids.workspaceId, path: "src/index.ts", expectedRevision: "file-r1" };
  if (type === "workspace.file.read") return { workspaceId: ids.workspaceId, path: "src/index.ts", rangeStart: FILE_RANGE.startLine, rangeEnd: FILE_RANGE.endLine, expectedRevision: "file-r1" };
  if (type === "context.snapshot.request") return { sessionId: ids.sessionId };
  if (type === "process.snapshot.request") return { sessionId: ids.sessionId };
  if (type === "process.output.page") return { sessionId: ids.sessionId, processId: processFixture.processId, revision: processFixture.revision, stream: "stdout", cursor: "9007199254740992", pageToken: "page-2" };
  if (type === "git.summary.request") return { workspaceId: ids.workspaceId };
  if (type === "git.summary.cancel") return { targetRequestId: ids.requestId };
  if (type === "model.list") return { sessionId: ids.sessionId };
  if (type === "command.current") return { commandId: ids.commandId };
  return {};
}
const hostEvents = new Set([
  "host.state", "host.degraded", "host.draining", "host.capacity", "host.backup_state", "host.compatibility",
  "session.summary", "session.removed", "workspace.summary", "workspace.trust_state", "notification.capability",
  "workspace.tree.snapshot", "workspace.file.metadata", "workspace.file.stale", "workspace.file.unavailable",
  "git.summary", "git.unavailable",
]);

rmSync(corpus, { recursive: true, force: true });
mkdirSync(corpus, { recursive: true });
emit("hello-valid", "hello", true, { ...base, requestId: ids.requestId, type: "hello", payload: { mobileVersion: "1.0.0", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: ["runtime.processes.v1", "git-ci.v1", "future.optional"] } });
for (const type of COMMAND_TYPES) emit(fileName("command", type), "command", true, { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type, payload: commandPayload(type) });
for (const type of CONTROL_TYPES) emit(fileName("control", type), "control", true, { ...base, requestId: ids.requestId, connectionId: ids.installationId, type, payload: controlPayload(type) });
for (const type of EVENT_TYPES) emit(fileName("event", type), "event", true, { ...base, eventId: ids.eventId, streamId: `${hostEvents.has(type) ? "host" : "session"}:${ids.sessionId}`, cursor: "9007199254740992", type, payload: type === "recipe.activity" ? recipeActivity("thinking") : type === "recipe.unavailable" ? { capability: "recipes.v1", status: capabilityStatus("unavailable") } : type === "plan.snapshot" ? planSnapshot() : type === "plan.unavailable" ? { capability: "plans.v1", status: capabilityStatus("stale") } : eventPayload(type) });
for (const type of RESPONSE_TYPES) emit(fileName("response", type), "response", true, { ...base, requestId: ids.requestId, ...(type === "command.receipt" ? { commandId: ids.commandId } : {}), type, payload: responsePayload(type) });
for (const code of ERROR_CODES) emit(`error-${code.replaceAll("_", "-")}-valid`, "error", true, { ...base, requestId: ids.requestId, type: "error", payload: { code, message: "safe protocol error", retryable: false, details: {} } });
emit("pairing-valid", "pairing", true, { kind: "pi-mob-host", version: 1, hostId: ids.sessionId, displayName: "fixture host", endpoint: "https://fixture-host.example", protocolMajor: 1 });
emit("recipe-thinking-tool-valid", "event", true, eventEnvelope("recipe.activity", recipeActivity("thinking")));
emit("recipe-tool-valid", "event", true, eventEnvelope("recipe.activity", recipeActivity("tool")));
emit("recipe-unavailable-valid", "event", true, eventEnvelope("recipe.unavailable", { capability: "recipes.v1", status: capabilityStatus("unavailable") }));
emit("plan-snapshot-all-statuses-valid", "event", true, eventEnvelope("plan.snapshot", planSnapshot()));
emit("plan-unavailable-stale-valid", "event", true, eventEnvelope("plan.unavailable", { capability: "plans.v1", status: capabilityStatus("stale") }));
emit("process-snapshot-completed-valid", "event", true, eventEnvelope("process.snapshot", processSnapshot("completed")));
emit("process-output-stderr-valid", "event", true, eventEnvelope("process.output", processOutput("stderr")));
emit("process-unavailable-valid", "event", true, eventEnvelope("process.unavailable", processUnavailablePayload()));
emit("process-error-valid", "event", true, eventEnvelope("process.error", processErrorPayload()));
emit("prompt-legacy-valid", "command", true, { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type: "prompt.submit", payload: commandPayload("prompt.submit") });
emit("prompt-steer-plan-target-valid", "command", true, { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type: "prompt.submit", payload: { ...commandPayload("prompt.submit"), deliveryMode: "steer", planTarget: { planId: "plan-fixture", stepId: "step-1", revision: "r1" } } });

emit("pairing-invalid-http", "pairing", false, { kind: "pi-mob-host", version: 1, hostId: ids.sessionId, displayName: "fixture host", endpoint: "http://fixture-host.example", protocolMajor: 1 });
emit("attachment-response-valid", "attachment", true, { attachmentId: ids.messageId, sha256: "a".repeat(64), mimeType: "image/png", bytes: 1024, expiresAt: "2026-07-13T00:00:00.000Z" });
emit("export-metadata-valid", "export", true, { exportId: ids.messageId, format: "html", bytes: 1024, sha256: "b".repeat(64), expiresAt: "2026-07-13T00:00:00.000Z" });
emit("tool-output-event-boundary", "event", true, { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "9007199254740993", type: "tool.output", payload: { toolCallId: ids.sessionId, retainedBytes: 262144, totalBytes: 262144, isTruncated: false } });
emit("tool-output-retained-boundary", "event", true, { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "9007199254740994", type: "tool.output", payload: { toolCallId: ids.sessionId, retainedBytes: 5242880, totalBytes: 6291456, digest: "c".repeat(64), isTruncated: true } });
emit("hello-major-mismatch", "hello", false, { ...base, protocol: { major: 2, minor: 0 }, requestId: ids.requestId, type: "hello", payload: { mobileVersion: "1", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] } });
emit("hello-host-mismatch", "hello", true, { ...base, requestId: ids.requestId, type: "hello", payload: { expectedHostId: ids.sessionId, mobileVersion: "1", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] } });
emit("event-unknown-optional-valid", "event", true, { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "1", type: "future.notice", payload: { optional: true } });
emit("stream-expired-cursor", "error", true, { ...base, requestId: ids.requestId, type: "error", payload: { code: "cursor_invalid", message: "cursor expired", retryable: true, details: {} } });
emit("snapshot-failure", "error", true, { ...base, requestId: ids.requestId, type: "error", payload: { code: "snapshot_failed", message: "snapshot failed", retryable: true, details: {} } });
emit("command-semantic-conflict", "error", true, { ...base, requestId: ids.requestId, commandId: ids.commandId, type: "error", payload: { code: "idempotency_conflict", message: "semantic payload changed", retryable: false, details: {} } });
emit("command-metadata-retry", "command", true, { ...base, requestId: ids.eventId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type: "session.rename", payload: { sessionId: ids.sessionId, name: "fixture" } });
const invalid: ReadonlyArray<readonly [string, Kind, unknown]> = [
  ["invalid-cursor-json-number", "event", { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: 9007199254740992, type: "turn.settled", payload: {} }],
  ["invalid-recipe-tool-provider-summary", "event", eventEnvelope("recipe.activity", recipeActivity("tool", { providerSummary: { kind: "provider_summary", provider: "fixture", summary: "not allowed" } }))],
  ["invalid-recipe-private-field", "event", eventEnvelope("recipe.activity", { ...recipeActivity("thinking"), private: "hidden" })],
  ["invalid-recipe-oversize", "event", eventEnvelope("recipe.activity", recipeActivity("tool", { arguments: "x".repeat(241) }))],
  ["invalid-plan-65-steps", "event", eventEnvelope("plan.snapshot", { ...planSnapshot(), steps: Array.from({ length: 65 }, (_, i) => ({ stepId: `step-${i}`, title: "Step", status: "pending" })) })],
  ["invalid-plan-missing-turn-source", "event", eventEnvelope("plan.snapshot", (() => { const { turnId: _turnId, source: _source, ...missing } = planSnapshot(); return missing; })())],
  ["invalid-prompt-plan-target-missing-revision", "command", { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type: "prompt.submit", payload: { ...commandPayload("prompt.submit"), deliveryMode: "steer", planTarget: { planId: "plan-fixture", stepId: "step-1" } } }],

  // R5 focused schema-invalid evidence. Each fixture changes exactly one
  // process invariant while retaining a complete, otherwise-valid payload.
  ["invalid-process-private-field", "event", eventEnvelope("process.snapshot", { ...processSnapshot(), private: "leak" })],
  ["invalid-process-stdout-oversize", "event", eventEnvelope("process.output", processOutput("stdout", { content: "x".repeat(LIMITS.maxProcessOutputLength + 1) }))],
  ["invalid-process-stderr-oversize", "event", eventEnvelope("process.output", processOutput("stderr", { content: "x".repeat(LIMITS.maxProcessOutputLength + 1) }))],
  ["invalid-process-ports-33", "event", eventEnvelope("process.snapshot", processSnapshot("running", { ports: Array.from({ length: LIMITS.maxProcessPorts + 1 }, (_, index) => ({ port: 4000 + index, protocol: "tcp" })) }))],
  ["invalid-process-missing-session", "event", eventEnvelope("process.output", (() => { const { sessionId: _sessionId, ...missing } = processOutput(); return missing; })())],
  ["invalid-process-missing-process", "event", eventEnvelope("process.output", (() => { const { processId: _processId, ...missing } = processOutput(); return missing; })())],
  ["invalid-process-missing-revision", "event", eventEnvelope("process.output", (() => { const { revision: _revision, ...missing } = processOutput(); return missing; })())],
  ["invalid-process-pid", "event", eventEnvelope("process.snapshot", { ...processSnapshot(), pid: 0 })],
  ["invalid-process-status", "event", eventEnvelope("process.snapshot", { ...processSnapshot(), status: "paused" })],
  ["invalid-process-action", "event", eventEnvelope("process.snapshot", { ...processSnapshot(), supportedActions: ["kill"] })],
  ["invalid-process-stream", "event", eventEnvelope("process.output", { ...processOutput(), stream: "combined" })],
  ["invalid-process-host-stream", "event", { ...eventEnvelope("process.snapshot", processSnapshot()), streamId: `host:${ids.sessionId}` }],

  // D-037 focused schema-invalid evidence. Each message is otherwise a
  // complete valid envelope so the labelled invariant is the sole failure.
  ["invalid-workspace-path-traversal", "control", { ...base, requestId: ids.requestId, connectionId: ids.installationId, type: "workspace.tree.page", payload: { ...controlPayload("workspace.tree.page"), path: "src/../private" } }],
  ["invalid-workspace-path-exact-dot", "control", { ...base, requestId: ids.requestId, connectionId: ids.installationId, type: "workspace.tree.page", payload: { ...controlPayload("workspace.tree.page"), path: "." } }],
  ["invalid-workspace-tree-depth-17", "response", { ...base, requestId: ids.requestId, type: "workspace.tree.page.result", payload: { ...responsePayload("workspace.tree.page.result"), items: [{ path: "src/index.ts", kind: "file", depth: LIMITS.maxTreeDepth + 1 }] } }],
  ["invalid-workspace-path-oversize", "control", { ...base, requestId: ids.requestId, connectionId: ids.installationId, type: "workspace.tree.page", payload: { ...controlPayload("workspace.tree.page"), path: "p".repeat(LIMITS.maxWorkspacePathLength + 1) } }],
  ["invalid-workspace-tree-page-size-oversize", "control", { ...base, requestId: ids.requestId, connectionId: ids.installationId, type: "workspace.tree.page", payload: { ...controlPayload("workspace.tree.page"), pageSize: LIMITS.maxTreePageItems + 1 } }],
  ["invalid-workspace-file-size-oversize", "response", { ...base, requestId: ids.requestId, type: "workspace.file.metadata.result", payload: { workspaceId: ids.workspaceId, file: { ...fileMetadata(), size: LIMITS.maxFileSize + 1 } } }],
  ["invalid-workspace-file-read-oversize", "response", { ...base, requestId: ids.requestId, type: "workspace.file.read.result", payload: { workspaceId: ids.workspaceId, result: { ...fileReadResult(), content: "x".repeat(LIMITS.maxFileReadBytes + 1) } } }],
  ["invalid-context-token-decimal-exponent", "event", eventEnvelope("context.snapshot", { ...contextSnapshot(), tokenUsage: { inputTokens: "1e6", outputTokens: "32" } })],
  ["invalid-context-token-17-digit", "event", eventEnvelope("context.snapshot", { ...contextSnapshot(), tokenUsage: { inputTokens: "99999999999999999", outputTokens: "32" } })],
  ["invalid-context-missing-expected-revision", "command", commandEnvelope("context.pin", { sessionId: ids.sessionId, target: { kind: "file", path: "src/index.ts", revision: "file-r1" } })],
  ["invalid-context-missing-target", "command", commandEnvelope("context.pin", { sessionId: ids.sessionId, expectedRevision: "context-r1" })],
  ["invalid-context-target-missing-kind", "command", commandEnvelope("context.pin", { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { path: "src/index.ts", revision: "file-r1" } })],
  ["invalid-workspace-file-metadata-private-field", "response", { ...base, requestId: ids.requestId, type: "workspace.file.metadata.result", payload: { workspaceId: ids.workspaceId, file: { ...fileMetadata(), private: "leak" } } }],
  ["invalid-context-target-private-field", "command", commandEnvelope("context.pin", { sessionId: ids.sessionId, expectedRevision: "context-r1", target: { kind: "file", path: "src/index.ts", revision: "file-r1", private: "leak" } })],
  ["invalid-prompt-file-ref-private-field", "command", commandEnvelope("prompt.submit", { ...commandPayload("prompt.submit"), fileRefs: [{ ...fileReference(), private: "leak" }] })],
  ["invalid-prompt-file-ref-missing-revision", "command", commandEnvelope("prompt.submit", { ...commandPayload("prompt.submit"), fileRefs: [(() => { const { revision: _revision, ...missing } = fileReference(); return missing; })()] })],

  ["invalid-optional-event-type", "event", { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "1", type: "futureNotice", payload: { optional: true } }],
  ["invalid-uppercase-uuid", "command", { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", leaseId: ids.leaseId, type: "session.rename", payload: { sessionId: ids.sessionId, name: "fixture" } }],
  ["invalid-missing-payload", "response", { protocol: base.protocol, messageId: ids.messageId, sentAt: base.sentAt, requestId: ids.requestId, type: "hello.accepted" }],
  ["invalid-negative-protocol-minor", "hello", { ...base, protocol: { major: 1, minor: -1 }, requestId: ids.requestId, type: "hello", payload: { mobileVersion: "1", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["streams.v1"], optionalCapabilities: [] } }],
  ["invalid-unknown-required-capability", "hello", { ...base, requestId: ids.requestId, type: "hello", payload: { mobileVersion: "1", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["unsupported.required"], optionalCapabilities: [] } }],
  ["invalid-page-size-101", "control", { ...base, requestId: ids.requestId, connectionId: ids.installationId, type: "session.list", payload: { query: null, sort: "attention_then_activity", pageSize: 101, pageToken: null } }],
  ["invalid-queue-overflow", "event", { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "1", type: "queue.snapshot", payload: { items: Array.from({ length: 11 }, () => ({})) } }],
  ["invalid-command-optional-field-type", "command", { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, type: "session.create", payload: { workspaceId: ids.sessionId, policyMode: "full", name: 7 } }],
  ["invalid-command-state-missing-error-code", "event", { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "1", type: "command.state", payload: { commandId: ids.commandId, commandType: "prompt.submit", state: "accepted" } }],
  ["invalid-response-page-token-type", "response", { ...base, requestId: ids.requestId, type: "session.list.result", payload: { items: [], snapshotRevision: "1", nextPageToken: 2 } }],
  ["invalid-attachment-oversized", "attachment", { attachmentId: ids.messageId, sha256: "a".repeat(64), mimeType: "image/png", bytes: 10485761, expiresAt: "2026-07-13T00:00:00.000Z" }],
  ["invalid-malformed-envelope", "event", { cursor: "1" }],
];
for (const [name, kind, message] of invalid) {
  const expectation = name.startsWith("invalid-workspace-") || name.startsWith("invalid-context-") || name.startsWith("invalid-prompt-file-ref-") || name.startsWith("invalid-process-")
    ? "expected-invalid"
    : undefined;
  emit(name, kind, false, message, expectation);
}

// These two D-037 messages intentionally pass the raw command schema. Their
// invalidity depends on authoritative bridge state or a sibling-array sum,
// so record semantic-invalid expectations rather than lying with `valid:false`.
emit("semantic-invalid-prompt-file-ref-stale-revision", "command", true,
  commandEnvelope("prompt.submit", { ...commandPayload("prompt.submit"), fileRefs: [fileReference("file-r1")] }),
  "semantic-invalid", { outcome: "rejected", errorCode: "file_stale", currentRevision: "file-r2" });
emit("semantic-invalid-prompt-joint-context-cap", "command", true,
  commandEnvelope("prompt.submit", { ...commandPayload("prompt.submit"), attachmentIds: [uuid("a"), uuid("b"), uuid("c"), uuid("d")], fileRefs: [fileReference()] }),
  "semantic-invalid", { outcome: "rejected", errorCode: "invalid_message", maxCombinedItems: LIMITS.maxAttachmentsPerPrompt });
emit("semantic-invalid-process-stop-unsupported", "command", true,
  commandEnvelope("process.stop", processCommandPayload()),
  "semantic-invalid", { outcome: "rejected", errorCode: "invalid_state", supportedActions: ["restart", "rerun"] });
emit("semantic-invalid-process-stale-revision", "command", true,
  commandEnvelope("process.stop", { ...processCommandPayload(), expectedRevision: "process-r1" }),
  "semantic-invalid", { outcome: "rejected", errorCode: "process_stale", currentRevision: "process-r2" });
emit("semantic-invalid-process-joint-action-state", "command", true,
  commandEnvelope("process.restart", processCommandPayload()),
  "semantic-invalid", { outcome: "rejected", errorCode: "invalid_state", status: "running", supportedActions: ["stop", "restart"] });
emit("future-optional-event", "event", true, { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "9007199254740992", type: "future.event", payload: { optional: true, summary: "safe" } });
emit("future-required-event", "event", false, { ...base, eventId: ids.eventId, streamId: `session:${ids.sessionId}`, cursor: "9007199254740992", type: "future.event", payload: { optional: false } });
emit("future-required-capability-event", "event", false, { ...base, eventId: ids.eventId, streamId: `host:${ids.sessionId}`, cursor: "9007199254740992", type: "future.event", payload: { optional: true, requiredCapabilities: ["unsupported.v1"] } });
for (const [name, type, payload] of [
  ["stream-replay-gap", "turn.started", { expectedCursor: "7", receivedCursor: "9" }], ["stream-duplicate-conflict", "turn.started", { cursor: "9", conflictingEventId: ids.eventId }],
  ["snapshot-multipart", "session.state", { snapshotId: ids.messageId, partCount: 2, baselineCursor: "9007199254740992" }], ["lease-takeover", "controller.state", { scope: "session", sessionId: ids.sessionId, leaseId: ids.leaseId, installationId: ids.installationId, mode: "takeover", expiresAt: "2026-07-12T00:00:45.000Z" }],
  ["command-duplicate", "command.state", { commandId: ids.commandId, commandType: "prompt.submit", state: "accepted", errorCode: null, duplicate: true }], ["command-indeterminate", "turn.indeterminate", { commandId: ids.commandId }],
  ["queue-restart", "queue.snapshot", { items: [] }], ["attachment-boundary", "turn.accepted", { attachmentBytes: 10485760 }], ["export-boundary", "command.state", { commandId: ids.commandId, commandType: "session.export", state: "accepted", errorCode: null, exportId: ids.messageId }],
  ["dialog-expiry", "extension.dialog", { dialogId: ids.sessionId, method: "confirm", expiresAt: "2026-07-12T00:05:00.000Z" }], ["pagination-boundary", "session.summary", { sessionId: ids.sessionId, runtimeState: "idle", queueCount: 0, pageSize: 100 }],
] as const) emit(name, "event", true, { ...base, eventId: ids.eventId, streamId: `${hostEvents.has(type) ? "host" : "session"}:${ids.sessionId}`, cursor: "9007199254740992", type, payload });
interface ScenarioStep { readonly fixture: string; readonly action: string; readonly expect: string; }
function scenarioMessage(action: string): { readonly kind: Kind; readonly valid: boolean; readonly message: Record<string, unknown> } {
  const event = (type: string, payload: Record<string, unknown>): Record<string, unknown> => ({ ...base, eventId: ids.eventId, streamId: `${hostEvents.has(type) ? "host" : "session"}:${ids.sessionId}`, cursor: "9007199254740992", type, payload });
  const command = (type: string, payload: Record<string, unknown>): Record<string, unknown> => ({ ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type, payload });
  const response = (type: string, payload: Record<string, unknown>): Record<string, unknown> => ({ ...base, requestId: ids.requestId, ...(type === "command.receipt" ? { commandId: ids.commandId } : {}), type, payload });
  const error = (code: string): Record<string, unknown> => ({ ...base, requestId: ids.requestId, commandId: ids.commandId, type: "error", payload: { code, message: "scenario error", retryable: false, details: {} } });
  if (action === "pairing.accept") return { kind: "pairing", valid: true, message: { kind: "pi-mob-host", version: 1, hostId: ids.sessionId, displayName: "fixture host", endpoint: "https://fixture-host.example", protocolMajor: 1 } };
  if (action === "pairing.reject_invalid") return { kind: "pairing", valid: false, message: { kind: "pi-mob-host", version: 1, hostId: ids.sessionId, displayName: "fixture host", endpoint: "http://fixture-host.example", protocolMajor: 1 } };
  if (action === "hello.accept" || action === "hello.generation_changed") return { kind: "response", valid: true, message: response("hello.accepted", { ...responsePayload("hello.accepted"), hostGeneration: action.endsWith("changed") ? "2" : "1" }) };
  if (action.startsWith("stream.")) return { kind: "event", valid: true, message: event("turn.started", action === "stream.gap" ? { expectedCursor: "7", receivedCursor: "9" } : action === "stream.conflicting_duplicate" ? { conflictingEventId: ids.messageId } : { sessionId: ids.sessionId }) };
  if (action.startsWith("snapshot.")) {
    if (action === "snapshot.begin") return { kind: "response", valid: true, message: response("stream.snapshot.begin", responsePayload("stream.snapshot.begin")) };
    if (action === "snapshot.part_one" || action === "snapshot.part_two") return { kind: "response", valid: true, message: response("stream.snapshot.part", { snapshotId: ids.sessionId, part: action.endsWith("one") ? 0 : 1, items: [] }) };
    if (action === "snapshot.end") return { kind: "response", valid: true, message: response("stream.snapshot.end", { snapshotId: ids.sessionId, partCount: 2 }) };
    if (action === "snapshot.sync") return { kind: "response", valid: true, message: response("stream.sync.complete", responsePayload("stream.sync.complete")) };
    return { kind: "event", valid: true, message: event("session.state", { sessionId: ids.sessionId, afterBaseline: true }) };
  }
  if (action.startsWith("controller.")) {
    if (action === "controller.acquire" || action === "controller.reclaim") return { kind: "command", valid: true, message: command("controller.acquire", { scope: "session", sessionId: ids.sessionId }) };
    if (action === "controller.takeover") return { kind: "command", valid: true, message: command("controller.takeover", { scope: "session", sessionId: ids.sessionId }) };
    if (action === "controller.stale_mutation") return { kind: "error", valid: true, message: error("stale_controller") };
    return { kind: "event", valid: true, message: event("controller.state", { scope: "session", sessionId: ids.sessionId, mode: action.endsWith("disconnect") ? "reclaimable" : "expired" }) };
  }
  if (action.startsWith("command.")) {
    if (action === "command.conflict") return { kind: "error", valid: true, message: error("idempotency_conflict") };
    if (action === "command.duplicate" || action === "command.resend") return { kind: "response", valid: true, message: response("command.receipt", { state: action.endsWith("resend") ? "indeterminate" : "accepted", duplicate: true }) };
    const state = action === "command.accept" || action === "command.accept_recoverable" ? "accepted" : action === "command.restart" ? "dispatched" : action === "command.crash" ? "indeterminate" : "running";
    return { kind: "event", valid: true, message: event("command.state", { commandId: ids.commandId, commandType: "prompt.submit", state, errorCode: null }) };
  }
  if (action.startsWith("prompt.")) return { kind: "command", valid: true, message: command("prompt.submit", { sessionId: ids.sessionId, deliveryMode: action.slice("prompt.".length).replace("follow_up", "follow_up"), message: "fixture", attachmentIds: [] }) };
  if (action.startsWith("queue.")) {
    if (action === "queue.remove") return { kind: "command", valid: true, message: command("queue.remove", { sessionId: ids.sessionId, queueItemId: ids.messageId }) };
    if (action === "queue.clear") return { kind: "command", valid: true, message: command("queue.clear", { sessionId: ids.sessionId }) };
    if (action === "queue.overflow") return { kind: "error", valid: true, message: error("queue_full") };
    if (action === "queue.add") return { kind: "event", valid: true, message: event("turn.queued", { sessionId: ids.sessionId }) };
    return { kind: "event", valid: true, message: event("queue.snapshot", { items: action === "queue.fill" ? Array.from({ length: 10 }, () => ({})) : [] }) };
  }
  if (action.startsWith("attachment.")) {
    const code = action === "attachment.conflict" ? "idempotency_conflict" : action === "attachment.oversized" ? "payload_too_large" : action === "attachment.malformed" ? "invalid_message" : "attachment_unavailable";
    if (["attachment.conflict", "attachment.expire", "attachment.reference", "attachment.malformed", "attachment.oversized"].includes(action)) return { kind: "error", valid: true, message: error(code) };
    return { kind: "event", valid: true, message: event("turn.accepted", { sessionId: ids.sessionId, attachmentId: ids.messageId }) };
  }
  if (action.startsWith("export.") || action.startsWith("dialog.") || action.startsWith("pagination.")) {
    if (action === "export.complete") return { kind: "event", valid: true, message: event("command.state", { commandId: ids.commandId, commandType: "session.export", state: "completed", errorCode: null }) };
    if (action.startsWith("export.")) return { kind: "error", valid: true, message: error("export_unavailable") };
    if (action === "dialog.open" || action === "dialog.reconnect") return { kind: "event", valid: true, message: event("extension.dialog", eventPayload("extension.dialog")) };
    if (action.startsWith("dialog.")) return { kind: "error", valid: true, message: error("invalid_state") };
    return { kind: "response", valid: true, message: response("session.list.result", { items: [], snapshotRevision: action.endsWith("changed") ? "2" : "1" }) };
  }
  if (action.startsWith("failure.")) {
    const failureCode = action === "failure.oversized_json" ? "payload_too_large" : action === "failure.pi_mismatch" ? "pi_version_mismatch" : action.slice("failure.".length);
    return { kind: "error", valid: true, message: error(failureCode) };
  }
  if (action === "capability.optional_event") return { kind: "event", valid: true, message: event("future.notice", { optional: true }) };
  return { kind: "hello", valid: false, message: { ...base, requestId: ids.requestId, type: "hello", payload: { mobileVersion: "1", platform: "ios", installationId: ids.installationId, requiredCapabilities: ["unsupported.required"], optionalCapabilities: [] } } };
}
function scenarioStep(name: string, action: string, expect: string): ScenarioStep {
  const fixture = `scenario-${name}.json`;
  const evidence = scenarioMessage(action);
  emit(`scenario-${name}`, evidence.kind, evidence.valid, evidence.message);
  return { fixture, action, expect };
}
const s = scenarioStep;
const scenarios = [
  { name: "pairing-valid-invalid", steps: [s("pairing-accept", "pairing.accept", "paired"), s("pairing-reject-invalid", "pairing.reject_invalid", "rejected")], outcome: "rejected" },
  { name: "hello-mismatch-generation", steps: [s("hello-accept", "hello.accept", "connected"), s("hello-generation-changed", "hello.generation_changed", "snapshot_required")], outcome: "snapshot_required" },
  { name: "replay-gap-conflicting-duplicate", steps: [s("stream-apply", "stream.apply", "contiguous"), s("stream-gap", "stream.gap", "paused"), s("stream-conflicting-duplicate", "stream.conflicting_duplicate", "snapshot_required")], outcome: "snapshot_required" },
  { name: "multipart-snapshot-post-baseline", steps: [s("snapshot-begin", "snapshot.begin", "receiving"), s("snapshot-part-one", "snapshot.part_one", "part_one"), s("snapshot-part-two", "snapshot.part_two", "part_two"), s("snapshot-end", "snapshot.end", "snapshot_complete"), s("snapshot-post-baseline", "snapshot.post_baseline", "post_baseline_replayed"), s("snapshot-sync", "snapshot.sync", "synced")], outcome: "synced" },
  { name: "controller-reclaim-takeover-expiry-stale", steps: [s("controller-acquire", "controller.acquire", "controlled"), s("controller-disconnect", "controller.disconnect", "reclaimable"), s("controller-reclaim", "controller.reclaim", "controlled"), s("controller-takeover", "controller.takeover", "revoked"), s("controller-expire", "controller.expire", "expired"), s("controller-stale-mutation", "controller.stale_mutation", "stale_controller")], outcome: "stale_controller" },
  { name: "command-conflict-restart-indeterminate", steps: [s("command-accept", "command.accept", "accepted"), s("command-duplicate", "command.duplicate", "duplicate_no_dispatch"), s("command-conflict", "command.conflict", "idempotency_conflict"), s("command-accept-recoverable", "command.accept_recoverable", "accepted_undispatched"), s("command-restart", "command.restart", "dispatch_once"), s("command-running", "command.running", "running"), s("command-crash", "command.crash", "indeterminate"), s("command-resend", "command.resend", "no_redispatch")], outcome: "no_redispatch" },
  { name: "prompt-immediate-steer-follow-up-queue", steps: [s("prompt-immediate", "prompt.immediate", "immediate_dispatched"), s("prompt-steer", "prompt.steer", "steered"), s("prompt-follow-up", "prompt.follow_up", "queued"), s("queue-restart", "queue.restart", "queue_recovered"), s("queue-remove", "queue.remove", "removed"), s("queue-add", "queue.add", "queued_again"), s("queue-clear", "queue.clear", "empty"), s("queue-fill", "queue.fill", "full"), s("queue-overflow", "queue.overflow", "queue_full")], outcome: "queue_full" },
  { name: "attachment-retry-conflict-expiry-malformed-oversized", steps: [s("attachment-upload", "attachment.upload", "stored"), s("attachment-retry", "attachment.retry", "deduplicated"), s("attachment-conflict", "attachment.conflict", "idempotency_conflict"), s("attachment-replace", "attachment.replace", "stored_again"), s("attachment-expire", "attachment.expire", "expired"), s("attachment-reference", "attachment.reference", "attachment_unavailable"), s("attachment-malformed", "attachment.malformed", "malformed_rejected"), s("attachment-oversized", "attachment.oversized", "payload_too_large")], outcome: "payload_too_large" },
  { name: "export-dialog-pagination", steps: [s("export-complete", "export.complete", "export_ready"), s("export-expire", "export.expire", "export_expired"), s("export-delete", "export.delete", "export_unavailable"), s("dialog-open", "dialog.open", "dialog_pending"), s("dialog-reconnect", "dialog.reconnect", "dialog_replayed"), s("dialog-timeout", "dialog.timeout", "dialog_expired"), s("dialog-duplicate-response", "dialog.duplicate_response", "invalid_state"), s("pagination-first", "pagination.first", "page_loaded"), s("pagination-revision-changed", "pagination.revision_changed", "refresh_required")], outcome: "refresh_required" },
  { name: "oversized-slow-consumer-pi-db", steps: [s("failure-oversized-json", "failure.oversized_json", "payload_too_large"), s("failure-slow-consumer", "failure.slow_consumer", "slow_consumer"), s("failure-host-draining", "failure.host_draining", "host_draining"), s("failure-pi-mismatch", "failure.pi_mismatch", "pi_version_mismatch"), s("failure-database-unavailable", "failure.database_unavailable", "database_unavailable"), s("failure-storage-full", "failure.storage_full", "storage_full")], outcome: "storage_full" },
  { name: "unknown-optional-required-capability", steps: [{ fixture: "future-optional-event.json", action: "capability.optional_event", expect: "retained_optional" }, { fixture: "future-required-capability-event.json", action: "capability.required_unknown", expect: "unsupported_capability" }], outcome: "unsupported_capability" },
] as const;
const semanticHashCases = [
  {
    name: "metadata-excluded",
    messages: [
      { ...base, requestId: ids.requestId, connectionId: ids.installationId, commandId: ids.commandId, leaseId: ids.leaseId, type: "session.rename", payload: { sessionId: ids.sessionId, name: "fixture" } },
      { ...base, messageId: ids.eventId, requestId: ids.eventId, connectionId: ids.eventId, commandId: ids.commandId, leaseId: ids.eventId, sentAt: "2026-07-12T01:00:00.000Z", type: "session.rename", payload: { name: "fixture", sessionId: ids.sessionId }, retryMetadata: { attempt: 4 } },
    ],
    canonical: '{"payload":{"name":"fixture","sessionId":"66666666-6666-4666-8666-666666666666"},"type":"session.rename"}',
    sha256: "2c41e095cbd79ce924da6ca3fe3f03754f5fa72bedb831e90287d346d0ddb252",
  },
  {
    name: "unicode-nfc-and-key-order",
    semanticCommands: [
      { type: "session.rename", payload: { z: "café", a: [true, null] } },
      { payload: { a: [true, null], z: "cafe\u0301" }, type: "session.rename" },
    ],
    canonical: '{"payload":{"a":[true,null],"z":"café"},"type":"session.rename"}',
    sha256: "61a4c2925392bd0ca42625e716e0af099c8028131e9860701172549a99689c35",
  },
] as const;
writeFileSync(resolve(corpus, "fixtures-manifest.json"), `${JSON.stringify(entries.sort((a, b) => a.file.localeCompare(b.file)), null, 2)}\n`);
writeFileSync(resolve(corpus, "scenarios.json"), `${JSON.stringify(scenarios, null, 2)}\n`);
writeFileSync(resolve(corpus, "semantic-hashes.json"), `${JSON.stringify(semanticHashCases, null, 2)}\n`);
