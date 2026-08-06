/**
 * Phase 1 — canonical session event contract.
 *
 * This module is the closed TypeScript shape of the session transcript
 * authority described in `pi-mob-simplification-plan.md` §5. Every
 * user-visible Pi occurrence that reaches the mobile client must pass
 * through the canonical-event store, the canonical-event notifier,
 * and the canonical-event reducer.
 *
 * This slice reuses the existing transactional `BridgeStore.events`
 * table as the durable store; it does not introduce a parallel
 * persistence layer. The contract here is the TypeScript-level guard
 * the rewrite slice puts in front of `appendNormalizedEvent`, so the
 * curated event set is closed and bounded. Raw Pi notifications remain
 * available only through diagnostics (see
 * `packages/bridge/src/session-events/diagnostics.ts`).
 *
 * The rewrite MUST NOT add new event families without a contract
 * entry, a fixture, and a deletion criterion. See
 * `docs/rewrite/source-of-truth-inventory.md`.
 */

// ------------------------------ envelope ------------------------------

/**
 * Closed union of canonical session event types. This list is the
 * bridge half of the contract the rewrite slice puts in front of
 * `appendNormalizedEvent`. It must stay aligned with the curated
 * types emitted by `normalizeCuratedPiEvent` in
 * `packages/bridge/src/pi/normalize.ts`; see
 * `packages/bridge/test/session-events/canonical-event-store.test.ts`
 * for the matching fixture contract.
 *
 * The closed set explicitly accepts `reasoning.delta`/`reasoning.started`
 * /`reasoning.completed` as curated: the adapter previously filtered
 * `reasoning.delta` out of the user-visible stream but kept the
 * lifecycle events. The rewrite slice publishes them all to the
 * canonical log so the mobile client can render thinking lifecycle
 * without re-deriving it from raw Pi state. The daemon still treats
 * `reasoning.delta` as non-durable for transcript projection at a
 * later phase; the canonical contract only guarantees the wire shape.
 */
