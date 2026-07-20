import 'package:flutter/foundation.dart';

/// Coordinator-free callbacks for attachment actions.
///
/// All callbacks are intentionally optional and immutable so widgets can be
/// driven by tests and by the future coordinator integration. None of them
/// reach into the bridge, database, or any plugin — the host application is
/// expected to forward events into authoritative state.
@immutable
class AttachmentCallbacks {
  const AttachmentCallbacks({
    this.onRemove,
    this.onReplace,
    this.onRetry,
    this.onPreviewTap,
  });

  /// Request removal of the attachment chip from the composer.
  final void Function(String attachmentId)? onRemove;

  /// Request replacing the attachment (picker re-opened, draft preserved).
  final void Function(String attachmentId)? onReplace;

  /// Request a retry of an upload that previously failed.
  final void Function(String attachmentId)? onRetry;

  /// Request opening a full-screen preview of the attachment.
  final void Function(String attachmentId)? onPreviewTap;

  bool get hasAny =>
      onRemove != null ||
      onReplace != null ||
      onRetry != null ||
      onPreviewTap != null;
}

/// Whether an action is disabled without surfacing a reason. Mirror of the
/// retry-controls convention so widgets stay coordinator-free.
@immutable
class AttachmentActionGate {
  const AttachmentActionGate({
    this.remove = false,
    this.replace = false,
    this.retry = false,
    this.preview = false,
    this.reason,
  });

  final bool remove;
  final bool replace;
  final bool retry;
  final bool preview;
  final String? reason;

  bool allows(AttachmentAction action) => switch (action) {
    AttachmentAction.remove => !remove,
    AttachmentAction.replace => !replace,
    AttachmentAction.retry => !retry,
    AttachmentAction.preview => !preview,
  };
}

enum AttachmentAction { remove, replace, retry, preview }
