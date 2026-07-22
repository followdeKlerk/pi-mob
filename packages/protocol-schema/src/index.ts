import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";

export const PROTOCOL_MAJOR = 1 as const;
export const PROTOCOL_MINOR = 0 as const;
export const PROTOCOL_VERSION = "1.0" as const;

export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
export const DECIMAL_CURSOR_PATTERN = "^(0|[1-9][0-9]*)$";
export const ISO_UTC_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{3})?Z$";

export const LIMITS = {
  maxJsonBytes: 1_048_576,
  maxAttachmentBytes: 10_485_760,
  maxAttachmentsPerPrompt: 4,
  maxPromptAttachmentBytes: 26_214_400,
  maxQueuedFollowUps: 10,
  maxSessionPageSize: 100,
  maxBackgroundSessionSubscriptions: 5,
  maxPlanSteps: 64,
  // F0 — bounded opaque identifiers and bounded payload fields for recipe (R1)
  // and plan (R2) flows. All values are UTF-16 code units (see the
  // `maxLength` UTF-16 note in the FIELD_GUIDE). The shared primitives
  // (activityId / turnId / planId / stepId / title / toolName) stay at 128 to
  // keep one canonical bounded identifier surface; recipe arguments and
  // output, and the optional plan blocker description, are conservative
  // 240-code-unit defaults that comfortably fit mobile cards and never
  // approach the 1 MiB JSON ceiling.
  maxRecipeActivityIdLength: 128,
  maxTurnIdLength: 128,
  maxPlanIdLength: 128,
  maxStepIdLength: 128,
  maxRecipeTitleLength: 128,
  maxToolNameLength: 128,
  maxRecipeArgumentsLength: 240,
  maxRecipeOutputLength: 240,
  maxPlanBlockerLength: 240,
} as const;

export const COMMAND_TYPES = [
  "controller.acquire", "controller.takeover", "controller.release", "host.display_name.set",
  "workspace.trust.approve", "notification.device.register", "notification.device.unregister",
  "session.create", "session.activate", "session.stop", "session.rename", "session.policy.set",
  "session.delete", "session.restore", "session.purge", "session.fork", "session.clone", "session.export",
  "prompt.submit", "turn.abort", "queue.remove", "queue.clear", "model.set", "thinking.set",
  "steering_mode.set", "follow_up_mode.set", "compaction.start", "compaction.auto.set",
  "retry.auto.set", "retry.abort", "extension.respond",
] as const;

export const EVENT_TYPES = [
  "host.state", "host.degraded", "host.draining", "host.capacity", "host.backup_state", "host.compatibility",
  "session.summary", "session.removed", "workspace.summary", "workspace.trust_state", "notification.capability",
  "command.state", "error.event", "session.state", "session.metadata", "session.policy", "session.tree", "controller.state",
  "turn.accepted", "turn.queued", "turn.started", "turn.waiting_for_input", "turn.retrying", "turn.compacting",
  "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "assistant.started", "assistant.delta",
  "assistant.completed", "reasoning.started", "reasoning.delta", "reasoning.completed", "tool.started", "tool.output",
  "tool.completed", "tool.failed", "tool.cancelled", "queue.snapshot", "model.state", "context.state", "retry.state",
  "compaction.state", "extension.dialog", "extension.notify", "extension.status", "extension.widget", "extension.title",
  "extension.editor_prefill",
  // F0 — additive recipe (R1) and plan (R2) event families.
  "recipe.activity", "recipe.unavailable",
  "plan.snapshot", "plan.unavailable",
] as const;

export const RESPONSE_TYPES = [
  "hello.accepted", "subscription.accepted", "stream.sync.complete", "stream.snapshot.begin", "stream.snapshot.part",
  "stream.snapshot.end", "command.receipt", "command.current.result", "controller.renew.result", "session.list.result", "session.history.page.result",
  "workspace.list.result", "workspace.search.result", "model.list.result",
] as const;
export const SUPPORTED_CAPABILITIES = [
  "streams.v1", "commands.v1", "controller_leases.v1", "attachments.v1", "extension_dialogs.v1", "notifications.v1",
] as const;
export const CONTROL_TYPES = ["subscription.set", "cursor.ack", "controller.renew", "host.snapshot.request", "session.snapshot.request", "session.list", "session.history.page", "workspace.list", "workspace.search", "model.list", "command.current"] as const;