export const CANONICAL_EVENT_TYPES = [
  "session.state",
  "session.metadata",
  "user.message.created",
  "turn.started",
  "turn.settled",
  "turn.aborted",
  "turn.failed",
  "turn.indeterminate",
  "turn.waiting_for_input",
  "turn.retrying",
  "turn.compacting",
  "turn.accepted",
  "turn.queued",
  "assistant.started",
  "assistant.delta",
  "assistant.content.replaced",
  "assistant.message.completed",
  "assistant.completed",
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
  "tool.started",
  "tool.output",
  "tool.progress.replaced",
  "tool.completed",
  "tool.failed",
  "tool.cancelled",
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
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

/**
 * Event families that form the mobile transcript reducer's dense log.
 * Operational/session-state notifications remain on the compatibility
 * stream and must not consume canonical transcript sequence numbers.
 */
export const CANONICAL_TRANSCRIPT_EVENT_TYPES = [
  "user.message.created",
  "turn.started",
  "turn.waiting_for_input",
  "turn.settled",
  "turn.aborted",
  "turn.failed",
  "assistant.started",
  "assistant.delta",
  "assistant.content.replaced",
  "assistant.message.completed",
  "assistant.completed",
  "tool.started",
  "tool.output",
  "tool.progress.replaced",
  "tool.completed",
  "tool.failed",
  "tool.cancelled",
] as const satisfies readonly CanonicalEventType[];

export type CanonicalTranscriptEventType = (typeof CANONICAL_TRANSCRIPT_EVENT_TYPES)[number];

export function isCanonicalTranscriptEventType(value: string): value is CanonicalTranscriptEventType {
  return (CANONICAL_TRANSCRIPT_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Stable identity envelope. Every canonical event carries the same
 * four fields: a deterministic `eventId`, the owning `sessionId`, the
 * per-session monotonic `sequence`, and the wall-clock `occurredAt`
 * ISO timestamp. The mobile reducer must never infer identity from
 * position or timing.
 */
export interface CanonicalEventEnvelope<TPayload = unknown> {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly type: CanonicalEventType;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

// ------------------------------ payloads ------------------------------

export interface SessionStatePayload {
  readonly runtimeState?: string;
  readonly attentionState?: string;
  readonly [key: string]: unknown;
}

export interface SessionMetadataPayload {
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface TurnLifecyclePayload {
  readonly turnId?: string;
  readonly reason?: string;
  readonly errorCode?: string;
  readonly [key: string]: unknown;
}

export interface AssistantPayload {
  readonly turnId?: string;
  readonly messageId?: string;
  readonly contentBlockId?: string;
  readonly text?: string;
  readonly content?: unknown;
  readonly summary?: unknown;
  readonly [key: string]: unknown;
}

export interface ToolStartedPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly builtIn?: boolean;
  readonly arguments?: unknown;
  readonly status?: string;
  readonly [key: string]: unknown;
}

export interface ToolOutputPayload {
  readonly toolCallId: string;
  readonly output?: unknown;
  readonly retainedBytes?: number;
  readonly totalBytes?: number;
  readonly isTruncated?: boolean;
  readonly digest?: string;
  readonly [key: string]: unknown;
}

export interface ToolTerminalPayload {
  readonly toolCallId: string;
  readonly toolName?: string;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly retainedBytes?: number;
  readonly totalBytes?: number;
  readonly isTruncated?: boolean;
  readonly digest?: string;
  readonly errorInfo?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface ExtensionDialogPayload {
  readonly dialogId: string;
  readonly method: string;
  readonly state?: string;
  readonly title?: string;
  readonly message?: string;
  readonly placeholder?: string;
  readonly prefill?: string;
  readonly options?: readonly string[];
  readonly timeout?: number;
  readonly expiresAt?: string;
  readonly createdAt?: string;
  readonly [key: string]: unknown;
}

export interface ExtensionNotifyPayload {
  readonly message?: string;
  readonly notifyType?: string;
  readonly [key: string]: unknown;
}

export interface ExtensionStatusPayload {
  readonly statusKey?: string;
  readonly statusText?: string;
  readonly [key: string]: unknown;
}

export interface ExtensionWidgetPayload {
  readonly widgetKey?: string;
  readonly widgetLines?: readonly string[];
  readonly placement?: string;
  readonly [key: string]: unknown;
}

export interface ExtensionTitlePayload {
  readonly title?: string;
  readonly [key: string]: unknown;
}

export interface ExtensionEditorPrefillPayload {
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface QueueSnapshotPayload {
  readonly steering?: unknown;
  readonly followUp?: unknown;
  readonly [key: string]: unknown;
}

export interface ModelStatePayload {
  readonly thinkingLevel?: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly steeringMode?: string;
  readonly followUpMode?: string;
  readonly [key: string]: unknown;
}

export interface ContextStatePayload {
  readonly tokens?: number | null;
  readonly cost?: number | null;
  readonly contextWindow?: number | null;
  readonly [key: string]: unknown;
}

export interface RetryStatePayload {
  readonly state?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly [key: string]: unknown;
}

export interface CompactionStatePayload {
  readonly state?: string;
  readonly reason?: string;
  readonly willRetry?: boolean;
  readonly [key: string]: unknown;
}

export interface ErrorEventPayload {
  readonly code?: string;
  readonly retryable?: boolean;
  readonly extensionEvent?: unknown;
  readonly [key: string]: unknown;
}

// ------------------------------ helpers ------------------------------

export const CANONICAL_MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

/**
 * Type guard for a closed canonical event type. Returns true only for
 * the closed set declared above. Unknown event strings MUST be
 * rejected by the canonical-event store and routed to diagnostics
 * instead of the user-visible stream.
 */
export function isCanonicalEventType(value: string): value is CanonicalEventType {
  return (CANONICAL_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate a canonical envelope. Returns null on success or an error
 * string describing the first invariant violation. The store applies
 * this check before `BridgeStore.appendEvent()` so unknown events
 * never reach the durable journal.
 */
export function validateCanonicalEnvelope(
  envelope: Readonly<Partial<CanonicalEventEnvelope>>,
): string | null {
  if (typeof envelope.eventId !== "string" || envelope.eventId.length === 0 || envelope.eventId.length > 128) {
    return "eventId must be a non-empty string up to 128 characters";
  }
  if (typeof envelope.sessionId !== "string" || envelope.sessionId.length === 0 || envelope.sessionId.length > 128) {
    return "sessionId must be a non-empty string up to 128 characters";
  }
  if (typeof envelope.sequence !== "number" || !Number.isInteger(envelope.sequence) || envelope.sequence < 1 || envelope.sequence > CANONICAL_MAX_SEQUENCE) {
    return "sequence must be an integer in 1..MAX_SAFE_INTEGER";
  }
  if (typeof envelope.type !== "string" || !isCanonicalEventType(envelope.type)) {
    return "type must be one of the closed canonical event types";
  }
  if (typeof envelope.occurredAt !== "string" || envelope.occurredAt.length === 0 || envelope.occurredAt.length > 64) {
    return "occurredAt must be a non-empty string";
  }
  if (typeof envelope.payload !== "object" || envelope.payload === null || Array.isArray(envelope.payload)) {
    return "payload must be a plain object";
  }
  return null;
}