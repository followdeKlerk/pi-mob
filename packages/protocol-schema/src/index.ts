import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";

export const PROTOCOL_MAJOR = 1 as const;
export const PROTOCOL_MINOR = 0 as const;
export const PROTOCOL_VERSION = "1.0" as const;

export const UUID_PATTERN =
	"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
export const DECIMAL_CURSOR_PATTERN = "^(0|[1-9][0-9]*)$";
export const ISO_UTC_PATTERN =
	"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{3})?Z$";

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
	// F0 — conservative caps for the closed shared envelopes. `reason` and
	// `remediation` are the long-form incident narrative on a
	// CapabilityStatus, so they get the larger 512-code-unit bound (the same
	// 512 code units the FIELD_GUIDE reserves for human-readable incident
	// text). `source` is the short identifier of the surface that produced a
	// status (host-bridge, session-bridge, pi runtime, …), so it shares the
	// 128-code-unit identifier bound used by activityId/turnId/planId/etc.
	// `errorMessage` is the human-readable incident text on ErrorInfoSchema
	// and shares the 512-code-unit narrative bound.
	maxReasonLength: 512,
	maxRemediationLength: 512,
	maxCapabilitySourceLength: 128,
	maxErrorMessageLength: 512,
	// F0 — bounded surfaces for the read-only workspace file browser (R3) and
	// the separate context inspector (R4). Bounds are expressed in UTF-16
	// code units (see the `maxLength` UTF-16 note in the FIELD_GUIDE).
	//
	//   R3 — read-only file browser
	//   - maxWorkspacePathLength: 1024 — upper bound on a root-relative
	//     workspace path. The bridge enforces canonicalization, rejects `..`
	//     and symlink escapes, and never returns absolute paths.
	//   - maxTreePageItems: 200, maxTreeDepth: 16 — bounded tree pagination.
	//   - maxFilenameSearchItems: 100 — bounded filename-search results.
	//   - maxContentSearchLines: 200, maxContentSearchBytes: 262144 (256 KiB)
	//     — bounded content-search matches; the bridge additionally caps the
	//     total UTF-8 bytes of the match window.
	//   - maxFileReadLines: 2000, maxFileReadBytes: 524288 (512 KiB) — bounded
	//     paginated text reads; rangeStart/rangeEnd are 1-based inclusive.
	//   - maxFileSize: 26214400 (25 MiB) — total file-size cap before the
	//     schema rejects the metadata payload with `path_oversize`.
	//   - maxFileAttachmentRefs: 4 — bounded count of revision-bound file
	//     attachment references per prompt; matches `maxAttachmentsPerPrompt`
	//     so a prompt can carry at most four image attachments OR four file
	//     references (not eight) without exceeding the per-prompt ceiling.
	//   - maxLanguageHintLength: 32 — bounded language identifier on
	//     metadata for syntax highlighting hints.
	//
	//   R4 — separate context inspector
	//   - maxPinnedFiles: 64, maxPinnedRanges: 16 — bounded pin surface.
	//   - maxContextInstructions: 4096 — bounded workspace instructions
	//     published on the snapshot (the bridge must clip larger values).
	//   - maxContextSourceSummary: 240 — bounded source summary text.
	//   - maxContextSourceKindLength: 32 — bounded source-kind identifier.
	//   - maxContextSourceIdLength: 128 — bounded source identifier; shares
	//     the canonical 128-code-unit identifier surface used by activityId /
	//     turnId / planId.
	//   - maxContextTokenUsageDigits: 16 — upper bound on the JS
	//     safe-integer decimal-digit count for token-usage telemetry.
	maxWorkspacePathLength: 1024,
	maxTreePageItems: 200,
	maxTreeDepth: 16,
	maxFilenameSearchItems: 100,
	maxContentSearchLines: 200,
	maxContentSearchBytes: 262_144,
	maxFileReadLines: 2000,
	maxFileReadBytes: 524_288,
	maxFileSize: 26_214_400,
	maxFileAttachmentRefs: 4,
	maxLanguageHintLength: 32,
	maxPinnedFiles: 64,
	maxPinnedRanges: 16,
	maxContextInstructions: 4096,
	maxContextSourceSummary: 240,
	maxContextSourceKindLength: 32,
	maxContextSourceIdLength: 128,
	maxContextTokenUsageDigits: 16,
	// R5 — supervised process/runtime supervision bounds.
	maxProcessIdLength: 128,
	maxProcessCommandLength: 1024,
	maxProcessCwdLength: 1024,
	maxProcessOutputLength: 262144,
	maxProcessPorts: 32,
	maxProcessSnapshotItems: 100,
	// F0 R6 — bounded surfaces for the lightweight Git/CI summary. Bounds are
	// expressed in UTF-16 code units (see the `maxLength` UTF-16 note in the
	// FIELD_GUIDE) so they stay consistent with every other F0 narrative /
	// identifier / URL cap. None of the R6 payloads carry diff / stage / hunk
	// / checkout fields: those belong to a future diff leaf and are explicitly
	// excluded at the schema layer so a caller cannot smuggle them through.
	//
	//   - maxRepositoryLabelLength: 128 — opaque `owner/repo` style label.
	//   - maxBranchLength: 128 — bounded branch name.
	//   - maxFailedChecks: 20 — the bounded failed-check surface; the schema
	//     rejects a 21st item, the bridge never silently truncates.
	//   - maxCheckNameLength: 128 — bounded per-check identifier.
	//   - maxCheckSummaryLength: 512 — bounded per-check narrative; shares the
	//     canonical 512-code-unit narrative bound used by `reason` / `message`.
	//   - maxExternalUrlLength: 1024 — bounded `https://` external URL (PR,
	//     commit, check); longer URLs are rejected at the schema layer. The
	//     regex additionally constrains the scheme + whitespace.
	//   - maxCommitShaLength: 64 — bounded SHA-1/SHA-256 commit identifier.
	//   - maxCommitMessageLength: 240 — bounded commit subject; the bridge
	//     clips to the first line so a multi-KiB commit body never lands on
	//     the summary card.
	//   - maxCommitAuthorLength: 128 — bounded commit author label.
	//   - maxGitPullRequestTitleLength: 240 — bounded PR title.
	//   - maxGitConfirmationIdLength: 128 — bounded opaque confirmation id;
	//     the bridge matches it against the user-confirmation record before
	//     dispatch.
	//   - maxGitSummaryHintLength: 240 — bounded commit/push prefill summary.
	maxRepositoryLabelLength: 128,
	maxBranchLength: 128,
	maxFailedChecks: 20,
	maxCheckNameLength: 128,
	maxCheckSummaryLength: 512,
	maxLogSummaryLength: 4096,
	maxGitCount: 1_000_000,
	maxExternalUrlLength: 1024,
	maxCommitShaLength: 64,
	maxCommitMessageLength: 240,
	maxCommitAuthorLength: 128,
	maxGitPullRequestTitleLength: 240,
	maxGitConfirmationIdLength: 128,
	maxGitSummaryHintLength: 240,
	maxAttentionSummaryLength: 240,
	maxAgentTaskLength: 512,
	maxAgentSummaryLength: 1024,
	maxAgentItems: 64,
	maxCatalogueEntries: 512,
} as const;

export const COMMAND_TYPES = [
	"controller.acquire",
	"controller.takeover",
	"controller.release",
	"host.display_name.set",
	"notification.device.register",
	"notification.device.unregister",
	"session.create",
	"session.activate",
	"session.stop",
	"session.rename",
	"session.delete",
	"session.restore",
	"session.purge",
	"session.fork",
	"session.clone",
	"session.export",
	"prompt.submit",
	"turn.abort",
	"queue.remove",
	"queue.clear",
	"model.set",
	"thinking.set",
	"steering_mode.set",
	"follow_up_mode.set",
	"compaction.start",
	"compaction.auto.set",
	"retry.auto.set",
	"retry.abort",
	"extension.respond",
	// F0 — additive context-inspector (R4) mutations. These are durable,
	// session-scoped commands; they are intentionally not controls/results.
	"context.pin",
	"context.unpin",
	"context.exclude",
	"context.refresh",
	// R5 — durable, revision-bound process actions.
	"process.stop",
	"process.restart",
	"process.rerun",
	// F0 R6 — durable, revision-bound Git/CI actions. These are session-scoped
	// commands that require the optional `git-ci.v1` capability; the bridge
	// advertises the surface only when it genuinely implements the bounded
	// Git/CI summary plus the explicit commit-through-Pi / push-through-Pi
	// actions. The payloads deliberately omit diff/stage/hunk/checkout fields
	// — the bridge never stages from mobile and never edits a hunk, so the
	// schema closes that surface.
	"git.commit.request",
	"git.push.request",
	"attention.resolve",
	"agent.steer",
	"agent.cancel",
	"agent.adopt",
	"agent.merge",
	"catalogue.set_enabled",
	"pi.rpc.request",
] as const;

export const EVENT_TYPES = [
	"host.state",
	"host.degraded",
	"host.draining",
	"host.capacity",
	"host.backup_state",
	"host.compatibility",
	"session.summary",
	"session.removed",
	"workspace.summary",
	"notification.capability",
	"command.state",
	"error.event",
	"session.state",
	"session.metadata",
	"session.tree",
	"controller.state",
	"turn.accepted",
	"turn.queued",
	"turn.started",
	"turn.waiting_for_input",
	"turn.retrying",
	"turn.compacting",
	"turn.settled",
	"turn.aborted",
	"turn.failed",
	"turn.indeterminate",
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
	"tool.cancelled",
	"queue.snapshot",
	"model.state",
	"context.state",
	"retry.state",
	"compaction.state",
	"extension.dialog",
	"extension.notify",
	"extension.status",
	"extension.widget",
	"extension.title",
	"extension.editor_prefill",
	// F0 — additive recipe (R1) and plan (R2) event families.
	"recipe.activity",
	"recipe.unavailable",
	"plan.snapshot",
	"plan.unavailable",
	// F0 — additive read-only file-browser (R3) workspace events. D-037
	// assigns all four to the mandatory host stream (v1 has no workspace
	// stream class); each closed payload carries the owning workspaceId.
	"workspace.tree.snapshot",
	"workspace.file.metadata",
	"workspace.file.stale",
	"workspace.file.unavailable",
	// F0 — additive context-inspector (R4) session events. The snapshot
	// event is a closed, bounded payload; the unavailable surface carries
	// the standard CapabilityStatus envelope.
	"context.snapshot",
	"context.unavailable",
	"process.snapshot",
	"process.output",
	"process.unavailable",
	"process.error",
	// F0 R6 — host-stream Git/CI event family. `git.summary` is the closed,
	// bounded summary payload pushed whenever the host refreshes the per-
	// workspace Git/CI state; `git.unavailable` carries the truthful no-
	// capability envelope when the bridge advertises `git-ci.v1` but the
	// surface is degraded / unreachable, mirroring the R3/R4 unavailable
	// pattern. The summary event owns the workspaceId so the mobile client
	// can reconcile it against the host workspace listing.
	"git.summary",
	"git.unavailable",
	"attention.item",
	"agent.snapshot",
	"agent.unavailable",
	"catalogue.snapshot",
	"catalogue.unavailable",
	"pi.rpc.response",
	"pi.rpc.event",
] as const;

export const RESPONSE_TYPES = [
	"hello.accepted",
	"subscription.accepted",
	"stream.sync.complete",
	"stream.snapshot.begin",
	"stream.snapshot.part",
	"stream.snapshot.end",
	"command.receipt",
	"command.current.result",
	"controller.renew.result",
	"session.list.result",
	"session.history.page.result",
	"workspace.list.result",
	"workspace.search.result",
	"model.list.result",
	// F0 — additive file-browser (R3) responses. Every response is bounded
	// and carries an opaque revision/page token so the mobile client can
	// reconcile drift and resume pagination. None of these exposes a write /
	// editor / diff / preview surface.
	"workspace.tree.page.result",
	"workspace.file.search.result",
	"workspace.file.content.search.result",
	"workspace.file.metadata.result",
	"workspace.file.read.result",
	// F0 — additive context-inspector (R4) responses. The snapshot response
	// is the only read response; durable mutations report through command
	// receipts/state and the resulting context.snapshot event.
	"context.snapshot.result",
	"agent.snapshot.result",
	"agent.transcript.page.result",
	"catalogue.snapshot.result",
	"process.snapshot.result",
	"process.output.page.result",
	// F0 R6 — additive Git/CI response. `git.summary.result` is the response
	// payload for the `git.summary.request` control; the durable commit/push
	// commands report through `command.receipt` / `command.state` / `command.
	// current.result`, mirroring the R5 process pattern.
	"git.summary.result",
	"pi.rpc.response",
] as const;
export const SUPPORTED_CAPABILITIES = [
	"streams.v1",
	"commands.v1",
	"controller_leases.v1",
	"attachments.v1",
	"extension_dialogs.v1",
	"notifications.v1",
	// F0 — additive capability literals for R3 (file browser) and R4 (context
	// inspector). The bridge advertises `files.v1` and/or `contexts.v1` only
	// when the host genuinely implements the corresponding bounded surface;
	// mobile clients map `unavailable` directly to a truthful "Files
	// unavailable" / "Context inspector unavailable" state, never to an
	// empty/fabricated tree/snapshot.
	"files.v1",
	"contexts.v1",
	"runtime.processes.v1",
	// F0 R6 — additive capability literal for the lightweight Git/CI summary.
	// The bridge advertises `git-ci.v1` only when the host genuinely implements
	// the bounded summary surface (repository label / branch / clean-dirty /
	// changed-count / ahead-behind / latest commit / bounded failed checks /
	// validated external URLs / bounded supported actions) AND the explicit
	// commit-through-Pi / push-through-Pi durable commands. Mobile clients
	// map absence directly to the truthful "Git/CI unavailable" state; a
	// fabricated summary is never published.
	"git-ci.v1",
	"attention.v1",
	"agents.v1",
	"catalogue.v1",
	"raw_rpc.v1",
] as const;
export const CONTROL_TYPES = [
	"subscription.set",
	"cursor.ack",
	"controller.renew",
	"host.snapshot.request",
	"session.snapshot.request",
	"session.list",
	"session.history.page",
	"workspace.list",
	"workspace.search",
	"model.list",
	"command.current",
	// R3 controls are repeatable, nonjournaled reads. R4 exposes only the
	// repeatable snapshot read; context mutations are durable commands above.
	"workspace.tree.page",
	"workspace.file.search",
	"workspace.file.content.search",
	"workspace.file.metadata",
	"workspace.file.read",
	"context.snapshot.request",
	"agent.snapshot.request",
	"agent.transcript.page",
	"catalogue.snapshot.request",
	"process.snapshot.request",
	"process.output.page",
	// F0 R6 — repeatable, nonjournaled Git/CI summary read and cancellation.
	// The request carries `workspaceId` so the bridge can resolve the per-
	// workspace summary. Cancellation targets the UUID `requestId` of an
	// in-flight summary request; durable commit/push commands are listed in
	// COMMAND_TYPES above.
	"git.summary.request",
	"git.summary.cancel",
] as const;