export const ERROR_CODES = [
  "invalid_message", "unsupported_protocol", "unsupported_capability", "host_identity_mismatch", "stale_connection",
  "host_draining", "host_not_ready", "host_capacity", "stream_not_found", "cursor_invalid", "snapshot_failed",
  "session_not_found", "session_deleted", "session_incompatible", "session_repair_required", "workspace_not_found",
  "workspace_not_allowed", "workspace_unavailable", "workspace_trust_required", "controller_required", "controller_conflict",
  "stale_controller", "command_not_found", "idempotency_conflict", "queue_full", "queue_item_not_found", "invalid_state",
  "attachment_unavailable", "export_unavailable", "payload_too_large", "rate_limited", "slow_consumer", "pi_unavailable",
  "pi_version_mismatch", "provider_interrupted", "permission_denied", "crash_loop", "database_unavailable", "storage_full",
  "migration_required", "internal_error",
  // F0 — additive stability codes for recipe (R1) and plan (R2) flows.
  "recipe_unavailable", "plan_unavailable", "stale_plan_target",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type StreamOwnership = "host" | "session" | "host-or-session";
export const STREAM_ID_PATTERN = `^(host|session):${UUID_PATTERN.slice(1, -1)}$`;

export interface CommandMetadata {
  readonly type: CommandType;
  readonly scope: "host" | "session" | "host-or-session";
  readonly requiresLeaseId: boolean;
  readonly requiredCapability: "commands.v1";
  readonly acceptedStates: readonly string[];
  readonly semanticHashFields: readonly ["type", "payload"];
  readonly idempotency: "command-id-semantic-payload-sha256";
  readonly recovery: "accepted-undispatched-dispatch-once;running-at-crash-indeterminate";
  readonly journaledEffects: readonly ["command.state"];
  readonly stableErrors: readonly string[];
}

const controllerCommands = new Set<CommandType>(["controller.acquire", "controller.takeover", "controller.release"]);
const hostCommands = new Set<CommandType>(["controller.acquire", "controller.takeover", "controller.release", "host.display_name.set", "workspace.trust.approve", "notification.device.register", "notification.device.unregister", "session.create"]);
const leaseFreeCommands = new Set<CommandType>([
  ...controllerCommands,
  "workspace.trust.approve",
  "session.create",
  "session.delete",
  "notification.device.register",
  "notification.device.unregister",
]);

export const COMMAND_METADATA: readonly CommandMetadata[] = COMMAND_TYPES.map((type) => ({
  type,
  scope: controllerCommands.has(type) ? "host-or-session" : hostCommands.has(type) ? "host" : "session",
  requiresLeaseId: !leaseFreeCommands.has(type),
  requiredCapability: "commands.v1",
  acceptedStates: ["protocol-valid", "capability-supported", "state-eligible"],
  semanticHashFields: ["type", "payload"],
  idempotency: "command-id-semantic-payload-sha256",
  recovery: "accepted-undispatched-dispatch-once;running-at-crash-indeterminate",
  journaledEffects: ["command.state"],
  stableErrors: ["invalid_message", "unsupported_capability", "invalid_state", "idempotency_conflict"],
}));

const hostEventTypes = new Set<EventType>(["host.state", "host.degraded", "host.draining", "host.capacity", "host.backup_state", "host.compatibility", "session.summary", "session.removed", "workspace.summary", "workspace.trust_state", "notification.capability"]);
export const EVENT_STREAM_OWNERSHIP: Readonly<Record<EventType, StreamOwnership>> = Object.fromEntries(
  EVENT_TYPES.map((type) => [type, type === "command.state" || type === "error.event" ? "host-or-session" : hostEventTypes.has(type) ? "host" : "session"]),
) as Readonly<Record<EventType, StreamOwnership>>;

export const UuidSchema = Type.String({ pattern: UUID_PATTERN, $id: "pi-mob/protocol/uuid" });
export const DecimalCursorSchema = Type.String({ pattern: DECIMAL_CURSOR_PATTERN, $id: "pi-mob/protocol/decimal-cursor" });
export const CapabilitySchema = Type.Union(SUPPORTED_CAPABILITIES.map((value) => Type.Literal(value)), { $id: "pi-mob/protocol/capability" });
const Uuid = UuidSchema;

// F0 — shared explicit primitives for recipe (R1) and plan (R2) flows.
// RevisionToken is intentionally distinct from DECIMAL_CURSOR_PATTERN so that
// callers cannot accidentally substitute one for the other.
export const RevisionTokenSchema = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_.:-]{0,127}$", $id: "pi-mob/protocol/revision-token" });
// F0 — capability states for recipe (R1) and plan (R2) flows. "stale" covers
// revisions whose TTL or trust window has elapsed without an explicit outage.
// Exported so bridge and schema consumers can iterate the full state set
// without re-hardcoding the union of CapabilityStatusSchema variants.
export const CAPABILITY_STATES = ["available", "degraded", "unavailable", "stale"] as const;
// F0 — CapabilityStatusSchema is a discriminated union: "available" permits
// optional reason/remediation because green-path responses don't need an
// incident narrative; degraded/unavailable/stale each REQUIRE nonempty
// reason+remediation so callers always know what is broken and how to fix it.
// `source`/`revision`/`lastRefreshedAt` are optional context for every variant
// and pinpoint which surface (host-bridge, session-bridge, pi runtime)
// produced the status and against which revision the answer was computed.
// EVERY variant uses `additionalProperties: false` so a bridge call site
// cannot smuggle `private` / `internal` / `debug` bookkeeping fields through
// a capability status. The status surface is one of the privacy-sensitive
// nested shapes called out in FIELD_GUIDE §"schema-authoring traps".
export const CapabilityStatusSchema = Type.Union([
  Type.Object({
    state: Type.Literal("available"),
    reason: Type.Optional(Type.String({ minLength: 1 })),
    remediation: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.Optional(Type.String({ minLength: 1 })),
    revision: Type.Optional(RevisionTokenSchema),
    lastRefreshedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  }, { additionalProperties: false, $id: "pi-mob/protocol/capability-status#available" }),
  Type.Object({
    state: Type.Literal("degraded"),
    reason: Type.String({ minLength: 1 }),
    remediation: Type.String({ minLength: 1 }),
    source: Type.Optional(Type.String({ minLength: 1 })),
    revision: Type.Optional(RevisionTokenSchema),
    lastRefreshedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  }, { additionalProperties: false, $id: "pi-mob/protocol/capability-status#degraded" }),
  Type.Object({
    state: Type.Literal("unavailable"),
    reason: Type.String({ minLength: 1 }),
    remediation: Type.String({ minLength: 1 }),
    source: Type.Optional(Type.String({ minLength: 1 })),
    revision: Type.Optional(RevisionTokenSchema),
    lastRefreshedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  }, { additionalProperties: false, $id: "pi-mob/protocol/capability-status#unavailable" }),
  Type.Object({
    state: Type.Literal("stale"),
    reason: Type.String({ minLength: 1 }),
    remediation: Type.String({ minLength: 1 }),
    source: Type.Optional(Type.String({ minLength: 1 })),
    revision: Type.Optional(RevisionTokenSchema),
    lastRefreshedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  }, { additionalProperties: false, $id: "pi-mob/protocol/capability-status#stale" }),
], { $id: "pi-mob/protocol/capability-status" });
export const BoundsSchema = Type.Object({
  maxItems: Type.Optional(Type.Integer({ minimum: 0 })),
  maxBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 0 })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
  maxDurationMs: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: true, $id: "pi-mob/protocol/bounds" });
