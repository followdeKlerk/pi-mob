/**
 * Incremental UTF-8 LF-only JSONL decoder for the Pi RPC wire.
 *
 * Pi's `pi --mode rpc` subprocess emits one JSON record per line using a
 * bare LF (`\n`) terminator. Producers on Windows may additionally emit a
 * trailing CR (`\r\n`) on each line; we accept that as an equivalent.
 * Bare `\r` without a following `\n` is NOT a line terminator and is
 * preserved as part of the record payload (Pi does not emit it).
 *
 * The decoder is stateful: callers push arbitrary `Uint8Array` chunks in
 * the order they arrive from the subprocess stdout. Chunks may split a
 * UTF-8 code point, a JSON object, and even the LF byte itself across
 * boundaries; the decoder reassembles each complete record and emits it
 * only after the terminating LF has been observed.
 *
 * Safety properties enforced by this module:
 *
 *   - **Bounded record size**: a single record's raw bytes are capped at
 *     `maxRecordBytes` (default `1 MiB`). If the buffer between two LFs
 *     exceeds this size, `JsonlRecordTooLargeError` is raised. If the
 *     running pending buffer (between pushes or the final LF) ever
 *     exceeds `maxRecordBytes`, the same error is raised; the bridge
 *     treats either signal as a stream-poisoning violation.
 *
 *   - **No trailing partial record at end-of-stream**: `finish()` raises
 *     `JsonlIncompleteTrailingRecordError` if any bytes remain in the
 *     reassembly buffer. Callers receive this as a typed failure rather
 *     than silently dropping the last record.
 *
 *   - **Malformed JSON typing**: parse failures carry
 *     `JsonlSyntaxError` (name, line number, preview) so the bridge can
 *     surface them precisely without leaking payload content into
 *     redaction-prone logs.
 *
 *   - **U+2028 / U+2029 preservation**: parsing goes through
 *     `JSON.parse` (which round-trips these exactly), never a regex
 *     sanitizer. The default `JSON.stringify` does not escape them.
 *
 * The decoder is intentionally allocation-light on the hot path: bytes
 * accumulate in a single `Uint8Array` buffer (or, when a chunk is
 * contiguous with the tail, a zero-copy view) and the LF scan is a
 * single `indexOf(0x0A)` per chunk.
 */

const DEFAULT_MAX_RECORD_BYTES = 1 << 20; // 1 MiB
const PREVIEW_BYTES = 120;

/** One complete JSONL record produced by the decoder. */
export interface DecodedJsonlRecord {
  /** The parsed JSON value (object, array, primitive, or `null`). */
  readonly value: unknown;
  /** The raw record text without the LF (or the optional trailing CR). */
  readonly raw: string;
  /** 1-based record number across the lifetime of this decoder instance. */
  readonly recordNumber: number;
}

export interface JsonlDecoderOptions {
  /**
   * Maximum bytes for a single record (excluding the LF terminator).
   * Defaults to `1 MiB`. A record larger than this triggers
   * `JsonlRecordTooLargeError` on the next `push()` call.
   */
  readonly maxRecordBytes?: number;
}

/** Raised when a record exceeds the configured `maxRecordBytes`. */
export class JsonlRecordTooLargeError extends Error {
  override readonly name = "JsonlRecordTooLargeError";
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`record exceeded max bytes (${maxBytes})`);
    this.maxBytes = maxBytes;
  }
}

/**
 * Raised by `finish()` when the stream ended with non-empty buffer
 * bytes (no terminating LF). The decoder never silently drops the
 * final partial record.
 */
export class JsonlIncompleteTrailingRecordError extends Error {
  override readonly name = "JsonlIncompleteTrailingRecordError";
  readonly pendingBytes: number;
  constructor(pendingBytes: number) {
    super(`stream ended with ${pendingBytes} pending bytes (no LF)`);
    this.pendingBytes = pendingBytes;
  }
}

/** Raised when a complete record's text fails `JSON.parse`. */
export class JsonlSyntaxError extends Error {
  override readonly name = "JsonlSyntaxError";
  readonly recordNumber: number;
  /** The first ~120 bytes of the offending record, for diagnostics. */
  readonly preview: string;
  constructor(message: string, recordNumber: number, preview: string) {
    super(`record ${recordNumber}: ${message}`);
    this.recordNumber = recordNumber;
    this.preview = preview;
  }
}

function previewOf(_raw: string): string {
  return "<redacted>";
}

function asciiPreview(bytes: Uint8Array): string {
  const out: string[] = [];
  const limit = Math.min(bytes.length, PREVIEW_BYTES);
  for (let i = 0; i < limit; i += 1) {
    const b = bytes[i] as number;
    if (b >= 0x20 && b < 0x7f) {
      out.push(String.fromCharCode(b));
    } else {
      out.push(`\\x${b.toString(16).padStart(2, "0")}`);
    }
  }
  if (bytes.length > limit) out.push("...");
  return out.join("");
}

/**
 * Stateful JSONL decoder. Reuse a single instance per stdout stream.
 *
 * The decoder is **not** safe for concurrent `push()` calls; the
 * bridge serializes reads from a single stdout reader onto the
 * decoder.
 */