export const ERROR_CODES = [
	"invalid_message",
	"unsupported_protocol",
	"unsupported_capability",
	"host_identity_mismatch",
	"stale_connection",
	"host_draining",
	"host_not_ready",
	"host_capacity",
	"stream_not_found",
	"cursor_invalid",
	"snapshot_failed",
	"session_not_found",
	"session_deleted",
	"session_incompatible",
	"session_repair_required",
	"workspace_not_found",
	"workspace_not_allowed",
	"workspace_unavailable",
	"controller_required",
	"controller_conflict",
	"stale_controller",
	"command_not_found",
	"idempotency_conflict",
	"queue_full",
	"queue_item_not_found",
	"invalid_state",
	"attachment_unavailable",
	"export_unavailable",
	"payload_too_large",
	"rate_limited",
	"slow_consumer",
	"pi_unavailable",
	"pi_version_mismatch",
	"provider_interrupted",
	"permission_denied",
	// Phase 4 — application-layer authentication. `invalid_auth` covers
	// every credential rejection mode (missing / wrong / revoked /
	// expired). `re_pair_required` is returned only for legacy /
	// not-bound clients so the mobile UI can render a distinct
	// actionable message.
	"invalid_auth",
	"re_pair_required",
	"crash_loop",
	"database_unavailable",
	"storage_full",
	"migration_required",
	"internal_error",
	// F0 — additive stability codes for recipe (R1) and plan (R2) flows.
	"recipe_unavailable",
	"plan_unavailable",
	"stale_plan_target",
	// F0 — additive stability codes for the read-only file browser (R3) and
	// the context inspector (R4). Every code below is bounded, additive, and
	// safe for direct display in the inspector/ browser surface.
	//   - `path_not_found`         — root-relative path does not exist
	//   - `path_outside_workspace` — canonicalization/symlink/`..` escape
	//   - `path_binary`            — file cannot be read as text
	//   - `path_oversize`          — file exceeds the file-size cap
	//   - `file_stale`             — attached file's revision has changed
	//   - `file_unavailable`       — file surface unavailable / unreadable
	//   - `context_pin_failed`     — pin / unpin / exclude refused
	//   - `context_unavailable`    — context surface unavailable
	"path_not_found",
	"path_outside_workspace",
	"path_binary",
	"path_oversize",
	"file_stale",
	"file_unavailable",
	"context_pin_failed",
	"context_unavailable",
	"process_unavailable",
	"process_not_found",
	"process_stale",
	"process_failed",
	// F0 R6 — additive stability codes for the lightweight Git/CI summary.
	// Every code below is bounded, additive, and safe for direct display in
	// the Git/CI inspector card. The mapping matches the truthful unavailable
	// cards called out in REMAINING_UX_PLAN §R6:
	//   - `git_unavailable`         — capability not advertised / surface gone
	//   - `git_remote_missing`      — repository has no configured remote
	//   - `git_provider_unavailable`— provider CLI / service is down
	//   - `git_auth_missing`        — credentials absent or expired
	//   - `git_stale`               — `expectedRevision` no longer matches
	//                                 the authoritative summary revision
	//   - `git_action_failed`       — durable commit/push refused or aborted
	//                                 by the host / provider
	"git_unavailable",
	"git_remote_missing",
	"git_provider_unavailable",
	"git_auth_missing",
	"git_stale",
	"git_action_failed",
	// R7/R8/R9 — typed failures for authoritative attention, agent, and
	// catalogue surfaces. These mirror the revision-bound process/Git
	// vocabulary so mobile can distinguish unavailable, missing, stale, and
	// rejected actions without parsing prose.
	"attention_unavailable",
	"attention_not_found",
	"attention_stale",
	"agent_unavailable",
	"agent_not_found",
	"agent_stale",
	"agent_action_failed",
	"catalogue_unavailable",
	"catalogue_not_found",
	"catalogue_stale",
	"catalogue_action_failed",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type StreamOwnership = "host" | "session" | "host-or-session";
export const STREAM_ID_PATTERN = `^(host|session):${UUID_PATTERN.slice(1, -1)}$`;

export interface CommandMetadata {
	readonly type: CommandType;
	readonly scope: "host" | "session" | "host-or-session";
	readonly requiresLeaseId: boolean;
	readonly requiredCapability:
		| "commands.v1"
		| "runtime.processes.v1"
		| "git-ci.v1"
		| "attention.v1"
		| "agents.v1"
		| "catalogue.v1";
	readonly acceptedStates: readonly string[];
	readonly semanticHashFields: readonly ["type", "payload"];
	readonly idempotency: "command-id-semantic-payload-sha256";
	readonly recovery: "accepted-undispatched-dispatch-once;running-at-crash-indeterminate";
	readonly journaledEffects: readonly ["command.state"];
	readonly stableErrors: readonly string[];
}

const controllerCommands = new Set<CommandType>([
	"controller.acquire",
	"controller.takeover",
	"controller.release",
]);
const hostCommands = new Set<CommandType>([
	"controller.acquire",
	"controller.takeover",
	"controller.release",
	"host.display_name.set",
	"notification.device.register",
	"notification.device.unregister",
	"session.create",
]);
const leaseFreeCommands = new Set<CommandType>([
	...controllerCommands,
	"session.create",
	"session.delete",
	"notification.device.register",
	"notification.device.unregister",
]);
// R5 — process.* commands are gated on `runtime.processes.v1` (the bridge
// advertises the surface only when the host genuinely implements the
// bounded process supervision; absence maps to the truthful
// `process_unavailable` posture). The stableErrors list is the additive
// process-specific subset of ERROR_CODES so clients can render a typed
// failure with the same vocabulary the `process.error` event uses.
const processCommands = new Set<CommandType>([
	"process.stop",
	"process.restart",
	"process.rerun",
]);
const processStableErrors = [
	"process_unavailable",
	"process_not_found",
	"process_stale",
	"process_failed",
] as const;
// F0 R6 — git.commit.request / git.push.request are gated on the optional
// `git-ci.v1` capability (the bridge advertises the surface only when it
// genuinely implements the bounded Git/CI summary AND the explicit
// commit-through-Pi / push-through-Pi durable commands). The stableErrors
// list is the additive git-specific subset of ERROR_CODES so clients can
// render a typed failure with the same vocabulary the `git.unavailable`
// event uses.
const gitCommands = new Set<CommandType>([
	"git.commit.request",
	"git.push.request",
]);
const gitStableErrors = [
	"git_unavailable",
	"git_remote_missing",
	"git_provider_unavailable",
	"git_auth_missing",
	"git_stale",
	"git_action_failed",
] as const;
const attentionCommands = new Set<CommandType>(["attention.resolve"]);
const attentionStableErrors = [
	"attention_unavailable",
	"attention_not_found",
	"attention_stale",
] as const;
const agentCommands = new Set<CommandType>([
	"agent.steer",
	"agent.cancel",
	"agent.adopt",
	"agent.merge",
]);
const agentStableErrors = [
	"agent_unavailable",
	"agent_not_found",
	"agent_stale",
	"agent_action_failed",
] as const;
const catalogueCommands = new Set<CommandType>(["catalogue.set_enabled"]);
const catalogueStableErrors = [
	"catalogue_unavailable",
	"catalogue_not_found",
	"catalogue_stale",
	"catalogue_action_failed",
] as const;
const baseStableErrors = [
	"invalid_message",
	"unsupported_capability",
	"invalid_state",
	"idempotency_conflict",
] as const;

export const COMMAND_METADATA: readonly CommandMetadata[] = COMMAND_TYPES.map(
	(type) => ({
		type,
		scope: controllerCommands.has(type)
			? "host-or-session"
			: hostCommands.has(type)
				? "host"
				: "session",
		requiresLeaseId: !leaseFreeCommands.has(type),
		requiredCapability: processCommands.has(type)
			? "runtime.processes.v1"
			: catalogueCommands.has(type)
				? "catalogue.v1"
				: agentCommands.has(type)
					? "agents.v1"
				: attentionCommands.has(type)
					? "attention.v1"
				: gitCommands.has(type)
					? "git-ci.v1"
				: "commands.v1",
		acceptedStates: [
			"protocol-valid",
			"capability-supported",
			"state-eligible",
		],
		semanticHashFields: ["type", "payload"],
		idempotency: "command-id-semantic-payload-sha256",
		recovery:
			"accepted-undispatched-dispatch-once;running-at-crash-indeterminate",
		journaledEffects: ["command.state"],
		stableErrors: processCommands.has(type)
			? [...baseStableErrors, ...processStableErrors]
			: gitCommands.has(type)
				? [...baseStableErrors, ...gitStableErrors]
				: attentionCommands.has(type)
					? [...baseStableErrors, ...attentionStableErrors]
					: agentCommands.has(type)
						? [...baseStableErrors, ...agentStableErrors]
						: catalogueCommands.has(type)
							? [...baseStableErrors, ...catalogueStableErrors]
							: [...baseStableErrors],
	}),
);

const hostEventTypes = new Set<EventType>([
	"host.state",
	"host.degraded",
	"host.draining",
	"host.capacity",
	"host.backup_state",
	"host.compatibility",
	"session.summary",
	"session.removed",
	"workspace.summary",
	"notification.capability",
	// D-037: workspace invalidations are owned by the mandatory host stream.
	"workspace.tree.snapshot",
	"workspace.file.metadata",
	"workspace.file.stale",
	"workspace.file.unavailable",
	// F0 R6: Git/CI summary / unavailable invalidations are owned by the
	// mandatory host stream (v1 has no workspace stream class). Each payload
	// carries the owning workspaceId so the mobile client can reconcile the
	// event against its host workspace listing.
	"git.summary",
	"git.unavailable",
	// R2 — plan.unavailable is the capability-state envelope (no sessionId) so
	// it rides on the mandatory host stream. `plan.snapshot` carries a
	// sessionId and stays on the per-session stream.
	"recipe.unavailable",
	"plan.unavailable",
	// R7/R8/R9 — capability-state envelopes (no sessionId) ride the host
	// stream. `attention.item` carries a sessionId and stays on the per-
	// session stream; `agent.snapshot` / `catalogue.snapshot` carry only a
	// revision + items array and are authoritative host state.
	"agent.unavailable",
	"catalogue.snapshot",
	"catalogue.unavailable",
]);
export const EVENT_STREAM_OWNERSHIP: Readonly<
	Record<EventType, StreamOwnership>
> = Object.fromEntries(
	EVENT_TYPES.map((type) => [
		type,
		type === "command.state" || type === "error.event"
			? "host-or-session"
			: hostEventTypes.has(type)
				? "host"
				: "session",
	]),
) as Readonly<Record<EventType, StreamOwnership>>;

export const UuidSchema = Type.String({
	pattern: UUID_PATTERN,
	$id: "pi-mob/protocol/uuid",
});
export const DecimalCursorSchema = Type.String({
	pattern: DECIMAL_CURSOR_PATTERN,
	$id: "pi-mob/protocol/decimal-cursor",
});
export const CapabilitySchema = Type.Union(
	SUPPORTED_CAPABILITIES.map((value) => Type.Literal(value)),
	{ $id: "pi-mob/protocol/capability" },
);
const Uuid = UuidSchema;

// F0 — shared explicit primitives for recipe (R1) and plan (R2) flows.
// RevisionToken is intentionally distinct from DECIMAL_CURSOR_PATTERN so that
// callers cannot accidentally substitute one for the other.
export const RevisionTokenSchema = Type.String({
	pattern: "^[A-Za-z][A-Za-z0-9_.:-]{0,127}$",
	$id: "pi-mob/protocol/revision-token",
});
// F0 — capability states for recipe (R1) and plan (R2) flows. "stale" covers
// revisions whose TTL or trust window has elapsed without an explicit outage.
// Exported so bridge and schema consumers can iterate the full state set
// without re-hardcoding the union of CapabilityStatusSchema variants.
export const CAPABILITY_STATES = [
	"available",
	"degraded",
	"unavailable",
	"stale",
] as const;
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
export const CapabilityStatusSchema = Type.Union(
	[
		Type.Object(
			{
				state: Type.Literal("available"),
				reason: Type.Optional(
					Type.String({ minLength: 1, maxLength: LIMITS.maxReasonLength }),
				),
				remediation: Type.Optional(
					Type.String({ minLength: 1, maxLength: LIMITS.maxRemediationLength }),
				),
				source: Type.Optional(
					Type.String({
						minLength: 1,
						maxLength: LIMITS.maxCapabilitySourceLength,
					}),
				),
				revision: Type.Optional(RevisionTokenSchema),
				lastRefreshedAt: Type.Optional(
					Type.String({ pattern: ISO_UTC_PATTERN }),
				),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/capability-status#available",
			},
		),
		Type.Object(
			{
				state: Type.Literal("degraded"),
				reason: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxReasonLength,
				}),
				remediation: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRemediationLength,
				}),
				source: Type.Optional(
					Type.String({
						minLength: 1,
						maxLength: LIMITS.maxCapabilitySourceLength,
					}),
				),
				revision: Type.Optional(RevisionTokenSchema),
				lastRefreshedAt: Type.Optional(
					Type.String({ pattern: ISO_UTC_PATTERN }),
				),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/capability-status#degraded",
			},
		),
		Type.Object(
			{
				state: Type.Literal("unavailable"),
				reason: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxReasonLength,
				}),
				remediation: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRemediationLength,
				}),
				source: Type.Optional(
					Type.String({
						minLength: 1,
						maxLength: LIMITS.maxCapabilitySourceLength,
					}),
				),
				revision: Type.Optional(RevisionTokenSchema),
				lastRefreshedAt: Type.Optional(
					Type.String({ pattern: ISO_UTC_PATTERN }),
				),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/capability-status#unavailable",
			},
		),
		Type.Object(
			{
				state: Type.Literal("stale"),
				reason: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxReasonLength,
				}),
				remediation: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRemediationLength,
				}),
				source: Type.Optional(
					Type.String({
						minLength: 1,
						maxLength: LIMITS.maxCapabilitySourceLength,
					}),
				),
				revision: Type.Optional(RevisionTokenSchema),
				lastRefreshedAt: Type.Optional(
					Type.String({ pattern: ISO_UTC_PATTERN }),
				),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/capability-status#stale",
			},
		),
	],
	{ $id: "pi-mob/protocol/capability-status" },
);
export const BoundsSchema = Type.Object(
	{
		maxItems: Type.Optional(Type.Integer({ minimum: 0 })),
		maxBytes: Type.Optional(Type.Integer({ minimum: 0 })),
		maxLines: Type.Optional(Type.Integer({ minimum: 0 })),
		maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
		maxDurationMs: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/bounds" },
);
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
export const TruncationSchema = Type.Object(
	{
		retainedBytes: Type.Integer({ minimum: 0 }),
		totalBytes: Type.Integer({ minimum: 0 }),
		digest: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
		isTruncated: Type.Boolean(),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/truncation" },
);
// F0 — TimingSchema is a closed, bounded timing envelope. `startedAt` is
// REQUIRED and matches the canonical ISO-UTC pattern; `updatedAt`,
// `finishedAt`, and `durationMs` are optional and let a partial timing block
// be published before the recipe activity finishes. `additionalProperties:
// false` is mandatory: the timing surface is one of the privacy-sensitive
// nested shapes called out in FIELD_GUIDE §"schema-authoring traps", and
// closing the shape prevents a bridge call site from smuggling `private` /
// `internal` / `debug` bookkeeping alongside the declared timing fields.
export const TimingSchema = Type.Object(
	{
		startedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		updatedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		finishedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/timing" },
);
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
export const ErrorInfoSchema = Type.Object(
	{
		code: Type.Union(ERROR_CODES.map((value) => Type.Literal(value))),
		message: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxErrorMessageLength,
		}),
		retryable: Type.Boolean(),
		recommendedDelayMs: Type.Optional(
			Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/error-info" },
);
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
export const ProviderSummarySchema = Type.Object(
	{
		kind: Type.Literal("provider_summary"),
		provider: Type.String({ minLength: 1, maxLength: 128 }),
		model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		summary: Type.String({ minLength: 1, maxLength: 1024 }),
		truncation: Type.Optional(TruncationSchema),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/provider-summary" },
);

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
export const PlanTargetSchema = Type.Object(
	{
		planId: Type.String({ minLength: 1, maxLength: LIMITS.maxPlanIdLength }),
		stepId: Type.String({ minLength: 1, maxLength: LIMITS.maxStepIdLength }),
		revision: RevisionTokenSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/plan-target" },
);

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
export const RecipeActivitySchema = Type.Union(
	[
		Type.Object(
			{
				kind: Type.Literal("thinking"),
				sessionId: Uuid,
				turnId: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxTurnIdLength,
				}),
				activityId: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeActivityIdLength,
				}),
				ordinal: Type.Integer({ minimum: 0 }),
				status: Type.Union(
					["pending", "running", "completed", "failed", "cancelled"].map(
						(value) => Type.Literal(value),
					),
				),
				timing: TimingSchema,
				title: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeTitleLength,
				}),
				providerSummary: Type.Optional(ProviderSummarySchema),
				truncation: Type.Optional(TruncationSchema),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/recipe-activity#thinking",
			},
		),
		Type.Object(
			{
				kind: Type.Literal("tool"),
				sessionId: Uuid,
				turnId: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxTurnIdLength,
				}),
				activityId: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeActivityIdLength,
				}),
				ordinal: Type.Integer({ minimum: 0 }),
				status: Type.Union(
					["pending", "running", "completed", "failed", "cancelled"].map(
						(value) => Type.Literal(value),
					),
				),
				timing: TimingSchema,
				title: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeTitleLength,
				}),
				toolName: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxToolNameLength,
				}),
				arguments: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeArgumentsLength,
				}),
				output: Type.String({
					minLength: 1,
					maxLength: LIMITS.maxRecipeOutputLength,
				}),
				errorInfo: Type.Optional(ErrorInfoSchema),
				truncation: Type.Optional(TruncationSchema),
			},
			{
				additionalProperties: false,
				$id: "pi-mob/protocol/recipe-activity#tool",
			},
		),
	],
	{ $id: "pi-mob/protocol/recipe-activity" },
);