/**
 * Cross-field truncation telemetry for shared protocol payloads.
 *
 * Schema-scope guarantees ONLY:
 *   - `retainedBytes` and `totalBytes` are non-negative integers (shape +
 *     sign enforced by the validator).
 *   - `isTruncated` is a boolean.
 *   - When present, `digest` matches the canonical lowercase-hex SHA-256
 *     pattern (length + alphabet).
 *   - No unknown sibling fields are accepted: `additionalProperties: false`
 *     means the schema rejects extras such as a private "internal" key
 *     nested alongside the declared properties.
 *
 * Out-of-scope for the schema (MUST be enforced by the bridge later):
 *   - The relational invariant `retainedBytes <= totalBytes`.
 *   - The implication `isTruncated === true` => `retainedBytes < totalBytes`
 *     (and the dual: `isTruncated === false` => `retainedBytes === totalBytes`).
 *   - Any claim that `retainedBytes`/`totalBytes` are NFC-normalized byte
 *     counts; the schema does not look at the truncated payload and cannot
 *     prove normalization. The bridge MUST perform NFC + byte measurement
 *     before publish and re-verify on receive.
 *   - Exact digest correctness: the regex only constrains the hex form, not
 *     whether the digest matches the un-trimmed field's UTF-8 bytes. The
 *     bridge MUST recompute and verify the SHA-256 before emitting.
 *   - Coverage: a payload that mentions truncation on one sibling but omits
 *     it on another truncated sibling is a violation the bridge detects at
 *     publish time; the schema cannot see sibling fields.
 */
export const TruncationSchema = Type.Object({
  retainedBytes: Type.Integer({ minimum: 0 }),
  totalBytes: Type.Integer({ minimum: 0 }),
  digest: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  isTruncated: Type.Boolean(),
}, { additionalProperties: false, $id: "pi-mob/protocol/truncation" });
// F0 — TimingSchema is a closed, bounded timing envelope. `startedAt` is
// REQUIRED and matches the canonical ISO-UTC pattern; `updatedAt`,
// `finishedAt`, and `durationMs` are optional and let a partial timing block
// be published before the recipe activity finishes. `additionalProperties:
// false` is mandatory: the timing surface is one of the privacy-sensitive
// nested shapes called out in FIELD_GUIDE §"schema-authoring traps", and
// closing the shape prevents a bridge call site from smuggling `private` /
// `internal` / `debug` bookkeeping alongside the declared timing fields.
export const TimingSchema = Type.Object({
  startedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
  updatedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  finishedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false, $id: "pi-mob/protocol/timing" });
// F0 — ErrorInfoSchema is a closed, typed error envelope used by the recipe
// (R1) tool arm and other surfaces. `code` is one of `ERROR_CODES` (a
// frozen, additive list — see the F0 R1/R2 stability codes for the new
// `recipe_unavailable` / `plan_unavailable` / `stale_plan_target` members),
// `message` is a nonempty human-readable string, `retryable` is the
// boolean the mobile client uses to drive the retry button, and
// `recommendedDelayMs` is an optional bridge-suggested wait (null means
// "the bridge has no recommendation"). `additionalProperties: false` is
// mandatory: the error surface is one of the privacy-sensitive nested
// shapes called out in FIELD_GUIDE §"schema-authoring traps", and closing
// the shape prevents a bridge call site from smuggling `private` /
// `internal` / `debug` context (raw stack frames, request ids, host
// session secrets) alongside the declared error fields.
export const ErrorInfoSchema = Type.Object({
  code: Type.Union(ERROR_CODES.map((value) => Type.Literal(value))),
  message: Type.String({ minLength: 1 }),
  retryable: Type.Boolean(),
  recommendedDelayMs: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
}, { additionalProperties: false, $id: "pi-mob/protocol/error-info" });
// F0 — ProviderSummarySchema is a tagged, closed object. Length bounds are
// deliberately CONSERVATIVE and expressed in JSON-Schema / TypeBox semantics,
// which count UTF-16 code units (a.k.a. JS string `.length`), NOT raw UTF-8
// bytes:
//   - `provider` / `model`: 1..128 UTF-16 code units. Short identifiers; any
//     realistic vendor name plus a sane model slug fits well under 128.
//   - `summary`: 1..1024 UTF-16 code units. The product ceiling is 4096 UTF-8
//     bytes; the worst-case UTF-8 size for a 1024-code-unit string is 3072
//     bytes (1024 × 3, every code unit a 3-byte BMP character), so 1024
//     code units is a guaranteed-safe upper bound that can never overflow
//     the 4096-byte ceiling regardless of Unicode content.
// Future bridge (NOT in this schema): the bridge MUST re-measure `summary`
// after UTF-8 encoding and reject any value whose byte length exceeds 4096.
// The schema cannot encode "max UTF-8 bytes" directly, so this byte ceiling
// lives as a bridge-level invariant until the schema layer can express it.
// `additionalProperties: false` means the bridge will reject any unknown
// sibling field (thinking level, raw metadata, etc.) rather than silently
// forward it to mobile clients.
export const ProviderSummarySchema = Type.Object({
  kind: Type.Literal("provider_summary"),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  summary: Type.String({ minLength: 1, maxLength: 1024 }),
  truncation: Type.Optional(TruncationSchema),
}, { additionalProperties: false, $id: "pi-mob/protocol/provider-summary" });

