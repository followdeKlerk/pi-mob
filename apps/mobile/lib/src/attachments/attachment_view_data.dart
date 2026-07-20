import 'package:flutter/foundation.dart';

/// Coarse attachment classification derived from picker output.
///
/// The mobile client never trusts host metadata; the chip surfaces a
/// human-readable [AttachmentKind] alongside immutable backing bytes.
enum AttachmentKind { imageJpeg, imagePng, unknownImage, genericFile }

AttachmentKind attachmentKindFromMime(String? mime) {
  if (mime != null &&
      mime.startsWith('image/') &&
      mime != 'image/jpeg' &&
      mime != 'image/png') {
    return AttachmentKind.unknownImage;
  }
  switch (mime) {
    case 'image/jpeg':
      return AttachmentKind.imageJpeg;
    case 'image/png':
      return AttachmentKind.imagePng;
    case 'image/':
      return AttachmentKind.unknownImage;
    default:
      return AttachmentKind.genericFile;
  }
}

String attachmentKindLabel(AttachmentKind kind) => switch (kind) {
  AttachmentKind.imageJpeg => 'JPEG image',
  AttachmentKind.imagePng => 'PNG image',
  AttachmentKind.unknownImage => 'Image',
  AttachmentKind.genericFile => 'Attachment',
};

/// Lifecycle state of a single attachment from picker selection through
/// dispatch. State transitions are driven by host-validated updates only —
/// widgets never invent transitions themselves.
enum AttachmentPhase {
  selected,
  uploading,
  uploaded,
  failed,
  retrying,
  expired,
  removed,
}

/// Bounded, immutable view-data for an attachment chip.
@immutable
class AttachmentViewData {
  const AttachmentViewData({
    required this.id,
    required this.kind,
    required this.fileName,
    required this.byteSize,
    required this.phase,
    this.dimensions,
    this.digest,
    this.uploadedBytes = 0,
    this.progressFraction,
    this.failureMessage,
    this.uploadedStorageId,
    this.expiresAt,
    this.removed = false,
  });

  final String id;
  final AttachmentKind kind;
  final String fileName;
  final int byteSize;
  final AttachmentPhase phase;
  final AttachmentDimensions? dimensions;
  final String? digest;
  final int uploadedBytes;
  final double? progressFraction;
  final String? failureMessage;
  final String? uploadedStorageId;
  final DateTime? expiresAt;
  final bool removed;

  factory AttachmentViewData.selected({
    required String id,
    required AttachmentKind kind,
    required String fileName,
    required int byteSize,
    AttachmentDimensions? dimensions,
  }) => AttachmentViewData(
    id: id,
    kind: kind,
    fileName: fileName,
    byteSize: byteSize,
    phase: AttachmentPhase.selected,
    dimensions: dimensions,
  );

  AttachmentViewData copyWith({
    AttachmentPhase? phase,
    int? uploadedBytes,
    double? progressFraction,
    String? failureMessage,
    String? uploadedStorageId,
    DateTime? expiresAt,
    bool? removed,
    bool clearFailure = false,
  }) => AttachmentViewData(
    id: id,
    kind: kind,
    fileName: fileName,
    byteSize: byteSize,
    dimensions: dimensions,
    digest: digest,
    phase: phase ?? this.phase,
    uploadedBytes: uploadedBytes ?? this.uploadedBytes,
    progressFraction: progressFraction ?? this.progressFraction,
    failureMessage: clearFailure
        ? null
        : (failureMessage ?? this.failureMessage),
    uploadedStorageId: uploadedStorageId ?? this.uploadedStorageId,
    expiresAt: expiresAt ?? this.expiresAt,
    removed: removed ?? this.removed,
  );

  bool get isTerminal =>
      phase == AttachmentPhase.uploaded ||
      phase == AttachmentPhase.expired ||
      phase == AttachmentPhase.removed;
}

@immutable
class AttachmentDimensions {
  const AttachmentDimensions(this.width, this.height);
  final int width;
  final int height;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AttachmentDimensions &&
          other.width == width &&
          other.height == height);

  @override
  int get hashCode => Object.hash(width, height);

  @override
  String toString() => '${width}x$height';
}

/// Bounded view-data for the entire composer attachment surface.
@immutable
class AttachmentSurfaceData {
  const AttachmentSurfaceData({
    required this.attachments,
    this.maxAttachmentCount = 4,
    this.maxAttachmentBytes = 8 * 1024 * 1024,
    this.unavailableReason,
  });

  final List<AttachmentViewData> attachments;
  final int maxAttachmentCount;
  final int maxAttachmentBytes;
  final String? unavailableReason;

  bool get isFull => attachments.length >= maxAttachmentCount;

  int get liveAttachmentCount =>
      attachments.where((a) => a.phase != AttachmentPhase.removed).length;

  Iterable<AttachmentViewData> get visible =>
      attachments.where((a) => a.phase != AttachmentPhase.removed);
}