// F0 — PlanStepSchema is the closed, bounded shape for one R2 plan step.
// Identifiers and titles are bounded opaque text; the `blocker` and `timing`
// fields are optional so an idle step (status `pending` / `skipped`) can
// publish without inventing blocker or timing metadata. The plan-step state
// set (`pending | running | completed | blocked | skipped`) is distinct from
// the recipe-activity state set.
export const PlanStepSchema = Type.Object(
	{
		stepId: Type.String({ minLength: 1, maxLength: LIMITS.maxStepIdLength }),
		title: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxRecipeTitleLength,
		}),
		status: Type.Union(
			["pending", "running", "completed", "blocked", "skipped"].map((value) =>
				Type.Literal(value),
			),
		),
		blocker: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxPlanBlockerLength }),
		),
		timing: Type.Optional(TimingSchema),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/plan-step" },
);

// F0 — PlanSnapshotSchema is the closed R2 authoritative-plan event payload.
// `planId` and the required `revision` pinpoint the snapshot; `steps` is a
// closed array bounded by `LIMITS.maxPlanSteps` (64). Anything bigger is
// rejected by the schema; the bridge never silently truncates.
// The required identity / status envelope lets a mobile client attribute a
// snapshot to its owning session and turn, identify the producing surface
// (`source`, bounded by `maxCapabilitySourceLength`), know whether the
// snapshot is itself stale (the boolean `stale`), and (via the closed
// `capability` CapabilityStatus) recover the same R2 capability posture
// the unavailable surface would carry. Every field is required so a
// downstream cache can replay / dedupe / correlate without re-fetching.
export const PlanSnapshotSchema = Type.Object(
	{
		planId: Type.String({ minLength: 1, maxLength: LIMITS.maxPlanIdLength }),
		revision: RevisionTokenSchema,
		sessionId: Uuid,
		turnId: Type.String({ minLength: 1, maxLength: LIMITS.maxTurnIdLength }),
		source: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxCapabilitySourceLength,
		}),
		stale: Type.Boolean(),
		capability: CapabilityStatusSchema,
		steps: Type.Array(PlanStepSchema, { maxItems: LIMITS.maxPlanSteps }),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/plan-snapshot" },
);

// F0 — capability literal for the recipe (R1) unavailable surface.
export const RECIPE_CAPABILITY = "recipes.v1" as const;
// F0 — capability literal for the plan (R2) unavailable surface.
export const PLAN_CAPABILITY = "plans.v1" as const;

// F0 — RecipeUnavailableSchema / PlanUnavailableSchema carry the capability
// identifier of the unavailable surface plus a closed `CapabilityStatus`.
// `capability` is REQUIRED so a mobile client can attribute the unavailable
// state to a specific surface without parsing the envelope type.
export const RecipeUnavailableSchema = Type.Object(
	{
		capability: Type.Literal(RECIPE_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/recipe-unavailable" },
);

export const PlanUnavailableSchema = Type.Object(
	{
		capability: Type.Literal(PLAN_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/plan-unavailable" },
);

// F0 — capability literal for the read-only file browser (R3).
export const FILES_CAPABILITY = "files.v1" as const;
// F0 — capability literal for the context inspector (R4).
export const CONTEXTS_CAPABILITY = "contexts.v1" as const;

// F0 — R3 WorkspacePathSchema. Root-relative workspace path. The schema
// enforces only the static shape (length 1..1024 UTF-16 code units, no
// NUL, no carriage return, no line feed, no leading slash, no `..`
// segment, no backslash, no whitespace control characters). The bridge
// additionally enforces canonicalization, symlink resolution, and
// `..`-escape rejection against the workspace root — those invariants
// require filesystem state and cannot be expressed in a regex without
// losing honest closed-shape guarantees. The schema rejects a leading
// slash, a literal `..` or `.` segment, backslashes, double slashes,
// and NUL/CR/LF so any caller passing a manifest path already violates
// the contract before the bridge ever touches the filesystem. The
// segment check is precise: a `.` or `..` segment is rejected wherever
// it appears (start, middle, or end of the path), but dotfile segments
// like `.git` are explicitly permitted — only an exact `.` or exact
// `..` segment is rejected.
export const WORKSPACE_PATH_PATTERN =
	"^(?!/)(?!.*//)(?!.*\\\\)(?!.*(?:^|/)\\.\\.?(?:/|$))[^\\x00-\\x1F\\x7F]{1,1024}$";
export const WorkspacePathSchema = Type.String({
	pattern: WORKSPACE_PATH_PATTERN,
	maxLength: LIMITS.maxWorkspacePathLength,
	$id: "pi-mob/protocol/workspace-path",
});

// F0 — R3 LineRangeSchema. A bounded 1-based inclusive line range. The
// bridge MUST enforce `endLine >= startLine` and reject ranges that
// exceed the file's actual line count with `path_oversize`.
export const LineRangeSchema = Type.Object(
	{
		startLine: Type.Integer({ minimum: 1 }),
		endLine: Type.Integer({ minimum: 1 }),
		label: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/line-range" },
);

// F0 — R3 FileNodeSchema. One entry of a paginated workspace tree. `kind`
// distinguishes file vs directory. File-only fields (`size`, `sha256`,
// `isBinary`, `modifiedAt`) are optional so a directory entry can omit
// them and a sparsely-indexed tree can publish size without a digest.
// All paths are root-relative.
export const FileNodeSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
		depth: Type.Integer({ minimum: 0, maximum: LIMITS.maxTreeDepth }),
		size: Type.Optional(
			Type.Integer({ minimum: 0, maximum: LIMITS.maxFileSize }),
		),
		childCount: Type.Optional(
			Type.Integer({ minimum: 0, maximum: LIMITS.maxTreePageItems }),
		),
		modifiedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		sha256: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
		isBinary: Type.Optional(Type.Boolean()),
		languageHint: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxLanguageHintLength }),
		),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/file-node" },
);

// F0 — R3 FileSearchMatchSchema. A single filename-search hit. `matchStart`
// and `matchLength` are byte offsets into the path string (UTF-8); the
// bridge clamps invalid ranges before publish.
export const FileSearchMatchSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		matchStart: Type.Optional(Type.Integer({ minimum: 0 })),
		matchLength: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/file-search-match" },
);

// F0 — R3 ContentSearchMatchSchema. A single content-search hit. `line` and
// `column` are 1-based UTF-8 character positions into the line and the
// lineText. `matchStart` is the byte offset of the match into `lineText`;
// `matchLength` is the byte length. `lineText` is bounded and never
// carries the surrounding untrimmed window.
export const ContentSearchMatchSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		line: Type.Integer({ minimum: 1 }),
		column: Type.Integer({ minimum: 1 }),
		matchStart: Type.Integer({ minimum: 0 }),
		matchLength: Type.Integer({ minimum: 1 }),
		lineText: Type.String({ minLength: 0, maxLength: 4096 }),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/content-search-match" },
);

// F0 — R3 FileMetadataSchema. Authoritative file metadata published in
// response to `workspace.file.metadata` and pushed as a workspace event.
// `size` and `modifiedAt` are REQUIRED; `sha256` is OPTIONAL because the
// bridge may have a stat without a digest (a freshly written file the
// host has not yet hashed). `isBinary` is REQUIRED so the mobile UI can
// refuse to render text-mode view without re-fetching. `revision` pins
// the metadata snapshot so the mobile client can detect drift; the
// `lastReadAt` ISO timestamp is the bridge's read time of this snapshot.
export const FileMetadataSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		size: Type.Integer({ minimum: 0, maximum: LIMITS.maxFileSize }),
		sha256: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
		isBinary: Type.Boolean(),
		modifiedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		revision: RevisionTokenSchema,
		lastReadAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		languageHint: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxLanguageHintLength }),
		),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/file-metadata" },
);

