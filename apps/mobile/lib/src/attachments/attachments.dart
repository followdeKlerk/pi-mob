/// M13 attachment/export/share widgets and coordinator-free data types.
///
/// Mirrors the M10 `controls` module: every widget depends only on immutable
/// view-data + optional callbacks, never on the connection coordinator, the
/// database, or any plugin (including the platform share sheet). The host
/// application supplies a concrete [NativeShareCallback] when it is ready.
library;

export 'attachment_callbacks.dart';
export 'attachment_chip.dart';
export 'attachment_expiry.dart';
export 'attachment_preview.dart';
export 'attachment_surface.dart';
export 'attachment_transport.dart';
export 'attachment_upload_progress.dart';
export 'attachment_view_data.dart';
export 'html_export_progress.dart';
export 'image_attachment_picker.dart';
export 'html_export_share.dart';
export 'html_export_view_data.dart';
export 'share_callback.dart';