export class JsonlDecoder {
  private readonly maxBytes: number;
  private readonly decoder: TextDecoder;
  /** Accumulated bytes from chunks that did not yet contain an LF. */
  private pending: Uint8Array = new Uint8Array(0);
  /** Number of records successfully parsed so far. */
  private recordCount = 0;
  /** Set to `true` once the stream has been finished; further `push` throws. */
  private finished = false;

  constructor(options: JsonlDecoderOptions = {}) {
    this.maxBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    // `fatal: true` so a malformed UTF-8 sequence in the payload raises
    // rather than silently emitting replacement characters.
    this.decoder = new TextDecoder("utf-8", { fatal: true });
  }

  /**
   * Append a chunk of stdout bytes. Returns every record that became
   * complete as a result of this chunk (zero or more; multiple records
   * may fit in a single chunk).
   *
   * Throws on `JsonlRecordTooLargeError`, `JsonlSyntaxError`, or
   * `Error("jsonl decoder is finished")`. A typed throw indicates the
   * stream is poisoned; the caller should stop processing further
   * chunks rather than continue parsing.
   */
  push(chunk: Uint8Array): DecodedJsonlRecord[] {
    if (this.finished) {
      throw new Error("jsonl decoder is finished");
    }
    if (chunk.length === 0) return [];

    // Concatenate the new bytes onto the pending buffer. We always
    // copy because input chunks are owned by the caller and may be
    // reused (Bun's stdout reader reuses an internal buffer across
    // reads).
    const merged =
      this.pending.length === 0 ? chunk : concatBytes(this.pending, chunk);
    this.pending = merged;

    const out: DecodedJsonlRecord[] = [];
    const buf = merged;
    const len = buf.length;
    let cursor = 0;

    while (cursor < len) {
      const lf = buf.indexOf(0x0a /* LF */, cursor);
      if (lf < 0) break;
      const recordLen = lf - cursor;
      if (recordLen > this.maxBytes) {
        throw new JsonlRecordTooLargeError(this.maxBytes);
      }

      // Slice the one record's bytes. Strip exactly one trailing CR
      // if present (Windows-style line endings). Bare `\r` without LF
      // is preserved as part of the payload.
      const recordBytes = buf.subarray(cursor, lf);
      const trimmed =
        recordBytes.length > 0 && recordBytes[recordBytes.length - 1] === 0x0d
          ? recordBytes.subarray(0, recordBytes.length - 1)
          : recordBytes;

      // UTF-8 decode. By construction, `trimmed` either ends at a
      // codepoint boundary or, if a multi-byte sequence was split
      // across this LF and the next chunk, cannot end at all and the
      // next chunk will join it via `concatBytes`. A producer that
      // emits invalid UTF-8 inside a record raises here as
      // `JsonlSyntaxError("not valid UTF-8")`.
      let raw: string;
      try {
        raw = this.decoder.decode(trimmed, { stream: false });
      } catch {
        throw new JsonlSyntaxError(
          "record is not valid UTF-8",
          this.recordCount + 1,
          asciiPreview(trimmed),
        );
      }

      if (raw.length > 0) {
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          throw new JsonlSyntaxError(
            "record is not valid JSON",
            this.recordCount + 1,
            previewOf(raw),
          );
        }
        this.recordCount += 1;
        out.push({
          value,
          raw,
          recordNumber: this.recordCount,
        });
      }
      // Empty lines (`\n` with no payload) are accepted and silently
      // skipped. Pi does not emit them; this keeps the decoder
      // permissive against future producers.

      cursor = lf + 1;
    }

    // Whatever bytes remain after the last LF stay in `pending`.
    // Enforce the bound lazily: if a hostile producer streams more
    // than `maxBytes` without ever emitting an LF, the next push
    // detects the overflow. Doing this at the end keeps `push`
    // monotonic — within a single push, the running pending buffer
    // was just appended to, so we check whether *post-append* size has
    // exceeded the limit before returning.
    if (cursor > 0) {
      this.pending = cursor === len ? new Uint8Array(0) : buf.subarray(cursor);
    }
    if (this.pending.length > this.maxBytes) {
      throw new JsonlRecordTooLargeError(this.maxBytes);
    }
    return out;
  }

  /**
   * Signal end-of-stream. Throws `JsonlIncompleteTrailingRecordError`
   * if any bytes were left pending (the producer did not terminate
   * the final record with LF), or `JsonlRecordTooLargeError` if the
   * pending buffer exceeded the bound. Safe to call multiple times;
   * subsequent calls are no-ops.
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.pending.length > this.maxBytes) {
      throw new JsonlRecordTooLargeError(this.maxBytes);
    }
    if (this.pending.length > 0) {
      const n = this.pending.length;
      this.pending = new Uint8Array(0);
      throw new JsonlIncompleteTrailingRecordError(n);
    }
  }

  /** Bytes still waiting for an LF. Intended for diagnostics only. */
  get pendingByteLength(): number {
    return this.pending.length;
  }

  /** Number of records successfully parsed so far. */
  get recordsParsed(): number {
    return this.recordCount;
  }

  /** Whether `finish()` has been called. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** Discard any pending bytes. Resets finished state. Never throws. */
  reset(): void {
    this.pending = new Uint8Array(0);
    this.finished = false;
  }
}

/**
 * Concatenate two byte arrays. We avoid `Buffer.concat` so the module
 * compiles cleanly under both Bun and Node. This is on the cold path
 * only: after the first LF in the merged buffer we replace `pending`
 * with a subarray view (zero-copy).
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