// F0 — R3 FileReadResultSchema. A bounded, paginated text read. `rangeStart`
// and `rangeEnd` are 1-based inclusive line indices into the file. The
// bridge MUST enforce `endLine >= startLine`, `rangeEnd - rangeStart + 1
// <= LIMITS.maxFileReadLines`, and UTF-8 byte budget
// (`content.length` in UTF-8 <= LIMITS.maxFileReadBytes). `totalLines`
// reports the file's full line count so the client can drive further
// pages. `isTruncated` and the optional `truncation` block describe
// whether the returned range itself was clipped to the byte budget.
// `encoding` is fixed at `"utf-8"` for v1 — binary reads are rejected at
// the bridge with `path_binary`. `lastModifiedAt` and `revision` mirror
// the metadata; clients compare against their attachment references.
export const FileReadResultSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		revision: RevisionTokenSchema,
		rangeStart: Type.Integer({ minimum: 1 }),
		rangeEnd: Type.Integer({ minimum: 1 }),
		totalLines: Type.Integer({ minimum: 0 }),
		content: Type.String({ minLength: 0, maxLength: LIMITS.maxFileReadBytes }),
		encoding: Type.Literal("utf-8"),
		isTruncated: Type.Boolean(),
		truncation: Type.Optional(TruncationSchema),
		lastModifiedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/file-read-result" },
);

// F0 — R3 FileAttachmentReferenceSchema. A revision-bound file reference
// attached to a `prompt.submit`. The bridge validates the reference at
// send time: if `revision` no longer matches the current file revision,
// the prompt is rejected with `file_stale` BEFORE dispatch. `ranges` is
// optional and selects a line span; omitting it attaches the entire file.
// `digest` is the file's SHA-256 at the time the user attached it so the
// bridge can also reject a same-revision but byte-changed file (rare but
// possible if the host allowed a same-revision rewrite). The schema is
// `additionalProperties: false` so a caller cannot smuggle `private`,
// `internal`, or `debug` fields alongside a closed attachment.
export const FileAttachmentReferenceSchema = Type.Object(
	{
		workspaceId: Uuid,
		path: WorkspacePathSchema,
		ranges: Type.Optional(
			Type.Array(LineRangeSchema, { maxItems: LIMITS.maxPinnedRanges }),
		),
		digest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
		revision: RevisionTokenSchema,
	},
	{
		additionalProperties: false,
		$id: "pi-mob/protocol/file-attachment-reference",
	},
);

