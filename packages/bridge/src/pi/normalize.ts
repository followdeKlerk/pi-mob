import { createHash, type Hash } from "node:crypto";
import { BUILT_IN_PI_TOOLS, type NormalizedPiEvent, type RawPiEvent } from "./types";

export const TOOL_OUTPUT_EVENT_MAX_BYTES = 256 * 1024;
export const TOOL_OUTPUT_CALL_MAX_BYTES = 5 * 1024 * 1024;
const TOOL_OUTPUT_METADATA_RESERVE_BYTES = 1024;

export interface PiNormalizationContext {
  readonly sessionId: string;
  /** Stateful per-adapter limiter used to enforce the per-tool-call retention cap. */
  readonly toolOutputLimiter?: ToolOutputLimiter;
}

export interface LimitedToolOutput {
  /** Redacted inline value. Objects retain their shape unless this event is truncated. */
  readonly value: unknown;
  /** Bytes retained inline across this tool call, including this event. */
  readonly retainedBytes: number;
  /** Redacted UTF-8 bytes observed across this tool call, including this event. */
  readonly totalBytes: number;
  readonly isTruncated: boolean;
  /** SHA-256 of the redacted byte stream observed for this call. */
  readonly digest?: string;
}

export interface ToolOutputLimiterOptions {
  readonly maxEventBytes?: number;
  readonly maxCallBytes?: number;
}

type ToolCallOutputState = {
  retainedBytes: number;
  totalBytes: number;
  truncated: boolean;
  hasher: Hash;
};