// F0 — PlanTargetSchema is the closed, optional `planTarget` payload on
// `prompt.submit`. Every field is REQUIRED and bounded as opaque text:
//   - `planId` / `stepId`: 1..128 code units, opaque (the bridge resolves them
//     against the authoritative plan snapshot and rejects stale or unknown
//     targets with `stale_plan_target` BEFORE Pi dispatch).
//   - `revision`: REQUIRED `RevisionTokenSchema` (1..128 code units, opaque,
//     never a pure-decimal cursor). The revision is mandatory so an
//     idempotency retry cannot retarget a command against a newer or older
//     plan revision than the one the operator saw.
// The schema is `additionalProperties: false` so the bridge cannot smuggle
// `private` / `internal` / `debug` keys alongside the closed target shape.
// D-036 note: steer-only is a BRIDGE semantic, not a schema semantic, so the
// schema does not constrain `deliveryMode` here — `target` is closed shape
// only, and a missing `planTarget` keeps every legacy `prompt.submit` valid.
export const PlanTargetSchema = Type.Object({
  planId: Type.String({ minLength: 1, maxLength: LIMITS.maxPlanIdLength }),
  stepId: Type.String({ minLength: 1, maxLength: LIMITS.maxStepIdLength }),
  revision: RevisionTokenSchema,
}, { additionalProperties: false, $id: "pi-mob/protocol/plan-target" });

// F0 — RecipeActivitySchema is a CLOSED discriminated union of `thinking`
// and `tool` arms. EVERY recipe activity carries the SAME shared identity
// envelope so a mobile cache can replay / dedupe / correlate without
// inspecting the discriminator:
//   - `sessionId` (UUID): the owning session.
//   - `turnId` (opaque, maxLength 128): the owning turn; never a cursor.
//   - `activityId` (opaque, maxLength 128): the recipe activity's own id.
//   - `ordinal` (non-negative integer): the turn-local activity order.
//   - `status` (literal pending | running | completed | failed | cancelled):
//     the recipe-activity lifecycle; distinct from the R2 plan-step states.
//   - `timing` (TimingSchema): required timing envelope.
//
// The `thinking` arm permits ONLY:
//   - `title` (1..128 code units), required — bounded display label.
//   - `providerSummary` (ProviderSummarySchema), optional — provider-supplied,
//     displayable summary only; never raw thinking, deltas, steps, hidden
//     metadata, or synthesized summaries.
//   - `truncation` (TruncationSchema), optional — truncation telemetry.
//
// The `tool` arm permits ONLY:
//   - `title` (1..128 code units), required — bounded display label.
//   - `toolName` (1..128 code units), required — bounded tool identifier.
//   - `arguments` (1..240 code units), required — bounded tool arguments.
//   - `output` (1..240 code units), required — bounded tool output.
//   - `errorInfo` (ErrorInfoSchema), optional — typed tool error.
//   - `truncation` (TruncationSchema), optional — truncation telemetry.
// The `tool` arm MUST REJECT `providerSummary`: it is a thinking-only field.
//
// Both arms are `additionalProperties: false` so the bridge cannot smuggle
// private fields (raw thinking, internal metadata, debug context) alongside
// the declared activity shape.
export const RecipeActivitySchema = Type.Union([
  Type.Object({
    kind: Type.Literal("thinking"),
    sessionId: Uuid,
    turnId: Type.String({ minLength: 1, maxLength: LIMITS.maxTurnIdLength }),
    activityId: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeActivityIdLength }),
    ordinal: Type.Integer({ minimum: 0 }),
    status: Type.Union(["pending", "running", "completed", "failed", "cancelled"].map((value) => Type.Literal(value))),
    timing: TimingSchema,
    title: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeTitleLength }),
    providerSummary: Type.Optional(ProviderSummarySchema),
    truncation: Type.Optional(TruncationSchema),
  }, { additionalProperties: false, $id: "pi-mob/protocol/recipe-activity#thinking" }),
  Type.Object({
    kind: Type.Literal("tool"),
    sessionId: Uuid,
    turnId: Type.String({ minLength: 1, maxLength: LIMITS.maxTurnIdLength }),
    activityId: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeActivityIdLength }),
    ordinal: Type.Integer({ minimum: 0 }),
    status: Type.Union(["pending", "running", "completed", "failed", "cancelled"].map((value) => Type.Literal(value))),
    timing: TimingSchema,
    title: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeTitleLength }),
    toolName: Type.String({ minLength: 1, maxLength: LIMITS.maxToolNameLength }),
    arguments: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeArgumentsLength }),
    output: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeOutputLength }),
    errorInfo: Type.Optional(ErrorInfoSchema),
    truncation: Type.Optional(TruncationSchema),
  }, { additionalProperties: false, $id: "pi-mob/protocol/recipe-activity#tool" }),
], { $id: "pi-mob/protocol/recipe-activity" });