// F0 — R3 WorkspaceTreeSnapshotEventSchema. A host-stream event scoped by
// workspaceId that announces a new tree revision (lazy: the tree is not
// pushed in full; the mobile client requests pages on demand). `rootRevision` is the
// opaque revision of the entire workspace tree; `changeSet` lists paths
// that have been added/removed/modified since the prior root revision.
// `capability` is REQUIRED so a mobile client can correlate the snapshot
// with the file-surface capability status.
export const WorkspaceTreeSnapshotEventSchema = Type.Object(
	{
		workspaceId: Uuid,
		rootRevision: RevisionTokenSchema,
		changeSet: Type.Array(WorkspacePathSchema, { maxItems: 1024 }),
		capability: Type.Literal(FILES_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{
		additionalProperties: false,
		$id: "pi-mob/protocol/workspace-tree-snapshot",
	},
);

// F0 — R3 WorkspaceFileMetadataEventSchema. A workspace-stream event that
// pushes fresh metadata for a single file. `file` is the authoritative
// metadata snapshot; `previousRevision` lets the client detect drift
// without re-querying.
export const WorkspaceFileMetadataEventSchema = Type.Object(
	{
		workspaceId: Uuid,
		file: FileMetadataSchema,
		previousRevision: Type.Optional(RevisionTokenSchema),
		capability: Type.Literal(FILES_CAPABILITY),
	},
	{
		additionalProperties: false,
		$id: "pi-mob/protocol/workspace-file-metadata",
	},
);

// F0 — R3 WorkspaceFileStaleEventSchema. Emitted when a file revision
// the mobile client has attached (or pinned in the context inspector)
// has been replaced on disk. The event tells the client which path went
// stale and the new authoritative revision so it can mark the attached
// reference or pinned file stale and offer a refresh.
export const WorkspaceFileStaleEventSchema = Type.Object(
	{
		workspaceId: Uuid,
		path: WorkspacePathSchema,
		previousRevision: RevisionTokenSchema,
		currentRevision: RevisionTokenSchema,
		modifiedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		capability: Type.Literal(FILES_CAPABILITY),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/workspace-file-stale" },
);

// F0 — R3 WorkspaceFileUnavailableEventSchema. Carries the capability
// identifier of the file surface plus a closed `CapabilityStatus`.
export const WorkspaceFileUnavailableEventSchema = Type.Object(
	{
		workspaceId: Uuid,
		capability: Type.Literal(FILES_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{
		additionalProperties: false,
		$id: "pi-mob/protocol/workspace-file-unavailable",
	},
);

// F0 — R4 PinnedFileSchema. One entry in the inspector's `pinnedFiles`
// array. `ranges` is optional: omitting it pins the entire file; each
// range selects a 1-based inclusive line span. `pinnedAt` is the bridge
// publish time; the schema is `additionalProperties: false` so a bridge
// caller cannot smuggle `private`/`internal`/`debug` siblings alongside
// the declared pin fields.
export const PinnedFileSchema = Type.Object(
	{
		path: WorkspacePathSchema,
		pinnedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		ranges: Type.Optional(
			Type.Array(LineRangeSchema, { maxItems: LIMITS.maxPinnedRanges }),
		),
		revision: RevisionTokenSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/pinned-file" },
);

// F0 — R4 TokenUsageSchema. Closed, bounded token-usage telemetry. All
// token-count fields are canonical decimal STRINGS — the bridge never
// rounds or re-encodes the value, so JS `Number` precision loss is
// impossible (a 17-digit value already exceeds Number.MAX_SAFE_INTEGER).
// The pattern enforces a single canonical form: either the literal
// "0" or a nonzero digit followed by 0..15 additional decimal digits,
// so the maximum length is 16 digits (e.g. "9999999999999999"). No
// leading zeros, no decimal point, no exponent notation, no sign. The
// schema proves only the string shape; the bridge computes the actual
// totals from provider-supplied usage and re-measures them at publish.
// `usagePercent` (0..1) is an optional convenience field the inspector
// surfaces as a progress indicator and remains a numeric value because
// it is a derived ratio, not a token count.
export const TOKEN_USAGE_DIGITS_PATTERN = "^(0|[1-9][0-9]{0,15})$";
export const TokenUsageSchema = Type.Object(
	{
		inputTokens: Type.String({ pattern: TOKEN_USAGE_DIGITS_PATTERN }),
		outputTokens: Type.String({ pattern: TOKEN_USAGE_DIGITS_PATTERN }),
		cacheReadTokens: Type.Optional(
			Type.String({ pattern: TOKEN_USAGE_DIGITS_PATTERN }),
		),
		cacheWriteTokens: Type.Optional(
			Type.String({ pattern: TOKEN_USAGE_DIGITS_PATTERN }),
		),
		contextWindowTokens: Type.Optional(
			Type.String({ pattern: TOKEN_USAGE_DIGITS_PATTERN }),
		),
		usagePercent: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/token-usage" },
);

// F0 — R4 ContextSourceSchema. One source in the inspector's `sources`
// array. `sourceKind` is bounded opaque text (file / instructions /
// command_output / agent_output / ...). `summary` is bounded narrative
// text — the inspector renders it directly, never reconstructs it. The
// per-source `stale` boolean lets the inspector flag stale sources
// individually (not just the global `stale` on the snapshot envelope).
export const ContextSourceSchema = Type.Object(
	{
		sourceId: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxContextSourceIdLength,
		}),
		sourceKind: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxContextSourceKindLength,
		}),
		summary: Type.String({
			minLength: 0,
			maxLength: LIMITS.maxContextSourceSummary,
		}),
		stale: Type.Boolean(),
		capability: CapabilityStatusSchema,
		revision: Type.Optional(RevisionTokenSchema),
		lastRefreshedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/context-source" },
);

// F0 — R4 ContextSnapshotSchema. The closed, bounded payload the
// context inspector renders. Every field is REQUIRED when listed as
// required; the optional groups are the genuinely optional bits the
// bridge may omit (e.g. when there is no model yet, no instructions,
// no pinned files, no token usage, no compaction yet). The required
// identity/status envelope (`sessionId`, `revision`, `source`,
// `stale`, `capability`) lets a mobile client attribute the snapshot
// to its owning session, identify the producing surface, know whether
// the snapshot is itself stale, and recover the same R4 capability
// posture the unavailable surface would carry.
//
// Schema-scope guarantees ONLY:
//   - shape, sign, length bounds, regex patterns, closed shape
//   - required identity/status envelope
// Out-of-scope (MUST be enforced by the bridge at publish and at
// receive):
//   - the relation `compacted === true` iff `compactRevision` and
//     `compactedAt` are populated (the schema does not see siblings)
//   - the validity of `model.provider`/`model.modelId` against the
//     catalogue (the schema is permissive)
//   - the actual values of `tokenUsage` (the bridge re-measures)
//   - any cross-source dedupe or ordering (the schema preserves input
//     order; the bridge deduplicates)
export const ContextSnapshotSchema = Type.Object(
	{
		sessionId: Uuid,
		revision: RevisionTokenSchema,
		source: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxCapabilitySourceLength,
		}),
		stale: Type.Boolean(),
		capability: CapabilityStatusSchema,
		model: Type.Optional(
			Type.Object(
				{
					provider: Type.String({ minLength: 1, maxLength: 128 }),
					modelId: Type.String({ minLength: 1, maxLength: 128 }),
				},
				{ additionalProperties: false, $id: "pi-mob/protocol/context-model" },
			),
		),
		thinkingLevel: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
		instructions: Type.Optional(
			Type.String({ minLength: 0, maxLength: LIMITS.maxContextInstructions }),
		),
		pinnedFiles: Type.Optional(
			Type.Array(PinnedFileSchema, { maxItems: LIMITS.maxPinnedFiles }),
		),
		tokenUsage: Type.Optional(TokenUsageSchema),
		compacted: Type.Optional(Type.Boolean()),
		compactRevision: Type.Optional(RevisionTokenSchema),
		compactedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		sources: Type.Optional(Type.Array(ContextSourceSchema, { maxItems: 64 })),
		lastRefreshedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/context-snapshot" },
);

// F0 — R4 ContextUnavailableEventSchema. Truthful no-context surface.
export const ContextUnavailableEventSchema = Type.Object(
	{
		sessionId: Uuid,
		capability: Type.Literal(CONTEXTS_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/context-unavailable" },
);

// D-037 context mutations are durable commands. `expectedRevision` is the
// authoritative session-snapshot revision and `target` is deliberately
// closed so command hashing cannot hide private/debug routing data in it.
// File and source targets cover pin/unpin/exclude; the `all` target is used by
// a session-wide refresh. The bridge still resolves paths and source IDs.
const ContextFileTargetSchema = Type.Object(
	{
		kind: Type.Literal("file"),
		path: WorkspacePathSchema,
		ranges: Type.Optional(
			Type.Array(LineRangeSchema, { maxItems: LIMITS.maxPinnedRanges }),
		),
		revision: Type.Optional(RevisionTokenSchema),
	},
	{ additionalProperties: false },
);
const ContextSourceTargetSchema = Type.Object(
	{
		kind: Type.Literal("source"),
		sourceId: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxContextSourceIdLength,
		}),
		revision: Type.Optional(RevisionTokenSchema),
	},
	{ additionalProperties: false },
);
const ContextAllTargetSchema = Type.Object(
	{ kind: Type.Literal("all") },
	{ additionalProperties: false },
);
export const ContextMutationTargetSchema = Type.Union(
	[ContextFileTargetSchema, ContextSourceTargetSchema, ContextAllTargetSchema],
	{ $id: "pi-mob/protocol/context-mutation-target" },
);
export const ContextMutationPayloadSchema = Type.Object(
	{
		sessionId: Uuid,
		expectedRevision: RevisionTokenSchema,
		target: ContextMutationTargetSchema,
	},
	{
		additionalProperties: false,
		$id: "pi-mob/protocol/context-mutation-payload",
	},
);

const PageTokenSchema = Type.Union([
	Type.String({ minLength: 1, maxLength: 256 }),
	Type.Null(),
]);
const WorkspaceQuerySchema = Type.String({ minLength: 1, maxLength: 512 });
const WorkspacePathOptional = Type.Optional(WorkspacePathSchema);
const WorkspaceTreePagePayloadSchema = Type.Object(
	{
		workspaceId: Uuid,
		path: WorkspacePathOptional,
		rootRevision: Type.Optional(RevisionTokenSchema),
		pageSize: Type.Integer({ minimum: 1, maximum: LIMITS.maxTreePageItems }),
		pageToken: PageTokenSchema,
	},
	{ additionalProperties: false },
);
const WorkspaceFileSearchPayloadSchema = Type.Object(
	{
		workspaceId: Uuid,
		query: WorkspaceQuerySchema,
		path: WorkspacePathOptional,
		pageSize: Type.Optional(
			Type.Integer({ minimum: 1, maximum: LIMITS.maxFilenameSearchItems }),
		),
		pageToken: Type.Optional(PageTokenSchema),
	},
	{ additionalProperties: false },
);
const WorkspaceContentSearchPayloadSchema = Type.Object(
	{
		workspaceId: Uuid,
		query: WorkspaceQuerySchema,
		path: WorkspacePathOptional,
		pageSize: Type.Optional(
			Type.Integer({ minimum: 1, maximum: LIMITS.maxContentSearchLines }),
		),
		pageToken: Type.Optional(PageTokenSchema),
	},
	{ additionalProperties: false },
);
const WorkspaceFileMetadataPayloadSchema = Type.Object(
	{
		workspaceId: Uuid,
		path: WorkspacePathSchema,
		expectedRevision: Type.Optional(RevisionTokenSchema),
	},
	{ additionalProperties: false },
);
const WorkspaceFileReadPayloadSchema = Type.Object(
	{
		workspaceId: Uuid,
		path: WorkspacePathSchema,
		rangeStart: Type.Integer({ minimum: 1 }),
		rangeEnd: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		expectedRevision: Type.Optional(RevisionTokenSchema),
	},
	{ additionalProperties: false },
);
const ContextSnapshotRequestPayloadSchema = Type.Object(
	{ sessionId: Uuid },
	{ additionalProperties: false },
);
const PageResponseFields = {
	workspaceId: Uuid,
	rootRevision: RevisionTokenSchema,
	nextPageToken: Type.Optional(PageTokenSchema),
};

const R3TreePageResponseSchema = Type.Object(
	{
		...PageResponseFields,
		path: WorkspacePathOptional,
		items: Type.Array(FileNodeSchema, { maxItems: LIMITS.maxTreePageItems }),
	},
	{ additionalProperties: false },
);
const R3FileSearchResponseSchema = Type.Object(
	{
		...PageResponseFields,
		items: Type.Array(FileSearchMatchSchema, {
			maxItems: LIMITS.maxFilenameSearchItems,
		}),
	},
	{ additionalProperties: false },
);
const R3ContentSearchResponseSchema = Type.Object(
	{
		...PageResponseFields,
		items: Type.Array(ContentSearchMatchSchema, {
			maxItems: LIMITS.maxContentSearchLines,
		}),
		isTruncated: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const R3MetadataResponseSchema = Type.Object(
	{
		workspaceId: Uuid,
		file: FileMetadataSchema,
	},
	{ additionalProperties: false },
);
const R3ReadResponseSchema = Type.Object(
	{
		workspaceId: Uuid,
		result: FileReadResultSchema,
	},
	{ additionalProperties: false },
);

const Payload = Type.Object({}, { additionalProperties: true });
const PiRpcRequestIdSchema = Type.String({ minLength: 1, maxLength: 128 });
const RawPiCommandSchema = Type.Object(
	{ type: Type.String({ minLength: 1, maxLength: 128 }) },
	{ additionalProperties: true },
);
const RawPiBodySchema = Type.Object({}, { additionalProperties: true });
export const PiRpcRequestEnvelopeSchema = Type.Object(
	{
		sessionId: Uuid,
		requestId: PiRpcRequestIdSchema,
		command: RawPiCommandSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/pi-rpc-request-envelope" },
);
export const PiRpcResponseEnvelopeSchema = Type.Object(
	{
		sessionId: Uuid,
		requestId: PiRpcRequestIdSchema,
		response: RawPiBodySchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/pi-rpc-response-envelope" },
);
export const PiRpcEventEnvelopeSchema = Type.Object(
	{ sessionId: Uuid, event: RawPiBodySchema },
	{ additionalProperties: false, $id: "pi-mob/protocol/pi-rpc-event-envelope" },
);
export type PiRpcRequestEnvelope = Static<typeof PiRpcRequestEnvelopeSchema>;
export type PiRpcResponseEnvelope = Static<typeof PiRpcResponseEnvelopeSchema>;
export type PiRpcEventEnvelope = Static<typeof PiRpcEventEnvelopeSchema>;
export const ProtocolVersionSchema = Type.Object(
	{ major: Type.Literal(PROTOCOL_MAJOR), minor: Type.Integer({ minimum: 0 }) },
	{ additionalProperties: true, $id: "pi-mob/protocol/version" },
);
const Protocol = ProtocolVersionSchema;
const EnvelopeFields = {
	protocol: Protocol,
	messageId: Uuid,
	type: Type.String({ minLength: 1 }),
	sentAt: Type.String({ pattern: ISO_UTC_PATTERN }),
	payload: Payload,
};
export const EnvelopeSchema = Type.Object(
	{
		...EnvelopeFields,
		requestId: Type.Optional(Uuid),
		commandId: Type.Optional(Uuid),
		connectionId: Type.Optional(Uuid),
		leaseId: Type.Optional(Uuid),
		streamId: Type.Optional(Type.String({ pattern: STREAM_ID_PATTERN })),
		cursor: Type.Optional(Type.String({ pattern: DECIMAL_CURSOR_PATTERN })),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/envelope" },
);
export const StreamSchema = Type.Object(
	{
		streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
		cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/stream" },
);
const WithOptionalRequest = {
	...EnvelopeFields,
	requestId: Type.Optional(Uuid),
	connectionId: Type.Optional(Uuid),
};
const ClientEnvelope = {
	...EnvelopeFields,
	requestId: Uuid,
	connectionId: Uuid,
};
const SessionId = Uuid;
const R5ProcessId = Type.String({
	minLength: 1,
	maxLength: LIMITS.maxProcessIdLength,
});
const R5ProcessStatus = Type.Union([
	Type.Literal("running"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("stopped"),
]);
const R5ProcessPort = Type.Object(
	{
		port: Type.Integer({ minimum: 1, maximum: 65535 }),
		protocol: Type.Union([Type.Literal("tcp"), Type.Literal("udp")]),
	},
	{ additionalProperties: false },
);
const R5SupportedActions = Type.Array(
	Type.Union([
		Type.Literal("stop"),
		Type.Literal("restart"),
		Type.Literal("rerun"),
	]),
	{ maxItems: 3, uniqueItems: true },
);
// R5 — `cwd` reuses the canonical R3 `WorkspacePathSchema` (root-relative,
// no `..`/`.` segments, no backslashes, no double slashes, no leading slash,
// bounded 1024 UTF-16 code units). The 1024 cap is identical to
// `LIMITS.maxProcessCwdLength`, so the existing bound stays canonical while
// the precise segment check (`foo/.` and `foo/..` and `foo/./bar` rejected)
// is enforced everywhere — replacing the broken custom regex that allowed
// `foo/./bar` and `foo//bar` to slip through.
export const ProcessSnapshotSchema = Type.Object(
	{
		sessionId: SessionId,
		processId: R5ProcessId,
		revision: RevisionTokenSchema,
		status: R5ProcessStatus,
		command: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxProcessCommandLength,
		}),
		startedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		capability: Type.Literal("runtime.processes.v1"),
		stale: Type.Boolean(),
		turnId: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxTurnIdLength }),
		),
		toolCallId: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxTurnIdLength }),
		),
		pid: Type.Optional(Type.Integer({ minimum: 1 })),
		cwd: Type.Optional(WorkspacePathSchema),
		finishedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
		exitCode: Type.Optional(Type.Integer()),
		signal: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		ports: Type.Optional(
			Type.Array(R5ProcessPort, { maxItems: LIMITS.maxProcessPorts }),
		),
		supportedActions: R5SupportedActions,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/process-snapshot" },
);
// R5 — `ProcessOutputSchema` is bounded, revision-bound, paged, and closed
// for both `stdout` and `stderr`. `sessionId` is REQUIRED so every output
// record is attributable to the owning session the same way the snapshot
// event is — the bridge MUST thread the snapshot's sessionId into every
// paged output record.
const R5OutputFields = {
	sessionId: SessionId,
	processId: R5ProcessId,
	revision: RevisionTokenSchema,
	stream: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
	content: Type.String({ maxLength: LIMITS.maxProcessOutputLength }),
	truncation: TruncationSchema,
	cursor: Type.Optional(DecimalCursorSchema),
	pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
};
export const ProcessOutputSchema = Type.Object(R5OutputFields, {
	additionalProperties: false,
	$id: "pi-mob/protocol/process-output",
});
const R5ProcessCommand = Type.Object(
	{
		sessionId: SessionId,
		processId: R5ProcessId,
		expectedRevision: RevisionTokenSchema,
	},
	{ additionalProperties: false },
);
const R5ProcessMetadata = Type.Object(
	{ lease: Type.Literal("session") },
	{ additionalProperties: false },
);
// R5 process actions share the session/process/revision triple plus the
// session-lease metadata. TypeBox intersects closed objects at the payload
// level by reporting per-side "additional property" errors, so we model the
// union explicitly here. `additionalProperties: false` keeps the payload a
// closed privacy boundary.
const R5ProcessPayload = Type.Object(
	{ ...R5ProcessCommand.properties, ...R5ProcessMetadata.properties },
	{ additionalProperties: false },
);

// F0 R6 — capability literal for the lightweight Git/CI summary surface.
// The bridge advertises `git-ci.v1` only when it genuinely implements the
// bounded summary plus the explicit commit-through-Pi / push-through-Pi
// durable commands. Absence maps to a truthful "Git/CI unavailable" card,
// never to a fabricated summary.
export const GIT_CI_CAPABILITY = "git-ci.v1" as const;

// F0 R6 — ExternalUrlSchema. Validated `https://` URL the mobile client is
// authorized to open externally. The regex is intentionally strict: the
// scheme must be `https` (mobile opens external), the URL must contain no
// whitespace or control characters (so a pasted manifest path cannot
// smuggle a shell metacharacter), and the length is bounded by
// `LIMITS.maxExternalUrlLength` (1024 UTF-16 code units). The bridge MUST
// additionally verify the URL is reachable from the mobile client before
// publishing; the schema can only enforce the static shape.
export const EXTERNAL_URL_PATTERN =
	"^https://(?!(?:[^/?#]*@))(?=[^/?#]{1,253}(?:[/?#]|$))[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\\s\\x00-\\x1F\\x7F]*)?$";
export const ExternalUrlSchema = Type.String({
	pattern: EXTERNAL_URL_PATTERN,
	maxLength: LIMITS.maxExternalUrlLength,
	$id: "pi-mob/protocol/external-url",
});

// F0 R6 — GitRepositoryLabelSchema. Bounded opaque `owner/repo` style label
// the inspector card renders directly. The pattern permits the canonical
// GitHub-style slash and the punctuation `git remote -v` commonly prints
// (`.`, `_`, `:`, `-`); whitespace, control characters, and a leading slash
// are rejected so a manifest path or shell fragment cannot slip through.
// `maxLength` mirrors `LIMITS.maxRepositoryLabelLength` (128 code units).
export const GIT_REPOSITORY_LABEL_PATTERN = "^(?!/)[A-Za-z0-9._:/\\-]{1,128}$";
export const GitRepositoryLabelSchema = Type.String({
	pattern: GIT_REPOSITORY_LABEL_PATTERN,
	maxLength: LIMITS.maxRepositoryLabelLength,
	$id: "pi-mob/protocol/git-repository-label",
});

// F0 R6 — GitBranchSchema. Bounded opaque branch name. The pattern mirrors
// `git check-ref-format --branch` plus the bounded length cap; whitespace,
// control characters, leading/trailing slashes, and the literal `..` are
// rejected at the schema layer so a reflog fragment cannot smuggle a
// traversal into the inspector card.
export const GIT_BRANCH_PATTERN =
	"^(?![/.])(?!.*(?:\\.\\.|@{))(?!.*//)[A-Za-z0-9._/\\-]{1,128}(?<!\\.lock)$";
export const GitBranchSchema = Type.String({
	pattern: GIT_BRANCH_PATTERN,
	maxLength: LIMITS.maxBranchLength,
	$id: "pi-mob/protocol/git-branch",
});

// F0 R6 — `workingTreeState` is the bounded clean / dirty / unknown triple.
// `unknown` covers the truthful card when the bridge cannot reach the
// repository (missing CLI, sandbox restriction, unauthenticated provider).
// The state set is closed so the schema rejects arbitrary labels.
export const GIT_WORKING_TREE_STATES = ["clean", "dirty", "unknown"] as const;

// F0 R6 — CI / check status states. `success` / `failure` / `pending` /
// `unknown` cover the truthful card when the bridge cannot reach the
// provider; the state set is closed so the schema rejects arbitrary labels.
export const GIT_CI_STATES = [
	"success",
	"failure",
	"pending",
	"unknown",
] as const;

// F0 R6 — supported Git/CI action set. `refresh` is the cancelable read,
// `commit_through_pi` / `push_through_pi` route through the Pi runtime (the
// bridge never stages from mobile and never edits a hunk), and
// `open_external` opens a validated `https://` URL in the mobile browser.
// The action set is closed so the schema rejects arbitrary labels.
export const GIT_ACTIONS = [
	"refresh",
	"commit_through_pi",
	"push_through_pi",
	"open_external",
] as const;

// F0 R6 — GitWorkingTreeStateSchema is a closed literal union matching
// `GIT_WORKING_TREE_STATES`. `closed shape` is enforced by the literal
// union; a stray label is rejected at the schema layer.
export const GitWorkingTreeStateSchema = Type.Union(
	GIT_WORKING_TREE_STATES.map((value) => Type.Literal(value)),
	{ $id: "pi-mob/protocol/git-working-tree-state" },
);

// F0 R6 — GitCiStatusSchema. Closed one-level object carrying only the
// aggregate CI state. `additionalProperties: false` means the schema
// rejects arbitrary siblings (a per-check list lives on `failedChecks`,
// never on `ciStatus`).
export const GitCiStatusSchema = Type.Object(
	{
		state: Type.Union(GIT_CI_STATES.map((value) => Type.Literal(value))),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-ci-status" },
);

// F0 R6 — GitCheckRunSchema. One entry of the bounded failed-checks array.
// `name` is the bounded identifier the inspector card renders directly;
// `status` is the closed state literal; `summary` is the bounded narrative
// (shares the 512-code-unit narrative bound used by `reason`/`message`);
// `url` is an optional validated `https://` external URL the user can open
// in the mobile browser. The schema is `additionalProperties: false` so a
// bridge call site cannot smuggle a diff / log blob / raw output alongside
// the declared check fields.
export const GitCheckRunSchema = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: LIMITS.maxCheckNameLength }),
		status: Type.Union(GIT_CI_STATES.map((value) => Type.Literal(value))),
		summary: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxCheckSummaryLength }),
		),
		logSummary: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxLogSummaryLength }),
		),
		url: Type.Optional(ExternalUrlSchema),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-check-run" },
);

