/**
 * Pairing QR payload encoding.
 *
 * The pairing payload is the host discovery metadata the mobile app scans
 * from the CLI/Pi-extension QR. It is intentionally non-secret: the QR
 * grants no access outside the tailnet, and the bridge has no per-device
 * pairing secret for MVP. The QR is the recovery flow on first install,
 * deliberate forget/unpair, or endpoint change; subsequent reconnects use
 * the stored endpoint and never rescan.
 *
 * Payload shape (canonical):
 *
 *   {
 *     "kind": "pi-mob-host",
 *     "version": 1,
 *     "hostId": "<uuid>",
 *     "displayName": "<owner-chosen short name>",
 *     "endpoint": "https://<node>.tailnet.ts.net",
 *     "protocolMajor": 1
 *   }
 *
 * Rules enforced here:
 *
 *   - `kind` is always the literal `pi-mob-host`. A different kind is
 *     rejected because mobile would not recognise it as a host payload.
 *   - `version` is `1`. Future migrations reserve the major version for
 *     breaking shape changes; the bridge refuses unknown majors.
 *   - `protocolMajor` is `1` and must match the bridge's runtime protocol
 *     major; mismatches are fatal during handshake regardless.
 *   - `endpoint` is run through {@link validateBridgeEndpoint} so Funnel,
 *     loopback, plain HTTP, wildcard, and LAN hosts are refused at payload
 *     build time, not at scan time.
 *   - The display name is trimmed and length-capped; newlines and control
 *     characters are stripped so the QR text never confuses a scanner.
 *
 * QR encoding:
 *
 *   The {@link QrEncoderPort} abstraction wraps a standards-compliant QR
 *   generator (the production implementation wraps the `qrcode` npm
 *   package, which produces ISO/IEC 18004-compliant symbols at a chosen
 *   error-correction level). Tests can inject a stub encoder so QR output
 *   does not have to be re-decoded on every assertion.
 *
 *   The CLI emits the canonical JSON inside a real QR code with
 *   error-correction level `M` (the standard mid-tier, tolerant of
 *   physical damage but compact). The terminal renderer uses the
 *   `qrcode` package's `type: 'terminal'` output, which paints dark
 *   modules with ANSI background colours so the QR is recognisably a QR
 *   code in operator terminals.
 *
 *   The matrix export ({@link renderPairingMatrix}) returns the raw
 *   module grid as a `boolean[][]` so any caller can render to SVG, PNG,
 *   thermal-printer dot grids, or other transport. The renderer is
 *   invertible so a dark-on-light output can be flipped for dark-mode
 *   terminals.
 */

import QRCode from "qrcode";

import { assertValidHostId, validateBridgeEndpoint } from "./endpoint-guard";

/** Stable identifier for the pairing payload kind. */
export const PAIRING_PAYLOAD_KIND = "pi-mob-host";

/** Schema version. Always `1`; major bumps break the QR shape. */
export const PAIRING_PAYLOAD_VERSION = 1 as const;

/** Bridge protocol major version this payload advertises. */
export const PAIRING_PROTOCOL_MAJOR = 1 as const;

/** Error-correction level used for the production pairing QR. */
export const PAIRING_QR_ERROR_CORRECTION = "M" as const;

/** Parsed pairing payload returned by {@link parsePairingPayload}. */
export interface PairingPayload {
  readonly kind: typeof PAIRING_PAYLOAD_KIND;
  readonly version: typeof PAIRING_PAYLOAD_VERSION;
  readonly hostId: string;
  readonly displayName: string;
  readonly endpoint: string;
  readonly protocolMajor: typeof PAIRING_PROTOCOL_MAJOR;
}

/** Inputs accepted by {@link buildPairingPayload}. */
export interface BuildPairingPayloadInput {
  readonly hostId: string;
  readonly displayName: string;
  readonly endpoint: string;
}

/** Options accepted by {@link renderPairingTerminal} / {@link renderPairingMatrix}. */
export interface RenderPairingTerminalOptions {
  /**
   * Deprecated hint. Real QR codes have an intrinsic size derived from the
   * payload length and the error-correction level; the encoder ignores
   * this value. Retained so existing callers that pass a `modules` flag do
   * not have to be changed; values outside 21..33 are still rejected to
   * preserve the original validation contract.
   */
  readonly modules?: number;
  /** Border ("quiet zone") width in modules. Defaults to 2. */
  readonly quietZone?: number;
  /** Inverted rendering; defaults to false (dark on light). */
  readonly invert?: boolean;
}