// F0 — PlanStepSchema is the closed, bounded shape for one R2 plan step.
// Identifiers and titles are bounded opaque text; the `blocker` and `timing`
// fields are optional so an idle step (status `pending` / `skipped`) can
// publish without inventing blocker or timing metadata. The plan-step state
// set (`pending | running | completed | blocked | skipped`) is distinct from
// the recipe-activity state set.
export const PlanStepSchema = Type.Object({
  stepId: Type.String({ minLength: 1, maxLength: LIMITS.maxStepIdLength }),
  title: Type.String({ minLength: 1, maxLength: LIMITS.maxRecipeTitleLength }),
  status: Type.Union(["pending", "running", "completed", "blocked", "skipped"].map((value) => Type.Literal(value))),
  blocker: Type.Optional(Type.String({ minLength: 1, maxLength: LIMITS.maxPlanBlockerLength })),
  timing: Type.Optional(TimingSchema),
}, { additionalProperties: false, $id: "pi-mob/protocol/plan-step" });

// F0 — PlanSnapshotSchema is the closed R2 authoritative-plan event payload.
// `planId` and the required `revision` pinpoint the snapshot; `steps` is a
// closed array bounded by `LIMITS.maxPlanSteps` (64). Anything bigger is
// rejected by the schema; the bridge never silently truncates.
export const PlanSnapshotSchema = Type.Object({
  planId: Type.String({ minLength: 1, maxLength: LIMITS.maxPlanIdLength }),
  revision: RevisionTokenSchema,
  steps: Type.Array(PlanStepSchema, { maxItems: LIMITS.maxPlanSteps }),
}, { additionalProperties: false, $id: "pi-mob/protocol/plan-snapshot" });

// F0 — capability literal for the recipe (R1) unavailable surface.
export const RECIPE_CAPABILITY = "recipes.v1" as const;
// F0 — capability literal for the plan (R2) unavailable surface.
export const PLAN_CAPABILITY = "plans.v1" as const;

// F0 — RecipeUnavailableSchema / PlanUnavailableSchema carry the capability
// identifier of the unavailable surface plus a closed `CapabilityStatus`.
// `capability` is REQUIRED so a mobile client can attribute the unavailable
// state to a specific surface without parsing the envelope type.
export const RecipeUnavailableSchema = Type.Object({
  capability: Type.Literal(RECIPE_CAPABILITY),
  status: CapabilityStatusSchema,
}, { additionalProperties: false, $id: "pi-mob/protocol/recipe-unavailable" });

export const PlanUnavailableSchema = Type.Object({
  capability: Type.Literal(PLAN_CAPABILITY),
  status: CapabilityStatusSchema,
}, { additionalProperties: false, $id: "pi-mob/protocol/plan-unavailable" });