// F0 R6 — GitFailedChecksSchema. The bounded failed-check array used
// verbatim by GitSummarySchema. Provider totals beyond the retained cap are
// represented by the aggregate CI state rather than a second wire shape.
export const GitFailedChecksSchema = Type.Array(GitCheckRunSchema, {
	maxItems: LIMITS.maxFailedChecks,
	$id: "pi-mob/protocol/git-failed-checks",
});

// F0 R6 — GitPullRequestSchema. The bounded optional PR card. `number` is
// the bounded positive PR number; `title` is the bounded narrative the
// inspector card renders directly; `url` is the validated `https://` URL
// the user can open externally. The schema is `additionalProperties: false`
// so the bridge cannot smuggle a PR body or review-comment blob alongside
// the declared PR fields.
export const GitPullRequestSchema = Type.Object(
	{
		number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		title: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxGitPullRequestTitleLength,
		}),
		url: ExternalUrlSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-pull-request" },
);

// F0 R6 — GitLatestCommitSchema. Bounded, closed latest-commit card. `sha`
// matches the canonical lowercase-hex SHA-1 / SHA-256 pattern; `message`
// is the bounded subject (the bridge clips to the first line so a multi-
// KiB commit body never lands on the inspector card); `author` is the
// bounded author label; `authoredAt` is the canonical ISO-UTC timestamp.
// The schema is `additionalProperties: false` so the bridge cannot smuggle
// a diff blob or full commit body alongside the declared fields.
export const GitLatestCommitSchema = Type.Object(
	{
		sha: Type.String({
			pattern: "^[0-9a-f]{7,64}$",
			maxLength: LIMITS.maxCommitShaLength,
		}),
		message: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxCommitMessageLength }),
		),
		author: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxCommitAuthorLength }),
		),
		authoredAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		url: ExternalUrlSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-latest-commit" },
);

// F0 R6 — GitSummarySchema. The closed, bounded authoritative summary the
// host publishes as a `git.summary` event. Required identity / status
// envelope:
//   - `workspaceId` (UUID): the owning workspace.
//   - `revision` (opaque RevisionToken): the authoritative summary revision;
//     the durable commit/push commands carry `expectedRevision` so the bridge
//     can reject a stale target with `git_stale` BEFORE Pi dispatch.
//   - `repository` (bounded label): the opaque `owner/repo` label.
//   - `detached` / `branch` (discriminated pair): attached summaries carry
//     `detached: false` and a bounded Git branch; detached summaries carry
//     `detached: true` and `branch: null`.
//   - `workingTreeState` (closed literal): clean / dirty / unknown.
//   - `changedCount`, `ahead`, `behind` (non-negative integers).
//   - `latestCommit` (GitLatestCommitSchema): bounded latest-commit card.
//   - `supportedActions` (closed literal set, unique): the actions the
//     mobile client may take for THIS workspace right now.
//   - `capability` (literal `git-ci.v1`): correlates the summary with the
//     git surface capability.
//   - `lastRefreshedAt` (canonical ISO-UTC): the bridge publish time.
// Optional groups:
//   - `pullRequest` (GitPullRequestSchema): the bounded PR card.
//   - `ciStatus` (GitCiStatusSchema): the aggregate CI state.
//   - `failedChecks` (GitFailedChecksSchema): the bounded failed-check list.
//
// Schema-scope guarantees ONLY:
//   - shape, sign, length bounds, regex patterns, closed shape
//   - required identity/status envelope
//   - bounded failed-checks count (20)
//   - validated `https://` external URLs (PR / check / commit — though
//     commit URLs are bounded by the external-URL cap when present)
//   - NO diff / stage / hunk / checkout fields: `additionalProperties: false`
//     means the bridge cannot smuggle a future diff payload alongside the
//     declared summary shape. A diff leaf must be its own additive leaf
//     with its own additive command / response / event families.
// Out-of-scope (MUST be enforced by the bridge at publish and at receive):
//   - the relation `changedCount === 0` iff `workingTreeState === "clean"`
//   - the validity of `latestCommit.sha` against the live repository
//   - the validity of `ahead` / `behind` against the live remote
//   - any cross-payload dedupe or ordering
const GitSummaryFields = {
	workspaceId: Uuid,
	revision: RevisionTokenSchema,
	repositoryUrl: ExternalUrlSchema,
	repository: GitRepositoryLabelSchema,
	workingTreeState: GitWorkingTreeStateSchema,
	changedCount: Type.Integer({ minimum: 0, maximum: LIMITS.maxGitCount }),
	ahead: Type.Integer({ minimum: 0, maximum: LIMITS.maxGitCount }),
	behind: Type.Integer({ minimum: 0, maximum: LIMITS.maxGitCount }),
	latestCommit: GitLatestCommitSchema,
	pullRequest: Type.Optional(GitPullRequestSchema),
	ciStatus: GitCiStatusSchema,
	failedChecks: GitFailedChecksSchema,
	supportedActions: Type.Array(
		Type.Union(GIT_ACTIONS.map((value) => Type.Literal(value))),
		{ maxItems: GIT_ACTIONS.length, uniqueItems: true },
	),
	capability: Type.Literal(GIT_CI_CAPABILITY),
	lastRefreshedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
};
export const GitSummarySchema = Type.Union(
	[
		Type.Object(
			{
				...GitSummaryFields,
				detached: Type.Literal(true),
				branch: Type.Null(),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				...GitSummaryFields,
				detached: Type.Literal(false),
				branch: GitBranchSchema,
			},
			{ additionalProperties: false },
		),
	],
	{ $id: "pi-mob/protocol/git-summary" },
);

// F0 R6 — GitUnavailableEventSchema. Truthful no-Git/CI-surface envelope.
// Mirrors the R3/R4 unavailable pattern: closed object, capability
// literal, closed `CapabilityStatus`. `workspaceId` is REQUIRED so the
// mobile client can correlate the unavailable state with the host
// workspace listing.
export const GitUnavailableEventSchema = Type.Object(
	{
		workspaceId: Uuid,
		capability: Type.Literal(GIT_CI_CAPABILITY),
		status: CapabilityStatusSchema,
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-unavailable" },
);

// F0 R6 — GitConfirmationSchema. Bounded confirmation proof the durable
// commit/push commands carry. The bridge MUST match `confirmationId`
// against an in-flight user-confirmation record before dispatch; the
// schema cannot prove the match, only that the token is bounded opaque
// text. `summary` is an optional bounded prefill summary (commit subject,
// push annotation) the user reviewed before confirming. The schema is
// `additionalProperties: false` so the bridge cannot smuggle a private
// confirmation secret or raw diff alongside the declared confirmation
// fields.
export const GitConfirmationSchema = Type.Object(
	{
		confirmationId: Type.String({
			minLength: 1,
			maxLength: LIMITS.maxGitConfirmationIdLength,
			pattern: "^[A-Za-z0-9._:-]{1,128}$",
		}),
		summary: Type.Optional(
			Type.String({ minLength: 1, maxLength: LIMITS.maxGitSummaryHintLength }),
		),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/git-confirmation" },
);

// F0 R6 — `git.commit.request` and `git.push.request` durable payloads.
// Schema-scope guarantees ONLY:
//   - shape, sign, length bounds, regex patterns, closed shape
//   - required `workspaceId`, `expectedRevision`, `confirmation`
//   - the optional bounded `summaryHint` (prefill commit subject / push
//     annotation)
//   - NO diff / stage / hunk / checkout fields: `additionalProperties: false`
//     means the bridge cannot smuggle a future diff payload, a staged hunk,
//     or a checkout target alongside the declared payload shape.
// Out-of-scope (MUST be enforced by the bridge at publish and at receive):
//   - the relation `expectedRevision === summary.revision` (the bridge
//     resolves and verifies; the schema cannot see siblings)
//   - the actual `confirmationId` validity (the bridge matches against the
//     user-confirmation record; the schema proves only opaque bounded text)
//   - any cross-command dedupe or ordering
//
// The durable commands report through `command.receipt` / `command.state` /
// `command.current.result`, mirroring the R5 process pattern; this payload
// carries ONLY the workspace identity, the anti-stale revision, and the
// confirmation metadata.
const GitCommandFields = {
	sessionId: SessionId,
	workspaceId: Uuid,
	expectedRevision: RevisionTokenSchema,
	confirmation: GitConfirmationSchema,
	summaryHint: Type.Optional(
		Type.String({ minLength: 1, maxLength: LIMITS.maxGitSummaryHintLength }),
	),
};
export const GitCommandPayloadSchema = Type.Object(GitCommandFields, {
	additionalProperties: false,
	$id: "pi-mob/protocol/git-command-payload",
});
const ControllerScope = Type.Union([
	Type.Object({ scope: Type.Literal("host") }, { additionalProperties: true }),
	Type.Object(
		{ scope: Type.Literal("session"), sessionId: SessionId },
		{ additionalProperties: true },
	),
]);
export const CatalogueEntrySchema = Type.Object(
	{
		entryId: Type.String({ minLength: 1, maxLength: 128 }),
		kind: Type.Union([Type.Literal("skill"), Type.Literal("template"), Type.Literal("extension"), Type.Literal("mcp_server"), Type.Literal("mcp_tool")]),
		name: Type.String({ minLength: 1, maxLength: 128 }),
		description: Type.Optional(Type.String({ maxLength: 512 })),
		invocation: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
		source: Type.String({ minLength: 1, maxLength: 128 }),
		availability: CapabilityStatusSchema,
		enabled: Type.Optional(Type.Boolean()),
		canToggle: Type.Boolean(),
		reloadRequired: Type.Boolean(),
		revision: RevisionTokenSchema,
	},
	{ additionalProperties: false },
);
export const CatalogueSnapshotSchema = Type.Object(
	{ revision: RevisionTokenSchema, entries: Type.Array(CatalogueEntrySchema, { maxItems: LIMITS.maxCatalogueEntries }) },
	{ additionalProperties: false },
);
export const CatalogueUnavailableSchema = Type.Object(
	{ capability: Type.Literal("catalogue.v1"), status: CapabilityStatusSchema },
	{ additionalProperties: false },
);
const CatalogueSnapshotRequestSchema = Type.Object({ requestId: Uuid }, { additionalProperties: false });
const CatalogueSetEnabledSchema = Type.Object(
	{ sessionId: SessionId, entryId: Type.String({ minLength: 1, maxLength: 128 }), enabled: Type.Boolean(), expectedRevision: RevisionTokenSchema, confirmed: Type.Literal(true) },
	{ additionalProperties: false },
);

export const AgentActionSchema = Type.Union([
	Type.Literal("transcript"), Type.Literal("steer"), Type.Literal("cancel"),
	Type.Literal("compare"), Type.Literal("adopt"), Type.Literal("merge"),
]);
export const AgentRecordSchema = Type.Object(
	{
		agentId: Type.String({ minLength: 1, maxLength: 128 }),
		task: Type.String({ minLength: 1, maxLength: LIMITS.maxAgentTaskLength }),
		model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		state: Type.Union([Type.Literal("running"), Type.Literal("blocked"), Type.Literal("needs_input"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("indeterminate")]),
		startedAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		finishedAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
		originSessionId: SessionId,
		originTurnId: Type.String({ minLength: 1, maxLength: 128 }),
		latestActivity: Type.Optional(Type.String({ maxLength: LIMITS.maxAgentSummaryLength })),
		completionSummary: Type.Optional(Type.String({ maxLength: LIMITS.maxAgentSummaryLength })),
		transcriptRef: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		worktreeRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
		supportedActions: Type.Array(AgentActionSchema, { maxItems: 6, uniqueItems: true }),
		revision: RevisionTokenSchema,
	},
	{ additionalProperties: false },
);
export const AgentSnapshotSchema = Type.Object(
	{ revision: RevisionTokenSchema, items: Type.Array(AgentRecordSchema, { maxItems: LIMITS.maxAgentItems }) },
	{ additionalProperties: false },
);
export const AgentUnavailableSchema = Type.Object(
	{ capability: Type.Literal("agents.v1"), status: CapabilityStatusSchema },
	{ additionalProperties: false },
);
const AgentSnapshotRequestSchema = Type.Object(
	{ requestId: Uuid }, { additionalProperties: false },
);
const AgentTranscriptPageSchema = Type.Object(
	{ agentId: Type.String({ minLength: 1, maxLength: 128 }), pageSize: Type.Integer({ minimum: 1, maximum: 100 }), pageToken: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()])) },
	{ additionalProperties: false },
);
const AgentActionPayloadSchema = Type.Object(
	{ sessionId: SessionId, agentId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: RevisionTokenSchema, instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })) },
	{ additionalProperties: false },
);

