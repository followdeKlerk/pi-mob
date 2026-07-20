import 'dart:convert';

import '../widgets/view_data/tool_call_view_data.dart';

/// Domain-facing wrapper around the view-data [ToolOutputTruncation].
///
/// The domain layer must never expose [ToolOutputTruncation] directly: the
/// widget layer may evolve independently, and the reducer needs an
/// immutable value with stable equality and a JSON form that is safe to
/// round-trip through diagnostic buffers. The wrapper also re-validates
/// byte counts at the boundary so the reducer can surface parse failures
/// early instead of handing nonsensical values to widgets.
class TranscriptTruncation {
  const TranscriptTruncation({
    required this.retainedBytes,
    required this.totalBytes,
    this.digest,
  });

  /// Strict parser for protocol payloads. Throws [FormatException] on
  /// malformed input so the reducer can downgrade the failure to a
  /// bounded diagnostic rather than silently render a card with a missing
  /// size pill.
  factory TranscriptTruncation.fromMap(Map<String, Object?> map) {
    final retained = map['retainedBytes'];
    final total = map['totalBytes'];
    if (retained is! int) {
      throw const FormatException(
        'transcript truncation requires int `retainedBytes`',
      );
    }
    if (total is! int) {
      throw const FormatException(
        'transcript truncation requires int `totalBytes`',
      );
    }
    if (retained < 0 || total < retained) {
      throw const FormatException(
        'transcript truncation requires 0 <= retained <= total',
      );
    }
    final digest = map['digest'];
    if (digest != null && digest is! String) {
      throw const FormatException(
        'transcript truncation `digest` must be a string',
      );
    }
    return TranscriptTruncation(
      retainedBytes: retained,
      totalBytes: total,
      digest: digest as String?,
    );
  }

  /// Adapter from the widget layer. Used when the reducer lowers a tool
  /// event into a [ToolCallViewData] that already carries a
  /// [ToolOutputTruncation].
  factory TranscriptTruncation.fromViewData(ToolOutputTruncation view) =>
      TranscriptTruncation(
        retainedBytes: view.retainedBytes,
        totalBytes: view.totalBytes,
        digest: view.digest,
      );

  /// Bridge-reported bytes retained in the cached result. Always
  /// non-negative.
  final int retainedBytes;

  /// Bytes the host originally produced before truncation. Always
  /// greater than or equal to [retainedBytes].
  final int totalBytes;

  /// Optional SHA-256 digest of the full original payload.
  final String? digest;

  /// Lower into the widget layer.
  ToolOutputTruncation toViewData() => ToolOutputTruncation(
    retainedBytes: retainedBytes,
    totalBytes: totalBytes,
    digest: digest,
  );

  /// True when the host dropped at least one byte.
  bool get isTruncated => retainedBytes < totalBytes;

  /// Ratio retained versus total. Bounded to `[0, 1]`. Returns 1 when the
  /// host reported the same number for both, including the zero case.
  double get retentionRatio {
    if (totalBytes == 0) return 1;
    final ratio = retainedBytes / totalBytes;
    if (ratio.isNaN) return 1;
    if (ratio < 0) return 0;
    if (ratio > 1) return 1;
    return ratio;
  }

  Map<String, Object?> toJson() => {
    'retainedBytes': retainedBytes,
    'totalBytes': totalBytes,
    if (digest != null) 'digest': digest,
  };

  String get encodedJson => jsonEncode(toJson());

  @override
  bool operator ==(Object other) =>
      other is TranscriptTruncation &&
      other.retainedBytes == retainedBytes &&
      other.totalBytes == totalBytes &&
      other.digest == digest;

  @override
  int get hashCode => Object.hash(retainedBytes, totalBytes, digest);

  @override
  String toString() => 'TranscriptTruncation($retainedBytes/$totalBytes bytes)';
}