const Payload = Type.Object({}, { additionalProperties: true });
export const ProtocolVersionSchema = Type.Object({ major: Type.Literal(PROTOCOL_MAJOR), minor: Type.Integer({ minimum: 0 }) }, { additionalProperties: true, $id: "pi-mob/protocol/version" });
const Protocol = ProtocolVersionSchema;
const EnvelopeFields = {
  protocol: Protocol,
  messageId: Uuid,
  type: Type.String({ minLength: 1 }),
  sentAt: Type.String({ pattern: ISO_UTC_PATTERN }),
  payload: Payload,
};
export const EnvelopeSchema = Type.Object({
  ...EnvelopeFields,
  requestId: Type.Optional(Uuid), commandId: Type.Optional(Uuid), connectionId: Type.Optional(Uuid), leaseId: Type.Optional(Uuid),
  streamId: Type.Optional(Type.String({ pattern: STREAM_ID_PATTERN })), cursor: Type.Optional(Type.String({ pattern: DECIMAL_CURSOR_PATTERN })),
}, { additionalProperties: true, $id: "pi-mob/protocol/envelope" });
export const StreamSchema = Type.Object({
  streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
  cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
}, { additionalProperties: true, $id: "pi-mob/protocol/stream" });
const WithOptionalRequest = { ...EnvelopeFields, requestId: Type.Optional(Uuid), connectionId: Type.Optional(Uuid) };
const ClientEnvelope = { ...EnvelopeFields, requestId: Uuid, connectionId: Uuid };
const SessionId = Uuid;
const ControllerScope = Type.Union([
  Type.Object({ scope: Type.Literal("host") }, { additionalProperties: true }),
  Type.Object({ scope: Type.Literal("session"), sessionId: SessionId }, { additionalProperties: true }),
]);
const CommandPayloads = {
  "controller.acquire": ControllerScope,
  "controller.takeover": ControllerScope,
  "controller.release": ControllerScope,
  "host.display_name.set": Type.Object({ displayName: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
  "workspace.trust.approve": Type.Object({ workspaceId: Uuid, fingerprint: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
  "notification.device.register": Type.Object({ deviceId: Uuid, platform: Type.String({ minLength: 1 }), token: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
  "notification.device.unregister": Type.Object({ deviceId: Uuid }, { additionalProperties: true }),
  "session.create": Type.Object({ workspaceId: Uuid, workspaceRelativePath: Type.Optional(Type.String({ maxLength: 4096 })), policyMode: Type.Union([Type.Literal("full"), Type.Literal("read_only")]), name: Type.Optional(Type.String()), modelIntent: Type.Optional(Type.String()), modelId: Type.Optional(Type.String({ minLength: 1 })), provider: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: true }),
  "session.activate": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "session.stop": Type.Object({ sessionId: SessionId }, { additionalProperties: true }),
  "session.rename": Type.Object({ sessionId: SessionId, name: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
  "session.policy.set": Type.Object({ sessionId: SessionId, policyMode: Type.Union([Type.Literal("full"), Type.Literal("read_only")]) }, { additionalProperties: true }),
  "session.delete": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "session.restore": Type.Object({ sessionId: SessionId }, { additionalProperties: true }),
  "session.purge": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "session.fork": Type.Object({ sessionId: SessionId, entryId: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
  "session.clone": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "session.export": Type.Object({ sessionId: SessionId, format: Type.Literal("html") }, { additionalProperties: true }),
  "prompt.submit": Type.Object({ sessionId: SessionId, deliveryMode: Type.Union([Type.Literal("immediate"), Type.Literal("steer"), Type.Literal("follow_up")]), message: Type.String(), attachmentIds: Type.Array(Uuid, { maxItems: LIMITS.maxAttachmentsPerPrompt }), planTarget: Type.Optional(PlanTargetSchema) }, { additionalProperties: true }),
  "turn.abort": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "queue.remove": Type.Object({ sessionId: SessionId, queueItemId: Uuid }, { additionalProperties: true }),
  "queue.clear": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "model.set": Type.Object({ sessionId: SessionId, modelId: Type.String({ minLength: 1 }), provider: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: true }),
  "thinking.set": Type.Object({ sessionId: SessionId, level: Type.String({ minLength: 1 }) }, { additionalProperties: true }), "steering_mode.set": Type.Object({ sessionId: SessionId, enabled: Type.Boolean() }, { additionalProperties: true }),
  "follow_up_mode.set": Type.Object({ sessionId: SessionId, enabled: Type.Boolean() }, { additionalProperties: true }), "compaction.start": Type.Object({ sessionId: SessionId }, { additionalProperties: true }),
  "compaction.auto.set": Type.Object({ sessionId: SessionId, enabled: Type.Boolean() }, { additionalProperties: true }), "retry.auto.set": Type.Object({ sessionId: SessionId, enabled: Type.Boolean() }, { additionalProperties: true }),
  "retry.abort": Type.Object({ sessionId: SessionId }, { additionalProperties: true }), "extension.respond": Type.Object({ sessionId: SessionId, dialogId: Uuid, response: Payload }, { additionalProperties: true }),
} as const;
const LeaseStateFields = {
  mode: Type.String({ minLength: 1 }),
  leaseId: Type.Optional(Uuid),
  installationId: Type.Optional(Uuid),
  expiresAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
  reclaimableUntil: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
};
export const LeaseStateSchema = Type.Union([
  Type.Object({ ...LeaseStateFields, scope: Type.Literal("host") }, { additionalProperties: true }),
  Type.Object({ ...LeaseStateFields, scope: Type.Literal("session"), sessionId: SessionId }, { additionalProperties: true }),
], { $id: "pi-mob/protocol/lease-state" });
const EventPayloads = {
  "session.summary": Type.Object({ sessionId: SessionId, runtimeState: Type.String(), queueCount: Type.Integer({ minimum: 0 }), createdByCommandId: Type.Optional(Uuid) }, { additionalProperties: true }),
  "controller.state": LeaseStateSchema,
  "command.state": Type.Object({ commandId: Uuid, commandType: Type.Union(COMMAND_TYPES.map((value) => Type.Literal(value))), state: Type.String(), errorCode: Type.Union([Type.Union(ERROR_CODES.map((value) => Type.Literal(value))), Type.Null()]) }, { additionalProperties: true }),
  "tool.output": Type.Object({ toolCallId: Type.String({ minLength: 1, maxLength: 512 }), retainedBytes: Type.Integer({ minimum: 0 }), totalBytes: Type.Integer({ minimum: 0 }), digest: Type.Optional(Type.String()), isTruncated: Type.Boolean() }, { additionalProperties: true }),
  "extension.dialog": Type.Object({ dialogId: Uuid, method: Type.Union([Type.Literal("select"), Type.Literal("confirm"), Type.Literal("input"), Type.Literal("editor")]), expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }) }, { additionalProperties: true }),
  "queue.snapshot": Type.Object({ items: Type.Array(Payload, { maxItems: LIMITS.maxQueuedFollowUps }) }, { additionalProperties: true }),
  "recipe.activity": RecipeActivitySchema,
  "recipe.unavailable": RecipeUnavailableSchema,
  "plan.snapshot": PlanSnapshotSchema,
  "plan.unavailable": PlanUnavailableSchema,
} as const;
const genericEventPayload = Type.Object({ sessionId: Type.Optional(SessionId) }, { additionalProperties: true });
const ControlPayloads = {
  "subscription.set": Type.Object({ streams: Type.Array(Type.Object({ streamId: Type.String({ pattern: STREAM_ID_PATTERN }), afterCursor: Type.Optional(Type.String({ pattern: DECIMAL_CURSOR_PATTERN })), detail: Type.Union([Type.Literal("full"), Type.Literal("summary")]) }, { additionalProperties: true }), { minItems: 1 }) }, { additionalProperties: true }),
  "cursor.ack": Type.Object({ cursors: Type.Record(Type.String({ pattern: STREAM_ID_PATTERN }), Type.String({ pattern: DECIMAL_CURSOR_PATTERN })) }, { additionalProperties: true }),
  "controller.renew": Type.Object({ leaseId: Uuid }, { additionalProperties: true }),
  "host.snapshot.request": Type.Object({}, { additionalProperties: true }),
  "session.snapshot.request": Type.Object({ sessionId: SessionId }, { additionalProperties: true }),
  "session.list": Type.Object({ filter: Type.Optional(Type.String()), query: Type.Union([Type.String(), Type.Null()]), sort: Type.String(), pageSize: Type.Integer({ minimum: 1, maximum: LIMITS.maxSessionPageSize }), pageToken: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: true }),
  "session.history.page": Type.Object({ sessionId: SessionId, pageSize: Type.Integer({ minimum: 1, maximum: LIMITS.maxSessionPageSize }), pageToken: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: true }),
  "workspace.list": Type.Object({}, { additionalProperties: true }), "workspace.search": Type.Object({ query: Type.String() }, { additionalProperties: true }),
  "model.list": Type.Object({ sessionId: Type.Optional(SessionId) }, { additionalProperties: true }), "command.current": Type.Object({ commandId: Uuid }, { additionalProperties: true }),
} as const;
export const SubscriptionSchema = ControlPayloads["subscription.set"];
const ResponsePayloads = {
  "hello.accepted": Type.Object({ connectionId: Uuid, hostId: Uuid, hostGeneration: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }), hostDisplayName: Type.String(), bridgeVersion: Type.String(), piVersion: Type.String(), serverTime: Type.String({ pattern: ISO_UTC_PATTERN }), capabilities: Type.Array(Type.String()), limits: Type.Object({ maxJsonBytes: Type.Integer({ minimum: 0 }), maxAttachmentBytes: Type.Integer({ minimum: 0 }), maxAttachmentsPerPrompt: Type.Integer({ minimum: 0 }), maxPromptAttachmentBytes: Type.Integer({ minimum: 0 }), maxQueuedFollowUps: Type.Integer({ minimum: 0 }), maxSessionPageSize: Type.Integer({ minimum: 0 }), maxBackgroundSessionSubscriptions: Type.Integer({ minimum: 0 }) }, { additionalProperties: true }) }, { additionalProperties: true }),
  "subscription.accepted": Type.Object({ streams: Type.Array(Type.Object({ streamId: Type.String({ pattern: STREAM_ID_PATTERN }), mode: Type.Union([Type.Literal("replay"), Type.Literal("current"), Type.Literal("snapshot_required")]) }, { additionalProperties: true })) }, { additionalProperties: true }),
  "stream.sync.complete": Type.Object({ streamId: Type.String({ pattern: STREAM_ID_PATTERN }), currentCursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }), mode: Type.Union([Type.Literal("replay"), Type.Literal("current"), Type.Literal("snapshot_required")]) }, { additionalProperties: true }),
  "stream.snapshot.begin": Type.Object({ snapshotId: Uuid, streamId: Type.String({ pattern: STREAM_ID_PATTERN }), baselineCursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }) }, { additionalProperties: true }),
  "stream.snapshot.part": Type.Object({ snapshotId: Uuid, part: Type.Integer({ minimum: 0 }), items: Type.Array(Payload) }, { additionalProperties: true }),
  "stream.snapshot.end": Type.Object({ snapshotId: Uuid, partCount: Type.Integer({ minimum: 1 }) }, { additionalProperties: true }),
  "command.receipt": Type.Object({ state: Type.String({ minLength: 1 }), duplicate: Type.Boolean() }, { additionalProperties: true }),
  "command.current.result": Type.Object({ commandId: Uuid, state: Type.String() }, { additionalProperties: true }),
  "controller.renew.result": Type.Object({ leaseId: Uuid, expiresAt: Type.Integer({ minimum: 0 }) }, { additionalProperties: true }),
  "session.list.result": Type.Object({ items: Type.Array(Payload), snapshotRevision: Type.String(), nextPageToken: Type.Optional(Type.String()) }, { additionalProperties: true }),
  "session.history.page.result": Type.Object({ items: Type.Array(Payload), snapshotRevision: Type.String(), nextPageToken: Type.Optional(Type.String()) }, { additionalProperties: true }),
  "workspace.list.result": Type.Object({ items: Type.Array(Payload) }, { additionalProperties: true }), "workspace.search.result": Type.Object({ items: Type.Array(Payload) }, { additionalProperties: true }), "model.list.result": Type.Object({ items: Type.Array(Payload) }, { additionalProperties: true }),
} as const;

export const SnapshotSchema = Type.Union([
  ResponsePayloads["stream.snapshot.begin"],
  ResponsePayloads["stream.snapshot.part"],
  ResponsePayloads["stream.snapshot.end"],
], { $id: "pi-mob/protocol/snapshot" });

export const HelloSchema = Type.Object({
  ...WithOptionalRequest,
  type: Type.Literal("hello"),
  requestId: Uuid,
  payload: Type.Object({
    expectedHostId: Type.Optional(Uuid), mobileVersion: Type.String({ minLength: 1 }), platform: Type.String({ minLength: 1 }),
    installationId: Uuid,
    requiredCapabilities: Type.Array(CapabilitySchema),
    optionalCapabilities: Type.Array(Type.String()),
  }, { additionalProperties: true }),
}, { additionalProperties: true, $id: "pi-mob/protocol/hello" });

export const CommandSchema = Type.Union(COMMAND_TYPES.map((type) => Type.Object({ ...ClientEnvelope, commandId: Uuid, ...(leaseFreeCommands.has(type) ? {} : { leaseId: Uuid }), type: Type.Literal(type), payload: CommandPayloads[type] }, { additionalProperties: true })) as TSchema[], { $id: "pi-mob/protocol/command" });

const SupportedCapability = CapabilitySchema;
const KnownEventType = Type.Union(EVENT_TYPES.map((value) => Type.Literal(value)));
const OptionalAdditiveEventSchema = Type.Object({ ...EnvelopeFields, eventId: Uuid, streamId: Type.String({ pattern: STREAM_ID_PATTERN }), cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }), type: Type.Intersect([Type.String({ pattern: "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$" }), Type.Not(KnownEventType)]), payload: Type.Object({ optional: Type.Literal(true), requiredCapabilities: Type.Optional(Type.Array(SupportedCapability)) }, { additionalProperties: true }) }, { additionalProperties: true });
export const EventSchema = Type.Union([...EVENT_TYPES.map((type) => Type.Object({ ...EnvelopeFields, eventId: Uuid, streamId: Type.String({ pattern: EVENT_STREAM_OWNERSHIP[type] === "host" ? `^host:${UUID_PATTERN.slice(1, -1)}$` : EVENT_STREAM_OWNERSHIP[type] === "session" ? `^session:${UUID_PATTERN.slice(1, -1)}$` : STREAM_ID_PATTERN }), cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }), type: Type.Literal(type), payload: type in EventPayloads ? EventPayloads[type as keyof typeof EventPayloads] : genericEventPayload }, { additionalProperties: true })), OptionalAdditiveEventSchema] as TSchema[], { $id: "pi-mob/protocol/event" });