/** Thrown when a pairing payload fails structural validation. */
export class PairingPayloadError extends Error {
  override readonly name: string = "PairingPayloadError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Raw QR matrix data returned by the encoder. `true` means a dark module. */
export type QrMatrix = boolean[][];

/**
 * Injected QR encoder. Production wiring uses {@link RealQrEncoder}; tests
 * can substitute a deterministic stub so assertions do not have to re-decode
 * the rendered output.
 */
export interface QrEncoderPort {
  /** Render the payload's canonical JSON to a terminal-friendly QR string. */
  renderTerminal(canonical: string, options: { readonly invert: boolean }): string;
  /** Render the payload's canonical JSON to an SVG string. */
  renderSvg(canonical: string): string;
  /** Return the raw module grid for the payload. `true` is a dark module. */
  renderMatrix(canonical: string): { readonly size: number; readonly matrix: QrMatrix };
  /** Error-correction level advertised by the encoder. */
  readonly errorCorrectionLevel: typeof PAIRING_QR_ERROR_CORRECTION;
}

/**
 * Production {@link QrEncoderPort} backed by the `qrcode` npm package. The
 * package is ISO/IEC 18004-compliant and supports all four standard error
 * correction levels (L, M, Q, H). The bridge uses level `M` (mid-tier),
 * which corrects up to ~15% damage and keeps the symbol compact enough to
 * fit easily inside an operator terminal or a phone camera viewport.
 */
export class RealQrEncoder implements QrEncoderPort {
  readonly errorCorrectionLevel: typeof PAIRING_QR_ERROR_CORRECTION = PAIRING_QR_ERROR_CORRECTION;

  renderTerminal(canonical: string, options: { readonly invert: boolean }): string {
    const matrix = this.renderMatrix(canonical);
    return matrixToTerminal(matrix.matrix, matrix.size, options.invert);
  }

  renderSvg(canonical: string): string {
    const { matrix, size } = this.renderMatrix(canonical);
    return matrixToSvg(matrix, size);
  }

  renderMatrix(canonical: string): { readonly size: number; readonly matrix: QrMatrix } {
    const qr = QRCode.create(canonical, {
      errorCorrectionLevel: this.errorCorrectionLevel,
    });
    return {
      size: qr.modules.size,
      matrix: bitMatrixTo2d(qr.modules.data, qr.modules.size),
    };
  }
}

function bitMatrixTo2d(data: Uint8Array, size: number): QrMatrix {
  const out: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) {
      const bit = data[y * size + x];
      row.push(bit === 1);
    }
    out.push(row);
  }
  return out;
}

/**
 * Renders a `boolean[][]` QR matrix to a self-contained SVG document. The
 * SVG is rendered synchronously from the matrix, so callers do not need to
 * await any Promise. A white background rectangle is always emitted so the
 * symbol prints correctly on light surfaces.
 */
function matrixToSvg(matrix: QrMatrix, size: number): string {
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
  );
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y]![x]) {
        parts.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#000000"/>`);
      }
    }
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Module-level encoder. Tests may override this through
 * {@link setQrEncoder}; the default is {@link RealQrEncoder}.
 */
let activeEncoder: QrEncoderPort = new RealQrEncoder();

/** Returns the active {@link QrEncoderPort}. */
export function getQrEncoder(): QrEncoderPort {
  return activeEncoder;
}

/**
 * Replaces the active encoder. Production callers should never need this;
 * tests use it to substitute a deterministic stub. Passing `null` restores
 * the real encoder.
 */
export function setQrEncoder(encoder: QrEncoderPort | null): void {
  activeEncoder = encoder ?? new RealQrEncoder();
}

/**
 * Builds a typed pairing payload from raw inputs. Throws on validation
 * failure; the returned object is safe to serialise directly to JSON.
 */
export function buildPairingPayload(input: BuildPairingPayloadInput): PairingPayload {
  assertValidHostId(input.hostId);
  const displayName = normaliseDisplayName(input.displayName);
  const endpoint = validateBridgeEndpoint(input.endpoint).origin;
  return {
    kind: PAIRING_PAYLOAD_KIND,
    version: PAIRING_PAYLOAD_VERSION,
    hostId: input.hostId,
    displayName,
    endpoint,
    protocolMajor: PAIRING_PROTOCOL_MAJOR,
  };
}

