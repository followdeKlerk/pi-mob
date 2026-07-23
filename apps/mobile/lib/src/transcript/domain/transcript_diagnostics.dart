import 'dart:convert';

/// Maximum size, in bytes, that an unknown diagnostic payload may occupy
/// once serialized. The reducer truncates anything above this threshold so
/// the UI never attempts to render an unbounded blob. Four KiB is enough
/// for any plausible diagnostic preview while staying within the mobile
/// transcript's per-row paint budget.
const int kTranscriptDiagnosticByteCap = 4096;

/// Maximum number of unknown diagnostics kept on a single transcript. Older
/// entries are evicted FIFO once the cap is hit. This bounds memory and
/// keeps the diagnostic surface responsive in long sessions, where many
/// additive optional events may accumulate.
const int kTranscriptDiagnosticCountCap = 64;

/// Severity classification surfaced alongside an unknown diagnostic.
///
/// The reducer picks the severity based on how the event was absorbed:
///
/// * [info]    - an additive optional event the bridge tolerated but the
///               mobile UI does not have a presentation for.
/// * [warning] - the bridge lowered a malformed payload; the user can still
///               use the transcript, but the missing field will never be
///               recovered.
/// * [error]   - a protocol-integrity issue that the reducer swallowed; the
///               bridge may need to be updated or the session reconnected.
enum TranscriptDiagnosticSeverity { info, warning, error }

/// One unknown or malformed thing the reducer had to absorb. Diagnostics are
/// intentionally bounded: they expose a short label, an optional truncated
/// JSON preview, and a stable key. The widget can render them in a fold-out
/// drawer without risking layout overflow.
class TranscriptDiagnostic {
  const TranscriptDiagnostic({
    required this.key,
    required this.severity,
    required this.label,
    required this.detail,
    this.previewJson,
    this.occurredAt,
  });

  /// Stable widget key. Derived from the originating cursor or content
  /// block id so the same diagnostic keeps its row across rebuilds.
  final String key;

  final TranscriptDiagnosticSeverity severity;

  /// Short, stable identifier such as `unknown_event` or `tool_parse_error`.
  /// The widget uses this label as the diagnostic's accessible name.
  final String label;

  /// One-sentence explanation suitable for an inspection sheet.
  final String detail;

  /// Optional truncated JSON preview. Capped at
  /// [kTranscriptDiagnosticByteCap] by the reducer; the UI must never
  /// assume it is the full payload.
  final String? previewJson;

  /// Optional timestamp. Populated from the originating event when known.
  final DateTime? occurredAt;

  bool get hasPreview => previewJson != null && previewJson!.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      other is TranscriptDiagnostic &&
      other.key == key &&
      other.severity == severity &&
      other.label == label &&
      other.detail == detail &&
      other.previewJson == previewJson &&
      other.occurredAt == occurredAt;

  @override
  int get hashCode =>
      Object.hash(key, severity, label, detail, previewJson, occurredAt);

  @override
  String toString() =>
      'TranscriptDiagnostic($severity, label=$label, key=$key)';
}

/// Truncates an arbitrary JSON payload to at most [kTranscriptDiagnosticByteCap]
/// bytes. The result is always valid JSON: when truncation occurs the payload
/// is shortened until re-encoding fits, with a trailing `..."` marker so the
/// user can see the preview was clipped.
String truncateDiagnosticJson(Object? payload) {
  if (payload == null) return '';
  String encoded;
  try {
    encoded = jsonEncode(payload);
  } on JsonUnsupportedObjectError {
    return '';
  } on FormatException {
    return '';
  }
  if (encoded.length <= kTranscriptDiagnosticByteCap) return encoded;
  // Reserve room for the truncation marker.
  const marker = '..."<truncated>';
  final budget = kTranscriptDiagnosticByteCap - marker.length;
  if (budget <= 0) return marker;
  return '${encoded.substring(0, budget)}$marker';
}