export const ControlSchema = Type.Union(CONTROL_TYPES.map((type) => Type.Object({ ...ClientEnvelope, type: Type.Literal(type), payload: ControlPayloads[type] }, { additionalProperties: true })) as TSchema[], { $id: "pi-mob/protocol/control" });
export const ResponseSchema = Type.Union(RESPONSE_TYPES.map((type) => Type.Object({ ...WithOptionalRequest, requestId: Uuid, ...(type === "command.receipt" ? { commandId: Uuid } : {}), type: Type.Literal(type), payload: ResponsePayloads[type] }, { additionalProperties: true })) as TSchema[], { $id: "pi-mob/protocol/response" });
export const PairingSchema = Type.Object({ kind: Type.Literal("pi-mob-host"), version: Type.Literal(1), hostId: Uuid, displayName: Type.String({ minLength: 1 }), endpoint: Type.String({ pattern: "^https://" }), protocolMajor: Type.Literal(PROTOCOL_MAJOR) }, { additionalProperties: true, $id: "pi-mob/protocol/pairing" });
export const AttachmentResponseSchema = Type.Object({ attachmentId: Uuid, sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }), mimeType: Type.Union([Type.Literal("image/jpeg"), Type.Literal("image/png")]), bytes: Type.Integer({ minimum: 0, maximum: LIMITS.maxAttachmentBytes }), width: Type.Optional(Type.Integer({ minimum: 1 })), height: Type.Optional(Type.Integer({ minimum: 1 })), expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }) }, { additionalProperties: true, $id: "pi-mob/protocol/attachment" });
export const ExportMetadataSchema = Type.Object({ exportId: Uuid, format: Type.Literal("html"), bytes: Type.Integer({ minimum: 0 }), sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }), expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }) }, { additionalProperties: true, $id: "pi-mob/protocol/export" });