/**
 * Serialises a payload to canonical JSON (sorted keys, no whitespace, UTF-8).
 * Two payloads with identical fields always produce identical output.
 */
export function formatPairingPayload(payload: PairingPayload): string {
  return canonicalJsonStringify(payload);
}

/**
 * Parses and validates a previously serialised payload. The shape, kind,
 * version, and protocol major are all checked. The endpoint is re-validated
 * through {@link validateBridgeEndpoint} so a tampered payload can never
 * smuggle a Funnel / loopback / wildcard origin.
 */
export function parsePairingPayload(text: string): PairingPayload {
  if (typeof text !== "string") {
    throw new PairingPayloadError("syntax", "pairing payload must be a string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PairingPayloadError("syntax", `pairing payload is not valid JSON: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new PairingPayloadError("syntax", "pairing payload must be an object");
  }
  if (parsed.kind !== PAIRING_PAYLOAD_KIND) {
    throw new PairingPayloadError(
      "kind",
      `pairing payload kind must be ${JSON.stringify(PAIRING_PAYLOAD_KIND)} (got ${JSON.stringify(parsed.kind)})`,
    );
  }
  if (parsed.version !== PAIRING_PAYLOAD_VERSION) {
    throw new PairingPayloadError(
      "version",
      `pairing payload version must be ${PAIRING_PAYLOAD_VERSION} (got ${JSON.stringify(parsed.version)})`,
    );
  }
  if (parsed.protocolMajor !== PAIRING_PROTOCOL_MAJOR) {
    throw new PairingPayloadError(
      "protocol_major",
      `pairing protocolMajor must be ${PAIRING_PROTOCOL_MAJOR} (got ${JSON.stringify(parsed.protocolMajor)})`,
    );
  }
  if (typeof parsed.hostId !== "string") {
    throw new PairingPayloadError("host_id", "pairing hostId must be a string");
  }
  if (typeof parsed.displayName !== "string") {
    throw new PairingPayloadError("display_name", "pairing displayName must be a string");
  }
  if (typeof parsed.endpoint !== "string") {
    throw new PairingPayloadError("endpoint", "pairing endpoint must be a string");
  }
  assertValidHostId(parsed.hostId);
  const displayName = normaliseDisplayName(parsed.displayName);
  const endpoint = validateBridgeEndpoint(parsed.endpoint).origin;
  return {
    kind: PAIRING_PAYLOAD_KIND,
    version: PAIRING_PAYLOAD_VERSION,
    hostId: parsed.hostId,
    displayName,
    endpoint,
    protocolMajor: PAIRING_PROTOCOL_MAJOR,
  };
}

/**
 * Builds the payload and returns its canonical JSON in one step. Equivalent
 * to `formatPairingPayload(buildPairingPayload(input))`.
 */
export function encodePairingPayload(input: BuildPairingPayloadInput): string {
  return formatPairingPayload(buildPairingPayload(input));
}

/**
 * Validates the {@link RenderPairingTerminalOptions} shape. The check is
 * independent of the encoder so callers always see a uniform error code.
 */
function validateRenderOptions(options: RenderPairingTerminalOptions): {
  readonly modules: number;
  readonly quietZone: number;
  readonly invert: boolean;
} {
  const modules = options.modules ?? 21;
  const quietZone = options.quietZone ?? 2;
  const invert = options.invert ?? false;
  if (!Number.isInteger(modules) || modules < 21 || modules > 33) {
    throw new PairingPayloadError("modules", `modules must be an integer in 21..33 (got ${modules})`);
  }
  if (!Number.isInteger(quietZone) || quietZone < 0 || quietZone > 4) {
    throw new PairingPayloadError("quiet_zone", `quietZone must be an integer in 0..4 (got ${quietZone})`);
  }
  return { modules, quietZone, invert };
}

/**
 * Renders the payload's canonical JSON as a real, scannable QR code in a
 * terminal-friendly block-character grid. The output uses ANSI background
 * colours for dark modules (so it is recognisably a QR code in operator
 * terminals). The terminal context itself provides the quiet zone, so the
 * `quietZone` option validates input but does not pad the rendered string.
 *
 * The render is pure with respect to the payload: identical inputs always
 * produce identical output for a given encoder. The encoder is injectable
 * through {@link setQrEncoder} so tests can stub the QR generator.
 */
export function renderPairingTerminal(
  payload: PairingPayload,
  options: RenderPairingTerminalOptions = {},
  encoder: QrEncoderPort = activeEncoder,
): string {
  const { quietZone: _quietZone, invert } = validateRenderOptions(options);
  void _quietZone;
  const canonical = formatPairingPayload(payload);
  return encoder.renderTerminal(canonical, { invert });
}

/**
 * Returns the raw module grid for the payload. Useful when callers want to
 * drive their own renderer (SVG, PNG, thermal printer) instead of the
 * built-in terminal grid. The grid is square and `true` indicates a dark
 * module.
 */
export function renderPairingMatrix(
  payload: PairingPayload,
  options: RenderPairingTerminalOptions = {},
  encoder: QrEncoderPort = activeEncoder,
): QrMatrix {
  const { quietZone, invert } = validateRenderOptions(options);
  const canonical = formatPairingPayload(payload);
  const { matrix, size } = encoder.renderMatrix(canonical);
  const padded = padMatrixWithQuietZone(matrix, size, quietZone);
  if (invert) {
    return padded.map((row) => row.map((cell) => !cell));
  }
  return padded;
}

/**
 * Returns the payload rendered as an SVG QR code. The renderer is suitable
 * for embedding in HTML; the SVG is self-contained and does not require
 * external style sheets.
 */
export function renderPairingSvg(
  payload: PairingPayload,
  encoder: QrEncoderPort = activeEncoder,
): string {
  const canonical = formatPairingPayload(payload);
  return encoder.renderSvg(canonical);
}

function padMatrixWithQuietZone(matrix: QrMatrix, size: number, quietZone: number): QrMatrix {
  if (quietZone === 0) return matrix;
  const total = size + quietZone * 2;
  const out: boolean[][] = [];
  for (let y = 0; y < total; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < total; x += 1) {
      const inQuiet =
        x < quietZone ||
        y < quietZone ||
        x >= quietZone + size ||
        y >= quietZone + size;
      if (inQuiet) {
        row.push(false);
        continue;
      }
      row.push(matrix[y - quietZone]![x - quietZone]!);
    }
    out.push(row);
  }
  return out;
}