type SerializationState = {
  readonly ancestors: WeakSet<object>;
  structurallyTruncated: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_SAFE_DEPTH = 32;
const MAX_SAFE_ITEMS = 500;
const PRIVATE_KEY = /path|sourceInfo|sessionFile|fullOutputPath|stack/i;

/**
 * Bounds normalized tool progress/results without throwing away Pi's turn.
 *
 * Pi progress records are accumulated snapshots rather than deltas. The bridge
 * journals each normalized snapshot, so retained/total byte counters describe
 * the exact normalized byte stream journaled for that tool call. `begin()` and
 * `end()` scope that stream; independent/parallel calls have independent caps.
 */
export class ToolOutputLimiter {
  readonly maxEventBytes: number;
  readonly maxCallBytes: number;
  private readonly calls = new Map<string, ToolCallOutputState>();

  constructor(options: ToolOutputLimiterOptions = {}) {
    this.maxEventBytes = byteLimit(options.maxEventBytes, TOOL_OUTPUT_EVENT_MAX_BYTES);
    this.maxCallBytes = byteLimit(options.maxCallBytes, TOOL_OUTPUT_CALL_MAX_BYTES);
  }

  begin(toolCallId: string): void {
    this.calls.set(toolCallId, newToolCallOutputState());
  }

  /** Alias suitable for callers that treat tool start as a state reset. */
  reset(toolCallId?: string): void {
    if (toolCallId === undefined) this.calls.clear();
    else this.calls.delete(toolCallId);
  }

  end(toolCallId: string): void {
    this.calls.delete(toolCallId);
  }

  normalize(toolCallId: string, value: unknown): LimitedToolOutput {
    return this.limit(toolCallId, value);
  }

  limit(toolCallId: string, value: unknown): LimitedToolOutput {
    const state = this.calls.get(toolCallId) ?? newToolCallOutputState();
    this.calls.set(toolCallId, state);
    const allowance = Math.max(0, Math.min(
      this.maxEventBytes - TOOL_OUTPUT_METADATA_RESERVE_BYTES,
      this.maxCallBytes - state.retainedBytes,
    ));

    let measured: MeasuredToolValue;
    try {
      measured = measureToolValue(value, allowance, state.hasher);
      measured = constrainWireValue(
        measured,
        this.maxEventBytes - TOOL_OUTPUT_METADATA_RESERVE_BYTES,
      );
    } catch {
      // Hostile extension values (throwing proxies/getters, for example) must
      // not terminate the turn. Account for a deterministic safe placeholder.
      measured = measureToolValue("<unavailable>", allowance, state.hasher);
      measured.structurallyTruncated = true;
    }

    state.retainedBytes += measured.retainedBytes;
    state.totalBytes += measured.totalBytes;
    state.truncated ||= measured.structurallyTruncated || measured.retainedBytes < measured.totalBytes;

    const base = {
      value: measured.value,
      retainedBytes: state.retainedBytes,
      totalBytes: state.totalBytes,
      isTruncated: state.truncated,
    };
    if (!state.truncated) return base;
    return { ...base, digest: state.hasher.copy().digest("hex").toLowerCase() };
  }
}

function byteLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function newToolCallOutputState(): ToolCallOutputState {
  return { retainedBytes: 0, totalBytes: 0, truncated: false, hasher: createHash("sha256") };
}

interface MeasuredToolValue {
  value: unknown;
  retainedBytes: number;
  totalBytes: number;
  structurallyTruncated: boolean;
}

function measureToolValue(value: unknown, allowance: number, callHasher: Hash): MeasuredToolValue {
  const serialization: SerializationState = { ancestors: new WeakSet(), structurallyTruncated: false };
  const chunks = typeof value === "string"
    ? [redactPrivatePaths(value)]
    : serializeToolValue(value, serialization, 0, false);
  const retained: Uint8Array[] = [];
  let retainedBytes = 0;
  let totalBytes = 0;
  let retentionClosed = allowance === 0;

  for (const chunk of chunks) {
    const bytes = encoder.encode(chunk);
    totalBytes += bytes.byteLength;
    callHasher.update(bytes);
    if (retentionClosed) continue;
    const available = allowance - retainedBytes;
    if (bytes.byteLength <= available) {
      retained.push(bytes);
      retainedBytes += bytes.byteLength;
      continue;
    }
    const safeLength = utf8PrefixLength(bytes, available);
    if (safeLength > 0) {
      retained.push(bytes.subarray(0, safeLength));
      retainedBytes += safeLength;
    }
    retentionClosed = true;
  }

  const retainedText = decodeChunks(retained, retainedBytes);
  let inlineValue: unknown = retainedText;
  if (retainedBytes === totalBytes && typeof value !== "string") {
    try { inlineValue = JSON.parse(retainedText) as unknown; }
    catch { serialization.structurallyTruncated = true; }
  }
  return {
    value: inlineValue,
    retainedBytes,
    totalBytes,
    structurallyTruncated: serialization.structurallyTruncated,
  };
}

function constrainWireValue(
  measured: MeasuredToolValue,
  wireBudget: number,
): MeasuredToolValue {
  let encoded: string;
  try { encoded = JSON.stringify(measured.value); }
  catch { encoded = JSON.stringify("<unavailable>"); }
  if (encoder.encode(encoded).byteLength <= wireBudget) return measured;
  const text = typeof measured.value === "string"
    ? measured.value
    : encoded;
  let low = 0; let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = safeUtf16Prefix(text, middle);
    if (encoder.encode(JSON.stringify(candidate)).byteLength <= wireBudget) low = middle;
    else high = middle - 1;
  }
  const prefix = safeUtf16Prefix(text, low);
  return {
    ...measured,
    value: prefix,
    retainedBytes: Math.min(measured.retainedBytes, encoder.encode(prefix).byteLength),
    structurallyTruncated: true,
  };
}

