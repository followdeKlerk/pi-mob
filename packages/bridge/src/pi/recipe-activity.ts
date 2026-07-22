/** The small, public recipe shape produced by this pure projection. */
export type RecipeStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type RecipeTiming = {
  readonly startedAt: string;
  readonly updatedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
};
export type RecipeTruncation = {
  readonly retainedBytes: number;
  readonly totalBytes: number;
  readonly digest?: string;
  readonly isTruncated: boolean;
};
export type RecipeErrorInfo = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly recommendedDelayMs?: number | null;
};
export type RecipeActivity = {
  readonly kind: "thinking" | "tool";
  readonly sessionId: string;
  readonly turnId: string;
  readonly activityId: string;
  readonly ordinal: number;
  readonly status: RecipeStatus;
  readonly timing: RecipeTiming;
  readonly title: string;
  readonly providerSummary?: never;
  readonly toolName?: string;
  readonly arguments?: string;
  readonly output?: string;
  readonly errorInfo?: RecipeErrorInfo;
  readonly truncation?: RecipeTruncation;
};

type ProjectableEvent = {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Journal timestamp, when projecting events read from the durable stream. */
  readonly occurredAt?: string | number | Date;
};

export interface RecipeProjectorOptions {
  readonly sessionId?: string;
  /** Used for sparse normalized events which do not carry turnId themselves. */
  readonly turnId?: string;
}

const MAX_TEXT = 240;
const MAX_ID = 128;
const encoder = new TextEncoder();
const TERMINAL = new Set<RecipeStatus>(["completed", "failed", "cancelled"]);

/**
 * Pure reducer/projector for the existing normalized `reasoning.*` and
 * `tool.*` events. It deliberately never turns reasoning deltas into a
 * provider summary: a missing provider summary is the truthful state.
 *
 * Replaying the same events is safe. Activity identity is scoped by
 * `(sessionId, turnId, activityId)` and the first observed kind wins; a later
 * event attempting to reinterpret that identity as the other kind is ignored.
 */
export class RecipeActivityProjector {
  private readonly activities = new Map<string, RecipeActivity>();
  private readonly ordinals = new Map<string, number>();
  private activeTurnId: string | undefined;
  private readonly fallbackSessionId: string | undefined;
  private readonly fallbackTurnId: string | undefined;

  constructor(options: RecipeProjectorOptions = {}) {
    this.fallbackSessionId = options.sessionId;
    this.fallbackTurnId = options.turnId;
    this.activeTurnId = options.turnId;
  }

  apply(event: ProjectableEvent): RecipeActivityProjector {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "turn.started" && stringValue(payload.turnId)) {
      this.activeTurnId = boundedId(stringValue(payload.turnId)!, "turn");
      return this;
    }
    if (!event.type.startsWith("tool.") && !event.type.startsWith("reasoning.")) return this;

    const sessionId = stringValue(payload.sessionId) ?? this.fallbackSessionId;
    const turnId = stringValue(payload.turnId) ?? this.activeTurnId ?? this.fallbackTurnId;
    const activityId = stringValue(payload.toolCallId) ?? stringValue(payload.contentBlockId);
    if (!sessionId || !turnId || !activityId) return this;
    const kind = event.type.startsWith("tool.") ? "tool" : "thinking";
    const safeSession = boundedId(sessionId, "session");
    const safeTurn = boundedId(turnId, "turn");
    const safeActivity = boundedId(activityId, "activity");
    const identity = `${safeSession}\u0000${safeTurn}\u0000${safeActivity}`;
    const at = eventTime(event, payload);
    const previous = this.activities.get(identity);
    if (previous && previous.kind !== kind) return this;

    const next = previous
      ? this.merge(previous, event.type, payload, at)
      : this.create(kind, safeSession, safeTurn, safeActivity, event.type, payload, at);
    if (next) this.activities.set(identity, next);
    return this;
  }

  applyAll(events: readonly ProjectableEvent[]): RecipeActivity[] {
    for (const event of events) this.apply(event);
    return this.snapshot();
  }

  snapshot(): RecipeActivity[] {
    return [...this.activities.values()]
      .sort((a, b) => a.ordinal - b.ordinal || a.activityId.localeCompare(b.activityId))
      .map((activity) => freezeActivity(activity));
  }

  private create(
    kind: "thinking" | "tool", sessionId: string, turnId: string, activityId: string,
    type: string, payload: Record<string, unknown>, at: string,
  ): RecipeActivity | undefined {
    if (!isStart(type)) return undefined;
    const ordinal = this.ordinals.get(turnId) ?? 0;
    this.ordinals.set(turnId, ordinal + 1);
    const base = {
      kind, sessionId, turnId, activityId, ordinal,
      status: statusFor(type), timing: { startedAt: at } as RecipeTiming,
      title: kind === "tool" ? boundedText(stringValue(payload.toolName) ?? "Tool", 128).value : "Thinking",
    };
    if (kind === "thinking") return base as RecipeActivity;
    const args = boundedText(stringify(payload.arguments, "{}"), MAX_TEXT);
    const output = boundedText("-", MAX_TEXT);
    return { ...base, toolName: boundedText(stringValue(payload.toolName) ?? "tool", 128).value, arguments: args.value, output: output.value, ...(args.truncation ? { truncation: args.truncation } : {}) } as RecipeActivity;
  }

  private merge(previous: RecipeActivity, type: string, payload: Record<string, unknown>, at: string): RecipeActivity {
    const terminal = statusFor(type);
    let next: RecipeActivity = previous;
    let timing: RecipeTiming = { ...previous.timing, updatedAt: at };
    if (TERMINAL.has(terminal)) {
      const started = Date.parse(timing.startedAt); const finished = Date.parse(at);
      timing = {
        ...timing,
        finishedAt: at,
        ...(Number.isFinite(started) && Number.isFinite(finished)
          ? { durationMs: Math.max(0, finished - started) }
          : {}),
      };
    }
    next = { ...next, status: terminal === "running" ? previous.status : terminal, timing };
    if (previous.kind === "tool") {
      const args = payload.arguments === undefined ? undefined : boundedText(stringify(payload.arguments, "{}"), MAX_TEXT);
      const rawOutput = payload.output ?? payload.result;
      const output = rawOutput === undefined ? undefined : boundedText(stringify(rawOutput, "-"), MAX_TEXT);
      const truncation = mergeTruncation(previous.truncation, args?.truncation, output?.truncation, payload);
      next = { ...next, ...(args ? { arguments: args.value } : {}), ...(output ? { output: output.value } : {}), ...(truncation ? { truncation } : {}) };
      if (type === "tool.failed") next = { ...next, errorInfo: errorInfo(payload) };
    }
    return next;
  }
}