export const AttentionCategorySchema = Type.Union([
	Type.Literal("needs_input"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("interrupted"),
	Type.Literal("background"),
]);
export const AttentionItemSchema = Type.Object(
	{
		attentionId: Uuid,
		sessionId: SessionId,
		turnId: Type.String({ minLength: 1, maxLength: 128 }),
		category: AttentionCategorySchema,
		occurrence: Type.String({ pattern: ISO_UTC_PATTERN }),
		summary: Type.String({ minLength: 1, maxLength: LIMITS.maxAttentionSummaryLength }),
		actionable: Type.Boolean(),
		revision: RevisionTokenSchema,
		resolved: Type.Boolean(),
		superseded: Type.Boolean(),
	},
	{ additionalProperties: false, $id: "pi-mob/protocol/attention-item" },
);
export const AttentionResolvePayloadSchema = Type.Object(
	{ sessionId: SessionId, attentionId: Uuid, expectedRevision: RevisionTokenSchema },
	{ additionalProperties: false },
);

const CommandPayloads = {
	"controller.acquire": ControllerScope,
	"controller.takeover": ControllerScope,
	"controller.release": ControllerScope,
	"host.display_name.set": Type.Object(
		{ displayName: Type.String({ minLength: 1 }) },
		{ additionalProperties: true },
	),
	"notification.device.register": Type.Object(
		{
			deviceId: Uuid,
			platform: Type.String({ minLength: 1 }),
			token: Type.String({ minLength: 1 }),
		},
		{ additionalProperties: true },
	),
	"notification.device.unregister": Type.Object(
		{ deviceId: Uuid },
		{ additionalProperties: true },
	),
	"session.create": Type.Object(
		{
			workspaceId: Uuid,
			workspaceRelativePath: Type.Optional(Type.String({ maxLength: 4096 })),
			name: Type.Optional(Type.String()),
			modelIntent: Type.Optional(Type.String()),
			modelId: Type.Optional(Type.String({ minLength: 1 })),
			provider: Type.Optional(Type.String({ minLength: 1 })),
		},
		{ additionalProperties: true },
	),
	"session.activate": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.stop": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.rename": Type.Object(
		{ sessionId: SessionId, name: Type.String({ minLength: 1 }) },
		{ additionalProperties: true },
	),
	"session.delete": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.restore": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.purge": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.fork": Type.Object(
		{ sessionId: SessionId, entryId: Type.String({ minLength: 1 }) },
		{ additionalProperties: true },
	),
	"session.clone": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.export": Type.Object(
		{ sessionId: SessionId, format: Type.Literal("html") },
		{ additionalProperties: true },
	),
	// The two prompt-context lists each have an individual four-item schema
	// bound. D-037 requires the bridge to enforce the relational invariant
	// `attachmentIds.length + fileRefs.length <= maxAttachmentsPerPrompt`
	// before accepting; both arrays remain in the durable semantic payload/hash.
	"prompt.submit": Type.Object(
		{
			sessionId: SessionId,
			deliveryMode: Type.Union([
				Type.Literal("immediate"),
				Type.Literal("steer"),
				Type.Literal("follow_up"),
			]),
			message: Type.String(),
			attachmentIds: Type.Array(Uuid, {
				maxItems: LIMITS.maxAttachmentsPerPrompt,
			}),
			fileRefs: Type.Optional(
				Type.Array(FileAttachmentReferenceSchema, {
					maxItems: LIMITS.maxFileAttachmentRefs,
				}),
			),
			planTarget: Type.Optional(PlanTargetSchema),
		},
		{ additionalProperties: true },
	),
	"context.pin": ContextMutationPayloadSchema,
	"context.unpin": ContextMutationPayloadSchema,
	"context.exclude": ContextMutationPayloadSchema,
	"context.refresh": ContextMutationPayloadSchema,
	"process.stop": R5ProcessPayload,
	"process.restart": R5ProcessPayload,
	"process.rerun": R5ProcessPayload,
	// F0 R6 — durable, revision-bound Git/CI actions. Payload is
	// `GitCommandPayloadSchema`: `workspaceId` + `expectedRevision` +
	// `confirmation` (with optional bounded `summaryHint`). The bridge never
	// stages from mobile and never edits a hunk, so the payload deliberately
	// omits diff/stage/hunk/checkout fields; `additionalProperties: false`
	// on the schema closes that surface.
	"git.commit.request": GitCommandPayloadSchema,
	"git.push.request": GitCommandPayloadSchema,
	"attention.resolve": AttentionResolvePayloadSchema,
	"catalogue.set_enabled": CatalogueSetEnabledSchema,
	"pi.rpc.request": PiRpcRequestEnvelopeSchema,
	"agent.merge": AgentActionPayloadSchema,
	"agent.adopt": AgentActionPayloadSchema,
	"agent.cancel": AgentActionPayloadSchema,
	"agent.steer": AgentActionPayloadSchema,
	"turn.abort": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"queue.remove": Type.Object(
		{ sessionId: SessionId, queueItemId: Uuid },
		{ additionalProperties: true },
	),
	"queue.clear": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"model.set": Type.Object(
		{
			sessionId: SessionId,
			modelId: Type.String({ minLength: 1 }),
			provider: Type.Optional(Type.String({ minLength: 1 })),
		},
		{ additionalProperties: true },
	),
	"thinking.set": Type.Object(
		{ sessionId: SessionId, level: Type.String({ minLength: 1 }) },
		{ additionalProperties: true },
	),
	"steering_mode.set": Type.Object(
		{ sessionId: SessionId, enabled: Type.Boolean() },
		{ additionalProperties: true },
	),
	"follow_up_mode.set": Type.Object(
		{ sessionId: SessionId, enabled: Type.Boolean() },
		{ additionalProperties: true },
	),
	"compaction.start": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"compaction.auto.set": Type.Object(
		{ sessionId: SessionId, enabled: Type.Boolean() },
		{ additionalProperties: true },
	),
	"retry.auto.set": Type.Object(
		{ sessionId: SessionId, enabled: Type.Boolean() },
		{ additionalProperties: true },
	),
	"retry.abort": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"extension.respond": Type.Object(
		{ sessionId: SessionId, dialogId: Uuid, response: Payload },
		{ additionalProperties: true },
	),
} as const;
const LeaseStateFields = {
	mode: Type.String({ minLength: 1 }),
	leaseId: Type.Optional(Uuid),
	installationId: Type.Optional(Uuid),
	expiresAt: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
	reclaimableUntil: Type.Optional(Type.String({ pattern: ISO_UTC_PATTERN })),
};
export const LeaseStateSchema = Type.Union(
	[
		Type.Object(
			{ ...LeaseStateFields, scope: Type.Literal("host") },
			{ additionalProperties: true },
		),
		Type.Object(
			{
				...LeaseStateFields,
				scope: Type.Literal("session"),
				sessionId: SessionId,
			},
			{ additionalProperties: true },
		),
	],
	{ $id: "pi-mob/protocol/lease-state" },
);
const EventPayloads = {
	"session.summary": Type.Object(
		{
			sessionId: SessionId,
			runtimeState: Type.String(),
			queueCount: Type.Integer({ minimum: 0 }),
			createdByCommandId: Type.Optional(Uuid),
		},
		{ additionalProperties: true },
	),
	"controller.state": LeaseStateSchema,
	"command.state": Type.Object(
		{
			commandId: Uuid,
			commandType: Type.Union(
				COMMAND_TYPES.map((value) => Type.Literal(value)),
			),
			state: Type.String(),
			errorCode: Type.Union([
				Type.Union(ERROR_CODES.map((value) => Type.Literal(value))),
				Type.Null(),
			]),
		},
		{ additionalProperties: true },
	),
	"tool.output": Type.Object(
		{
			toolCallId: Type.String({ minLength: 1, maxLength: 512 }),
			retainedBytes: Type.Integer({ minimum: 0 }),
			totalBytes: Type.Integer({ minimum: 0 }),
			digest: Type.Optional(Type.String()),
			isTruncated: Type.Boolean(),
		},
		{ additionalProperties: true },
	),
	"extension.dialog": Type.Object(
		{
			dialogId: Uuid,
			method: Type.Union([
				Type.Literal("select"),
				Type.Literal("confirm"),
				Type.Literal("input"),
				Type.Literal("editor"),
			]),
			expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }),
		},
		{ additionalProperties: true },
	),
	"queue.snapshot": Type.Object(
		{ items: Type.Array(Payload, { maxItems: LIMITS.maxQueuedFollowUps }) },
		{ additionalProperties: true },
	),
	"recipe.activity": RecipeActivitySchema,
	"recipe.unavailable": RecipeUnavailableSchema,
	"plan.snapshot": PlanSnapshotSchema,
	"plan.unavailable": PlanUnavailableSchema,
	"workspace.tree.snapshot": WorkspaceTreeSnapshotEventSchema,
	"workspace.file.metadata": WorkspaceFileMetadataEventSchema,
	"workspace.file.stale": WorkspaceFileStaleEventSchema,
	"workspace.file.unavailable": WorkspaceFileUnavailableEventSchema,
	"context.snapshot": ContextSnapshotSchema,
	"context.unavailable": ContextUnavailableEventSchema,
	"process.snapshot": ProcessSnapshotSchema,
	"process.output": ProcessOutputSchema,
	"process.unavailable": Type.Object(
		{
			sessionId: SessionId,
			capability: Type.Literal("runtime.processes.v1"),
			status: CapabilityStatusSchema,
		},
		{ additionalProperties: false },
	),
	"process.error": Type.Object(
		{
			sessionId: SessionId,
			processId: R5ProcessId,
			revision: RevisionTokenSchema,
			error: ErrorInfoSchema,
		},
		{ additionalProperties: false },
	),
	// F0 R6 — host-stream Git/CI event payloads. `git.summary` carries the
	// authoritative closed summary; `git.unavailable` carries the truthful
	// no-capability envelope. Both are owned by the host stream (mirroring
	// the D-037 R3 file-browser pattern) and carry `workspaceId` so the
	// mobile client can reconcile against the host workspace listing.
	"git.summary": GitSummarySchema,
	"git.unavailable": GitUnavailableEventSchema,
	"attention.item": AttentionItemSchema,
	"agent.snapshot": AgentSnapshotSchema,
	"agent.unavailable": AgentUnavailableSchema,
	"catalogue.snapshot": CatalogueSnapshotSchema,
	"catalogue.unavailable": CatalogueUnavailableSchema,
	"pi.rpc.response": PiRpcResponseEnvelopeSchema,
	"pi.rpc.event": PiRpcEventEnvelopeSchema,
} as const;
const genericEventPayload = Type.Object(
	{ sessionId: Type.Optional(SessionId) },
	{ additionalProperties: true },
);
const ControlPayloads = {
	"subscription.set": Type.Object(
		{
			streams: Type.Array(
				Type.Object(
					{
						streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
						afterCursor: Type.Optional(
							Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
						),
						detail: Type.Union([Type.Literal("full"), Type.Literal("summary")]),
					},
					{ additionalProperties: true },
				),
				{ minItems: 1 },
			),
		},
		{ additionalProperties: true },
	),
	"cursor.ack": Type.Object(
		{
			cursors: Type.Record(
				Type.String({ pattern: STREAM_ID_PATTERN }),
				Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
			),
		},
		{ additionalProperties: true },
	),
	"controller.renew": Type.Object(
		{ leaseId: Uuid },
		{ additionalProperties: true },
	),
	"host.snapshot.request": Type.Object({}, { additionalProperties: true }),
	"session.snapshot.request": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: true },
	),
	"session.list": Type.Object(
		{
			filter: Type.Optional(Type.String()),
			query: Type.Union([Type.String(), Type.Null()]),
			sort: Type.String(),
			pageSize: Type.Integer({
				minimum: 1,
				maximum: LIMITS.maxSessionPageSize,
			}),
			pageToken: Type.Union([Type.String(), Type.Null()]),
		},
		{ additionalProperties: true },
	),
	"session.history.page": Type.Object(
		{
			sessionId: SessionId,
			pageSize: Type.Integer({
				minimum: 1,
				maximum: LIMITS.maxSessionPageSize,
			}),
			pageToken: Type.Union([Type.String(), Type.Null()]),
		},
		{ additionalProperties: true },
	),
	"workspace.list": Type.Object({}, { additionalProperties: true }),
	"workspace.search": Type.Object(
		{ query: Type.String() },
		{ additionalProperties: true },
	),
	"model.list": Type.Object(
		{ sessionId: Type.Optional(SessionId) },
		{ additionalProperties: true },
	),
	"command.current": Type.Object(
		{ commandId: Uuid },
		{ additionalProperties: true },
	),
	"workspace.tree.page": WorkspaceTreePagePayloadSchema,
	"workspace.file.search": WorkspaceFileSearchPayloadSchema,
	"workspace.file.content.search": WorkspaceContentSearchPayloadSchema,
	"workspace.file.metadata": WorkspaceFileMetadataPayloadSchema,
	"workspace.file.read": WorkspaceFileReadPayloadSchema,
	"context.snapshot.request": ContextSnapshotRequestPayloadSchema,
	"agent.snapshot.request": AgentSnapshotRequestSchema,
	"agent.transcript.page": AgentTranscriptPageSchema,
	"catalogue.snapshot.request": CatalogueSnapshotRequestSchema,
	"process.snapshot.request": Type.Object(
		{ sessionId: SessionId },
		{ additionalProperties: false },
	),
	"process.output.page": Type.Object(
		{
			sessionId: SessionId,
			processId: R5ProcessId,
			revision: RevisionTokenSchema,
			stream: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
			cursor: Type.Optional(DecimalCursorSchema),
			pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		},
		{ additionalProperties: false },
	),
	"git.summary.request": Type.Object(
		{ workspaceId: Uuid },
		{ additionalProperties: false },
	),
	"git.summary.cancel": Type.Object(
		{ targetRequestId: Uuid },
		{ additionalProperties: false },
	),
} as const;
export const SubscriptionSchema = ControlPayloads["subscription.set"];
const ResponsePayloads = {
	"hello.accepted": Type.Object(
		{
			connectionId: Uuid,
			hostId: Uuid,
			hostGeneration: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
			hostDisplayName: Type.String(),
			bridgeVersion: Type.String(),
			piVersion: Type.String(),
			serverTime: Type.String({ pattern: ISO_UTC_PATTERN }),
			capabilities: Type.Array(Type.String()),
			limits: Type.Object(
				{
					maxJsonBytes: Type.Integer({ minimum: 0 }),
					maxAttachmentBytes: Type.Integer({ minimum: 0 }),
					maxAttachmentsPerPrompt: Type.Integer({ minimum: 0 }),
					maxPromptAttachmentBytes: Type.Integer({ minimum: 0 }),
					maxQueuedFollowUps: Type.Integer({ minimum: 0 }),
					maxSessionPageSize: Type.Integer({ minimum: 0 }),
					maxBackgroundSessionSubscriptions: Type.Integer({ minimum: 0 }),
				},
				{ additionalProperties: true },
			),
		},
		{ additionalProperties: true },
	),
	"subscription.accepted": Type.Object(
		{
			streams: Type.Array(
				Type.Object(
					{
						streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
						mode: Type.Union([
							Type.Literal("replay"),
							Type.Literal("current"),
							Type.Literal("snapshot_required"),
						]),
					},
					{ additionalProperties: true },
				),
			),
		},
		{ additionalProperties: true },
	),
	"stream.sync.complete": Type.Object(
		{
			streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
			currentCursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
			mode: Type.Union([
				Type.Literal("replay"),
				Type.Literal("current"),
				Type.Literal("snapshot_required"),
			]),
		},
		{ additionalProperties: true },
	),
	"stream.snapshot.begin": Type.Object(
		{
			snapshotId: Uuid,
			streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
			baselineCursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
		},
		{ additionalProperties: true },
	),
	"stream.snapshot.part": Type.Object(
		{
			snapshotId: Uuid,
			part: Type.Integer({ minimum: 0 }),
			items: Type.Array(Payload),
		},
		{ additionalProperties: true },
	),
	"stream.snapshot.end": Type.Object(
		{ snapshotId: Uuid, partCount: Type.Integer({ minimum: 1 }) },
		{ additionalProperties: true },
	),
	"command.receipt": Type.Object(
		{ state: Type.String({ minLength: 1 }), duplicate: Type.Boolean() },
		{ additionalProperties: true },
	),
	"command.current.result": Type.Object(
		{ commandId: Uuid, state: Type.String() },
		{ additionalProperties: true },
	),
	"controller.renew.result": Type.Object(
		{ leaseId: Uuid, expiresAt: Type.Integer({ minimum: 0 }) },
		{ additionalProperties: true },
	),
	"session.list.result": Type.Object(
		{
			items: Type.Array(Payload),
			snapshotRevision: Type.String(),
			nextPageToken: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
	"session.history.page.result": Type.Object(
		{
			items: Type.Array(Payload),
			snapshotRevision: Type.String(),
			nextPageToken: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
	"workspace.list.result": Type.Object(
		{ items: Type.Array(Payload) },
		{ additionalProperties: true },
	),
	"workspace.search.result": Type.Object(
		{ items: Type.Array(Payload) },
		{ additionalProperties: true },
	),
	"model.list.result": Type.Object(
		{ items: Type.Array(Payload) },
		{ additionalProperties: true },
	),
	"workspace.tree.page.result": R3TreePageResponseSchema,
	"workspace.file.search.result": R3FileSearchResponseSchema,
	"workspace.file.content.search.result": R3ContentSearchResponseSchema,
	"workspace.file.metadata.result": R3MetadataResponseSchema,
	"workspace.file.read.result": R3ReadResponseSchema,
	"catalogue.snapshot.result": CatalogueSnapshotSchema,
	"agent.snapshot.result": AgentSnapshotSchema,
	"agent.transcript.page.result": Type.Object({ agentId: Type.String({ minLength: 1, maxLength: 128 }), items: Type.Array(Payload, { maxItems: 100 }), nextPageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), isTruncated: Type.Boolean() }, { additionalProperties: false, $id: "pi-mob/protocol/agent-transcript-page-response" }),
	"context.snapshot.result": ContextSnapshotSchema,
	"process.snapshot.result": Type.Object(
		{
			items: Type.Array(ProcessSnapshotSchema, {
				maxItems: LIMITS.maxProcessSnapshotItems,
			}),
		},
		{ additionalProperties: false },
	),
	"process.output.page.result": ProcessOutputSchema,
	"git.summary.result": GitSummarySchema,
	"pi.rpc.response": PiRpcResponseEnvelopeSchema,
} as const;

export const SnapshotSchema = Type.Union(
	[
		ResponsePayloads["stream.snapshot.begin"],
		ResponsePayloads["stream.snapshot.part"],
		ResponsePayloads["stream.snapshot.end"],
	],
	{ $id: "pi-mob/protocol/snapshot" },
);

export const HelloSchema = Type.Object(
	{
		...WithOptionalRequest,
		type: Type.Literal("hello"),
		requestId: Uuid,
		payload: Type.Object(
			{
				expectedHostId: Type.Optional(Uuid),
				mobileVersion: Type.String({ minLength: 1 }),
				platform: Type.String({ minLength: 1 }),
				installationId: Uuid,
				installationCredential: Type.String({ minLength: 1 }),
				requiredCapabilities: Type.Array(CapabilitySchema),
				optionalCapabilities: Type.Array(Type.String()),
			},
			{ additionalProperties: true },
		),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/hello" },
);

export const CommandSchema = Type.Union(
	COMMAND_TYPES.map((type) =>
		Type.Object(
			{
				...ClientEnvelope,
				commandId: Uuid,
				...(leaseFreeCommands.has(type) ? {} : { leaseId: Uuid }),
				type: Type.Literal(type),
				payload: CommandPayloads[type],
			},
			{ additionalProperties: true },
		),
	) as TSchema[],
	{ $id: "pi-mob/protocol/command" },
);

const SupportedCapability = CapabilitySchema;
const KnownEventType = Type.Union(
	EVENT_TYPES.map((value) => Type.Literal(value)),
);
const OptionalAdditiveEventSchema = Type.Object(
	{
		...EnvelopeFields,
		eventId: Uuid,
		streamId: Type.String({ pattern: STREAM_ID_PATTERN }),
		cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
		type: Type.Intersect([
			Type.String({ pattern: "^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$" }),
			Type.Not(KnownEventType),
		]),
		payload: Type.Object(
			{
				optional: Type.Literal(true),
				requiredCapabilities: Type.Optional(Type.Array(SupportedCapability)),
			},
			{ additionalProperties: true },
		),
	},
	{ additionalProperties: true },
);
export const EventSchema = Type.Union(
	[
		...EVENT_TYPES.map((type) =>
			Type.Object(
				{
					...EnvelopeFields,
					eventId: Uuid,
					streamId: Type.String({
						pattern:
							EVENT_STREAM_OWNERSHIP[type] === "host"
								? `^host:${UUID_PATTERN.slice(1, -1)}$`
								: EVENT_STREAM_OWNERSHIP[type] === "session"
									? `^session:${UUID_PATTERN.slice(1, -1)}$`
									: STREAM_ID_PATTERN,
					}),
					cursor: Type.String({ pattern: DECIMAL_CURSOR_PATTERN }),
					type: Type.Literal(type),
					payload:
						type in EventPayloads
							? EventPayloads[type as keyof typeof EventPayloads]
							: genericEventPayload,
				},
				{ additionalProperties: true },
			),
		),
		OptionalAdditiveEventSchema,
	] as TSchema[],
	{ $id: "pi-mob/protocol/event" },
);

export const ControlSchema = Type.Union(
	CONTROL_TYPES.map((type) =>
		Type.Object(
			{
				...ClientEnvelope,
				type: Type.Literal(type),
				payload: ControlPayloads[type],
			},
			{ additionalProperties: true },
		),
	) as TSchema[],
	{ $id: "pi-mob/protocol/control" },
);
export const ResponseSchema = Type.Union(
	RESPONSE_TYPES.map((type) =>
		Type.Object(
			{
				...WithOptionalRequest,
				requestId: Uuid,
				...(type === "command.receipt" ? { commandId: Uuid } : {}),
				type: Type.Literal(type),
				payload: ResponsePayloads[type],
			},
			{ additionalProperties: true },
		),
	) as TSchema[],
	{ $id: "pi-mob/protocol/response" },
);
export const PairingSchema = Type.Object(
	{
		kind: Type.Literal("pi-mob-host"),
		version: Type.Literal(1),
		hostId: Uuid,
		displayName: Type.String({ minLength: 1 }),
		endpoint: Type.String({ pattern: "^https://" }),
		protocolMajor: Type.Literal(PROTOCOL_MAJOR),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/pairing" },
);
export const AttachmentResponseSchema = Type.Object(
	{
		attachmentId: Uuid,
		sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
		mimeType: Type.Union([
			Type.Literal("image/jpeg"),
			Type.Literal("image/png"),
		]),
		bytes: Type.Integer({ minimum: 0, maximum: LIMITS.maxAttachmentBytes }),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/attachment" },
);
export const ExportMetadataSchema = Type.Object(
	{
		exportId: Uuid,
		format: Type.Literal("html"),
		bytes: Type.Integer({ minimum: 0 }),
		sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
		expiresAt: Type.String({ pattern: ISO_UTC_PATTERN }),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/export" },
);

export const ErrorSchema = Type.Object(
	{
		...WithOptionalRequest,
		requestId: Uuid,
		type: Type.Literal("error"),
		payload: Type.Object(
			{
				code: Type.Union(ERROR_CODES.map((value) => Type.Literal(value))),
				message: Type.String({ minLength: 1 }),
				retryable: Type.Boolean(),
				recommendedDelayMs: Type.Optional(
					Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
				),
				details: Type.Object({}, { additionalProperties: true }),
			},
			{ additionalProperties: true },
		),
	},
	{ additionalProperties: true, $id: "pi-mob/protocol/error" },
);

export const FixtureSchema = Type.Object(
	{
		name: Type.String(),
		kind: Type.Union([
			Type.Literal("hello"),
			Type.Literal("command"),
			Type.Literal("control"),
			Type.Literal("event"),
			Type.Literal("response"),
			Type.Literal("error"),
			Type.Literal("pairing"),
			Type.Literal("attachment"),
			Type.Literal("export"),
		]),
		valid: Type.Boolean(),
		message: Type.Object({}, { additionalProperties: true }),
	},
	{ additionalProperties: true },
);

export type Hello = Static<typeof HelloSchema>;
export type Command = Static<typeof CommandSchema>;
export type Event = Static<typeof EventSchema>;
export type Response = Static<typeof ResponseSchema>;
export type ProtocolError = Static<typeof ErrorSchema>;
export type Fixture = Static<typeof FixtureSchema>;

const validators: Readonly<Record<Fixture["kind"], TypeCheck<TSchema>>> = {
	hello: TypeCompiler.Compile(HelloSchema),
	command: TypeCompiler.Compile(CommandSchema),
	event: TypeCompiler.Compile(EventSchema),
	control: TypeCompiler.Compile(ControlSchema),
	response: TypeCompiler.Compile(ResponseSchema),
	error: TypeCompiler.Compile(ErrorSchema),
	pairing: TypeCompiler.Compile(PairingSchema),
	attachment: TypeCompiler.Compile(AttachmentResponseSchema),
	export: TypeCompiler.Compile(ExportMetadataSchema),
};
const fixtureValidator = TypeCompiler.Compile(FixtureSchema);

export function validateFixture(value: unknown): boolean {
	if (!fixtureValidator.Check(value)) return false;
	const fixture = value as Fixture;
	return validators[fixture.kind].Check(fixture.message) === fixture.valid;
}

export function compareDecimalCursors(left: string, right: string): number {
	if (
		!new RegExp(DECIMAL_CURSOR_PATTERN).test(left) ||
		!new RegExp(DECIMAL_CURSOR_PATTERN).test(right)
	) {
		throw new TypeError(
			"cursor must be a non-negative canonical decimal string",
		);
	}
	return left.length === right.length
		? left === right
			? 0
			: left < right
				? -1
				: 1
		: left.length < right.length
			? -1
			: 1;
}

function canonicalize(value: unknown): unknown {
	if (typeof value === "string") return value.normalize("NFC");
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.map(([key, item]) => [key.normalize("NFC"), canonicalize(item)] as const)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		for (let index = 1; index < entries.length; index += 1) {
			if (entries[index - 1]![0] === entries[index]![0])
				throw new TypeError(
					"canonical object contains duplicate NFC-normalized keys",
				);
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
	return JSON.stringify(
		canonicalize({ payload: command.payload, type: command.type }),
	);
}

export function semanticCommandSha256(command: SemanticCommand): string {
	return createHash("sha256")
		.update(canonicalSemanticCommand(command), "utf8")
		.digest("hex");
}

export function getProtocolIdentity(): {
	readonly major: 1;
	readonly minor: 0;
	readonly version: "1.0";
} {
	return {
		major: PROTOCOL_MAJOR,
		minor: PROTOCOL_MINOR,
		version: PROTOCOL_VERSION,
	};
}