function safeUtf16Prefix(value: string, length: number): string {
  let end = Math.min(length, value.length);
  if (end > 0 && end < value.length) {
    const code = value.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return value.slice(0, end);
}

function decodeChunks(chunks: readonly Uint8Array[], bytes: number): string {
  if (chunks.length === 0 || bytes === 0) return "";
  if (chunks.length === 1) return decoder.decode(chunks[0]);
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(joined);
}

/** Return the largest prefix that does not split a UTF-8 code point. */
function utf8PrefixLength(bytes: Uint8Array, maximum: number): number {
  let end = Math.max(0, Math.min(maximum, bytes.byteLength));
  if (end === bytes.byteLength) return end;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return end;
}

function* serializeToolValue(value: unknown, state: SerializationState, depth: number, arrayItem: boolean): Generator<string> {
  if (typeof value === "string") { yield JSON.stringify(redactPrivatePaths(value)); return; }
  if (value === null) { yield "null"; return; }
  if (typeof value === "boolean") { yield value ? "true" : "false"; return; }
  if (typeof value === "number") { yield Number.isFinite(value) ? String(value) : "null"; return; }
  if (typeof value === "bigint") { yield JSON.stringify(value.toString()); return; }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    if (arrayItem) yield "null";
    return;
  }
  if (!value || typeof value !== "object") { yield "null"; return; }
  if (depth > MAX_SAFE_DEPTH) {
    state.structurallyTruncated = true;
    yield JSON.stringify("<truncated>");
    return;
  }
  if (state.ancestors.has(value)) {
    state.structurallyTruncated = true;
    yield JSON.stringify("<circular>");
    return;
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      yield "[";
      let length = 0;
      try { length = value.length; }
      catch { state.structurallyTruncated = true; yield JSON.stringify("<unavailable>"); yield "]"; return; }
      const retainedLength = Math.min(length, MAX_SAFE_ITEMS);
      for (let index = 0; index < retainedLength; index += 1) {
        if (index > 0) yield ",";
        let item: unknown;
        try { item = value[index]; }
        catch { state.structurallyTruncated = true; item = "<unavailable>"; }
        yield* serializeToolValue(item, state, depth + 1, true);
      }
      if (length > retainedLength) {
        state.structurallyTruncated = true;
        if (retainedLength > 0) yield ",";
        yield JSON.stringify("<truncated>");
      }
      yield "]";
      return;
    }

    let keys: string[];
    try { keys = Object.keys(value); }
    catch { state.structurallyTruncated = true; yield JSON.stringify("<unavailable>"); return; }
    yield "{";
    let emitted = 0;
    let inspected = 0;
    for (const key of keys) {
      if (PRIVATE_KEY.test(key)) continue;
      if (inspected >= MAX_SAFE_ITEMS) {
        state.structurallyTruncated = true;
        break;
      }
      inspected += 1;
      let item: unknown;
      try { item = (value as Record<string, unknown>)[key]; }
      catch { state.structurallyTruncated = true; item = "<unavailable>"; }
      if (typeof item === "undefined" || typeof item === "function" || typeof item === "symbol") continue;
      if (emitted > 0) yield ",";
      yield JSON.stringify(redactPrivatePaths(key));
      yield ":";
      yield* serializeToolValue(item, state, depth + 1, false);
      emitted += 1;
    }
    yield "}";
  } finally {
    state.ancestors.delete(value);
  }
}