/** One-shot convenience API for history replay and tests. */
export function projectRecipeActivities(
  events: readonly ProjectableEvent[], options: RecipeProjectorOptions = {},
): RecipeActivity[] {
  return new RecipeActivityProjector(options).applyAll(events);
}

/** Alias retained for callers that describe this operation as a reduction. */
export const reduceRecipeActivities = projectRecipeActivities;

function isStart(type: string): boolean {
  return type === "tool.started" || type === "reasoning.started";
}
function statusFor(type: string): RecipeStatus {
  if (type === "tool.failed") return "failed";
  if (type === "tool.cancelled") return "cancelled";
  if (type === "tool.completed" || type === "reasoning.completed") return "completed";
  return "running";
}
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function boundedId(value: string, fallback: string): string { return boundedText(value || fallback, MAX_ID).value || fallback; }
function stringify(value: unknown, fallback: string): string {
  if (typeof value === "string") return value || fallback;
  try { const json = JSON.stringify(value); return json && json !== "undefined" ? json : fallback; } catch { return fallback; }
}
function boundedText(value: string, maximum: number): { value: string; truncation?: RecipeTruncation } {
  if (value.length <= maximum) return { value: value || "-" };
  const retained = value.slice(0, maximum);
  return { value: retained || "-", truncation: { retainedBytes: encoder.encode(retained).byteLength, totalBytes: encoder.encode(value).byteLength, isTruncated: true } };
}
function mergeTruncation(...values: Array<RecipeTruncation | undefined | Record<string, unknown>>): RecipeTruncation | undefined {
  const found = values.filter((value): value is RecipeTruncation | Record<string, unknown> => !!value);
  if (!found.length) return undefined;
  let retained = 0; let total = 0; let digest: string | undefined; let truncated = false;
  for (const value of found) {
    const item = value as Record<string, unknown>;
    const r = typeof item.retainedBytes === "number" ? Math.max(0, item.retainedBytes) : 0;
    const t = typeof item.totalBytes === "number" ? Math.max(r, item.totalBytes) : r;
    retained = Math.max(retained, r); total = Math.max(total, t); truncated ||= item.isTruncated === true || r < t;
    if (typeof item.digest === "string" && /^[0-9a-f]{64}$/.test(item.digest)) digest = item.digest;
  }
  return { retainedBytes: retained, totalBytes: total, ...(digest ? { digest } : {}), isTruncated: truncated };
}
function errorInfo(payload: Record<string, unknown>): RecipeErrorInfo {
  const raw = payload.errorInfo && typeof payload.errorInfo === "object" ? payload.errorInfo as Record<string, unknown> : {};
  const message = boundedText(stringValue(raw.message) ?? (payload.isError === true ? "Tool execution failed" : "Tool execution failed"), 512).value;
  return { code: stringValue(raw.code) ?? "internal_error", message, retryable: raw.retryable === true, ...(typeof raw.recommendedDelayMs === "number" || raw.recommendedDelayMs === null ? { recommendedDelayMs: raw.recommendedDelayMs } : {}) };
}
function eventTime(event: ProjectableEvent, payload: Record<string, unknown>): string {
  const raw = event.occurredAt ?? payload.timestamp ?? payload.startedAt;
  const date = raw instanceof Date ? raw : new Date(raw as string | number);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "1970-01-01T00:00:00.000Z";
}
function freezeActivity(activity: RecipeActivity): RecipeActivity {
  const timing = Object.freeze({ ...activity.timing });
  const truncation = activity.truncation ? Object.freeze({ ...activity.truncation }) : undefined;
  const error = activity.errorInfo ? Object.freeze({ ...activity.errorInfo }) : undefined;
  return Object.freeze({ ...activity, timing, ...(truncation ? { truncation } : {}), ...(error ? { errorInfo: error } : {}) });
}