/**
 * Renders a `boolean[][]` QR matrix to a Unicode block-character grid
 * suitable for operator terminals. Dark modules are rendered with the
 * Unicode full-block character and an ANSI background-colour escape; light
 * modules use a non-breaking space and a reset escape. The renderer is
 * deterministic and does not depend on `console.*`.
 */
function matrixToTerminal(matrix: QrMatrix, size: number, invert: boolean): string {
  const darkBg = invert ? "\u001b[40m" : "\u001b[47m"; // black when inverted, white otherwise
  const lightBg = invert ? "\u001b[47m" : "\u001b[40m"; // white when inverted, black otherwise
  const reset = "\u001b[0m";
  const lines: string[] = [];
  for (let y = 0; y < size; y += 1) {
    let line = "";
    for (let x = 0; x < size; x += 1) {
      const isDark = matrix[y]![x] === true;
      line += isDark ? `${darkBg}  ${reset}` : `${lightBg}  ${reset}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Trims, length-caps, and strips control characters from a display name. */
export function normaliseDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new PairingPayloadError("display_name", `displayName must be a string (got ${JSON.stringify(value)})`);
  }
  let trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PairingPayloadError("display_name", "displayName must not be empty");
  }
  trimmed = stripControlCharacters(trimmed);
  if (trimmed.length === 0) {
    throw new PairingPayloadError("display_name", "displayName must not be only control characters");
  }
  if (trimmed.length > 64) {
    throw new PairingPayloadError("display_name", `displayName length ${trimmed.length} exceeds 64`);
  }
  return trimmed;
}

function stripControlCharacters(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue;
    out += value[i]!;
  }
  return out;
}

function canonicalJsonStringify(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new PairingPayloadError("syntax", "payload must be an object");
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key];
    parts.push(`${JSON.stringify(key)}:${canonicalValue(v)}`);
  }
  return `{${parts.join(",")}}`;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PairingPayloadError("syntax", "canonical number must be finite");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalValue(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${canonicalValue((value as Record<string, unknown>)[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new PairingPayloadError("syntax", `unsupported canonical value: ${typeof value}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