function redactPrivatePaths(value: string): string {
  return value
    .replace(/\bfile:\/\/[^\s"'<>),\]}]+/g, "<host-private>")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "<host-private>")
    .replace(/\\\\[^\s"'<>]+/g, "<host-private>")
    .replace(/~\/[^\s"'<>]+/g, "<host-private>")
    .replace(/(^|[\s("'=:;,\[{])\/(?!\/)[^\s"'<>),\]}]*/gm, "$1<host-private>");
}

const TEXT_LIMIT = 262_144;
function text(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT)}…` : value;
}
function numberOr(value: unknown, fallback: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function identifier(value: unknown): string {
  const raw = String(value ?? "unknown");
  return raw.length > 256 ? `${raw.slice(0, 255)}…` : raw;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safe(value: unknown, depth = 0): unknown {
  if (depth > 6) return "<truncated>";
  if (typeof value === "string") {
    const bounded = text(value);
    return redactPrivatePaths(bounded);
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => safe(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/path|sourceInfo|sessionFile|fullOutputPath|stack/i.test(key)) continue;
      out[key] = safe(item, depth + 1);
    }
    return out;
  }
  return value;
}
function event(type: NormalizedPiEvent["type"], sessionId: string, payload: Record<string, unknown> = {}): NormalizedPiEvent {
  return { type, payload: { sessionId, ...payload } };
}

/** Normalize exact Pi 0.80.6 events without exposing upstream shapes or host paths. */
export function normalizePiEvent(raw: RawPiEvent, context: PiNormalizationContext): readonly NormalizedPiEvent[] {
  const sessionId = context.sessionId;
  switch (raw.type) {
    case "agent_start": return [event("session.state", sessionId, { runtimeState: "running" })];
    case "agent_end": return [event("session.state", sessionId, { runtimeState: raw.willRetry === true ? "retrying" : "finishing" })];
    case "agent_settled": {
      context.toolOutputLimiter?.reset();
      return [event("turn.settled", sessionId, {})];
    }
    case "turn_start": return [event("turn.started", sessionId, { turnIndex: raw.turnIndex, timestamp: raw.timestamp })];
    case "turn_end": return [event("assistant.completed", sessionId, { summary: safe(raw.message), toolResultCount: Array.isArray(raw.toolResults) ? raw.toolResults.length : 0 })];
    case "message_start": {
      const message = object(raw.message);
      return [event(message.role === "assistant" ? "assistant.started" : "reasoning.started", sessionId, { contentBlockId: message.id ?? raw.messageId ?? "message" })];
    }
    case "message_update": return normalizeMessageUpdate(raw, sessionId);
    case "message_end": {
      const message = object(raw.message);
      if (message.stopReason === "aborted") {
        return [event("turn.aborted", sessionId, { reason: "aborted" })];
      }
      return [event("assistant.completed", sessionId, { content: safe(raw.message) })];
    }
    case "tool_execution_start": {
      const toolCallId = identifier(raw.toolCallId);
      context.toolOutputLimiter?.begin(toolCallId);
      return [event("tool.started", sessionId, {
        toolCallId, toolName: identifier(raw.toolName),
        builtIn: BUILT_IN_PI_TOOLS.includes(raw.toolName as never), arguments: safe(raw.args), status: "running",
      })];
    }
    case "tool_execution_update": {
      const toolCallId = identifier(raw.toolCallId);
      const limited = (context.toolOutputLimiter ?? new ToolOutputLimiter()).limit(toolCallId, raw.partialResult);
      return [event("tool.output", sessionId, {
        toolCallId, output: limited.value, retainedBytes: limited.retainedBytes,
        totalBytes: limited.totalBytes, isTruncated: limited.isTruncated,
        ...(limited.digest ? { digest: limited.digest } : {}),
      })];
    }
    case "tool_execution_end": {
      const toolCallId = identifier(raw.toolCallId);
      const limiter = context.toolOutputLimiter ?? new ToolOutputLimiter();
      const limited = limiter.limit(toolCallId, raw.result);
      limiter.end(toolCallId);
      return [event(raw.isError === true ? "tool.failed" : "tool.completed", sessionId, {
        toolCallId, toolName: identifier(raw.toolName), result: limited.value, isError: raw.isError === true,
        retainedBytes: limited.retainedBytes, totalBytes: limited.totalBytes, isTruncated: limited.isTruncated,
        ...(limited.digest ? { digest: limited.digest } : {}),
      })];
    }
    case "queue_update": return [event("queue.snapshot", sessionId, { steering: safe(raw.steering), followUp: safe(raw.followUp) })];
    case "compaction_start": return [event("compaction.state", sessionId, { state: "running", reason: raw.reason })];
    case "compaction_end": return [event("compaction.state", sessionId, { state: raw.aborted === true ? "aborted" : raw.errorMessage ? "failed" : "completed", willRetry: raw.willRetry === true })];
    case "auto_retry_start": return [event("retry.state", sessionId, { state: "waiting", attempt: raw.attempt, maxAttempts: raw.maxAttempts, delayMs: raw.delayMs })];
    case "auto_retry_end": return [event("retry.state", sessionId, { state: raw.success === true ? "completed" : "failed", attempt: raw.attempt })];
    case "entry_appended": return [event("session.state", sessionId, { entry: safe(raw.entry) })];
    case "session_info_changed": return [event("session.metadata", sessionId, { name: text(raw.name) })];
    case "thinking_level_changed": return [event("model.state", sessionId, { thinkingLevel: raw.level })];
    case "model_changed": return [event("model.state", sessionId, { provider: text(raw.provider), modelId: text(raw.id ?? raw.modelId) })];
    case "steering_mode_changed": return [event("model.state", sessionId, { steeringMode: text(raw.mode) })];
    case "follow_up_mode_changed": return [event("model.state", sessionId, { followUpMode: text(raw.mode) })];
    case "session_stats": return [event("context.state", sessionId, {
      tokens: numberOr(raw.tokens, null), cost: numberOr(raw.cost, null),
      contextWindow: numberOr(raw.contextWindow ?? raw.context_window, null),
    })];
    case "extension_error": return [event("error.event", sessionId, { code: "internal_error", retryable: false, extensionEvent: safe(raw.event) })];
    case "extension_ui_request": return normalizeExtensionUi(raw, sessionId);
    default: return [];
  }
}

function normalizeMessageUpdate(raw: RawPiEvent, sessionId: string): readonly NormalizedPiEvent[] {
  const delta = object(raw.assistantMessageEvent);
  const kind = String(delta.type ?? "");
  const contentBlockId = String(delta.contentIndex ?? delta.id ?? "content");
  if (kind === "text_start") return [event("assistant.started", sessionId, { contentBlockId })];
  if (kind === "text_delta") return [event("assistant.delta", sessionId, { contentBlockId, text: text(delta.delta ?? delta.text) })];
  if (kind === "text_end") return [event("assistant.completed", sessionId, { contentBlockId })];
  if (kind === "thinking_start") return [event("reasoning.started", sessionId, { contentBlockId })];
  if (kind === "thinking_delta") return [event("reasoning.delta", sessionId, { contentBlockId, text: text(delta.delta ?? delta.text) })];
  if (kind === "thinking_end") return [event("reasoning.completed", sessionId, { contentBlockId })];
  if (kind === "error") return [event(
    delta.reason === "aborted" ? "turn.aborted" : "turn.failed",
    sessionId,
    delta.reason === "aborted"
      ? { reason: "aborted" }
      : { reason: "provider_interrupted", errorCode: "provider_interrupted" },
  )];
  return [];
}

function normalizeExtensionUi(raw: RawPiEvent, sessionId: string): readonly NormalizedPiEvent[] {
  const method = String(raw.method ?? "");
  const id = String(raw.id ?? "");
  if (["select", "confirm", "input", "editor"].includes(method)) return [event("extension.dialog", sessionId, { dialogId: id, method, title: text(raw.title), options: safe(raw.options), placeholder: text(raw.placeholder), prefill: text(raw.prefill), timeout: raw.timeout })];
  if (method === "notify") return [event("extension.notify", sessionId, { message: text(raw.message), notifyType: raw.notifyType })];
  if (method === "setStatus") return [event("extension.status", sessionId, { statusKey: text(raw.statusKey), statusText: text(raw.statusText) })];
  if (method === "setWidget") return [event("extension.widget", sessionId, { widgetKey: text(raw.widgetKey), widgetLines: safe(raw.widgetLines), placement: raw.widgetPlacement })];
  if (method === "setTitle") return [event("extension.title", sessionId, { title: text(raw.title) })];
  if (method === "set_editor_text") return [event("extension.editor_prefill", sessionId, { text: text(raw.text) })];
  return [];
}