export const ErrorSchema = Type.Object({
  ...WithOptionalRequest,
  requestId: Uuid,
  type: Type.Literal("error"),
  payload: Type.Object({
    code: Type.Union(ERROR_CODES.map((value) => Type.Literal(value))),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Boolean(),
    recommendedDelayMs: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    details: Type.Object({}, { additionalProperties: true }),
  }, { additionalProperties: true }),
}, { additionalProperties: true, $id: "pi-mob/protocol/error" });

export const FixtureSchema = Type.Object({
  name: Type.String(), kind: Type.Union([Type.Literal("hello"), Type.Literal("command"), Type.Literal("control"), Type.Literal("event"), Type.Literal("response"), Type.Literal("error"), Type.Literal("pairing"), Type.Literal("attachment"), Type.Literal("export")]),
  valid: Type.Boolean(), message: Type.Object({}, { additionalProperties: true }),
}, { additionalProperties: true });

export type Hello = Static<typeof HelloSchema>;
export type Command = Static<typeof CommandSchema>;
export type Event = Static<typeof EventSchema>;
export type Response = Static<typeof ResponseSchema>;
export type ProtocolError = Static<typeof ErrorSchema>;
export type Fixture = Static<typeof FixtureSchema>;

const validators: Readonly<Record<Fixture["kind"], TypeCheck<TSchema>>> = {
  hello: TypeCompiler.Compile(HelloSchema), command: TypeCompiler.Compile(CommandSchema), event: TypeCompiler.Compile(EventSchema),
  control: TypeCompiler.Compile(ControlSchema), response: TypeCompiler.Compile(ResponseSchema), error: TypeCompiler.Compile(ErrorSchema),
  pairing: TypeCompiler.Compile(PairingSchema), attachment: TypeCompiler.Compile(AttachmentResponseSchema), export: TypeCompiler.Compile(ExportMetadataSchema),
};
const fixtureValidator = TypeCompiler.Compile(FixtureSchema);

export function validateFixture(value: unknown): boolean {
  if (!fixtureValidator.Check(value)) return false;
  const fixture = value as Fixture;
  return validators[fixture.kind].Check(fixture.message) === fixture.valid;
}

export function compareDecimalCursors(left: string, right: string): number {
  if (!new RegExp(DECIMAL_CURSOR_PATTERN).test(left) || !new RegExp(DECIMAL_CURSOR_PATTERN).test(right)) {
    throw new TypeError("cursor must be a non-negative canonical decimal string");
  }
  return left.length === right.length ? (left === right ? 0 : left < right ? -1 : 1) : left.length < right.length ? -1 : 1;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key.normalize("NFC"), canonicalize(item)] as const)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index - 1]![0] === entries[index]![0]) throw new TypeError("canonical object contains duplicate NFC-normalized keys");
    }
    return Object.fromEntries(entries);
  }
  return value;
}

export interface SemanticCommand {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export function canonicalSemanticCommand(command: SemanticCommand): string {
  return JSON.stringify(canonicalize({ payload: command.payload, type: command.type }));
}

export function semanticCommandSha256(command: SemanticCommand): string {
  return createHash("sha256").update(canonicalSemanticCommand(command), "utf8").digest("hex");
}

export function getProtocolIdentity(): { readonly major: 1; readonly minor: 0; readonly version: "1.0" } {
  return { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR, version: PROTOCOL_VERSION };
}
