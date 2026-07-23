import 'package:flutter/foundation.dart';

/// Lifecycle state of a single HTML export operation.
enum HtmlExportPhase {
  idle,
  preparing,
  rendering,
  uploading,
  downloading,
  completed,
  failed,
  cancelled,
}

/// Opaque view-data describing a host-side HTML export.
///
/// The mobile widget layer only knows the export through this immutable
/// snapshot — it never speaks to the bridge or database directly.
@immutable
class HtmlExportViewData {
  const HtmlExportViewData({
    required this.phase,
    this.exportId,
    this.fileName,
    this.mimeType = 'text/html',
    this.byteSize,
    this.downloadedBytes = 0,
    this.progressFraction,
    this.downloadPath,
    this.shareAvailable = false,
    this.failureMessage,
    this.expiresAt,
    this.cancellable = true,
  });

  final HtmlExportPhase phase;
  final String? exportId;
  final String? fileName;
  final String mimeType;
  final int? byteSize;
  final int downloadedBytes;
  final double? progressFraction;
  final String? downloadPath;
  final bool shareAvailable;
  final String? failureMessage;
  final DateTime? expiresAt;
  final bool cancellable;

  factory HtmlExportViewData.idle() =>
      const HtmlExportViewData(phase: HtmlExportPhase.idle);

  HtmlExportViewData copyWith({
    HtmlExportPhase? phase,
    String? exportId,
    String? fileName,
    int? byteSize,
    int? downloadedBytes,
    double? progressFraction,
    String? downloadPath,
    bool? shareAvailable,
    String? failureMessage,
    DateTime? expiresAt,
    bool? cancellable,
    bool clearFailure = false,
  }) => HtmlExportViewData(
    phase: phase ?? this.phase,
    exportId: exportId ?? this.exportId,
    fileName: fileName ?? this.fileName,
    mimeType: mimeType,
    byteSize: byteSize ?? this.byteSize,
    downloadedBytes: downloadedBytes ?? this.downloadedBytes,
    progressFraction: progressFraction ?? this.progressFraction,
    downloadPath: downloadPath ?? this.downloadPath,
    shareAvailable: shareAvailable ?? this.shareAvailable,
    failureMessage: clearFailure
        ? null
        : (failureMessage ?? this.failureMessage),
    expiresAt: expiresAt ?? this.expiresAt,
    cancellable: cancellable ?? this.cancellable,
  );

  bool get isTerminal =>
      phase == HtmlExportPhase.completed ||
      phase == HtmlExportPhase.failed ||
      phase == HtmlExportPhase.cancelled ||
      phase == HtmlExportPhase.idle;

  bool get hasExport =>
      exportId != null &&
      (phase == HtmlExportPhase.completed || downloadPath != null);
}

@immutable
class HtmlExportCallbacks {
  const HtmlExportCallbacks({
    this.onStart,
    this.onCancel,
    this.onRetry,
    this.onShare,
    this.onExpireAcknowledged,
  });

  final VoidCallback? onStart;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;
  final VoidCallback? onShare;
  final VoidCallback? onExpireAcknowledged;

  bool get hasAny =>
      onStart != null ||
      onCancel != null ||
      onRetry != null ||
      onShare != null ||
      onExpireAcknowledged != null;
}
