import 'package:cross_file/cross_file.dart';
import 'package:flutter/foundation.dart';
import 'package:share_plus/share_plus.dart' as native;

/// Abstract native share callback surface.
///
/// The M13 implementation explicitly avoids any plugin dependency: the host
/// application forwards [ShareRequest] events to the platform share sheet
/// (or to a stub in tests) and reports results back via the corresponding
/// [ShareResult]. This keeps the widget layer testable and coordinator-free.
@immutable
abstract class NativeShareCallback {
  const NativeShareCallback();

  /// Request that the system present a native share sheet for [share].
  Future<ShareResult> share(ShareRequest share);
}

/// Production native share-sheet adapter. A local downloaded path is required;
/// no public URL is generated or shared.
class PlatformNativeShareCallback implements NativeShareCallback {
  const PlatformNativeShareCallback();

  @override
  Future<ShareResult> share(ShareRequest share) async {
    final path = share.localPath;
    if (path == null || path.isEmpty) {
      return const ShareResult(
        status: ShareStatus.failed,
        error: 'Export has not been downloaded',
      );
    }
    try {
      final result = await native.SharePlus.instance.share(
        native.ShareParams(
          files: <XFile>[
            XFile(path, mimeType: share.mimeType, name: share.fileName),
          ],
          text: share.text,
        ),
      );
      return ShareResult(
        status: result.status == native.ShareResultStatus.success
            ? ShareStatus.completed
            : result.status == native.ShareResultStatus.dismissed
            ? ShareStatus.dismissed
            : ShareStatus.failed,
      );
    } on Object catch (error) {
      return ShareResult(status: ShareStatus.failed, error: error.toString());
    }
  }
}

/// Default no-op callback used by widgets when nothing is wired up.
@immutable
class NoopNativeShareCallback implements NativeShareCallback {
  const NoopNativeShareCallback();

  @override
  Future<ShareResult> share(ShareRequest share) async =>
      const ShareResult(status: ShareStatus.unsupported);
}

/// In-memory share callback suitable for tests. Records requested shares and
/// returns the next configured [ShareStatus].
@visibleForTesting
@immutable
class RecordingNativeShareCallback implements NativeShareCallback {
  RecordingNativeShareCallback({this.responder});

  final List<ShareRequest> requests = <ShareRequest>[];
  final Future<ShareResult> Function(ShareRequest)? responder;

  @override
  Future<ShareResult> share(ShareRequest share) {
    requests.add(share);
    if (responder == null) {
      return Future<ShareResult>.value(
        const ShareResult(status: ShareStatus.completed),
      );
    }
    return responder!(share);
  }
}

/// Request payload forwarded to a [NativeShareCallback].
@immutable
class ShareRequest {
  const ShareRequest({
    required this.exportId,
    required this.fileName,
    required this.mimeType,
    this.byteSize,
    this.localPath,
    this.text,
  });

  final String exportId;
  final String fileName;
  final String mimeType;
  final int? byteSize;
  final String? localPath;
  final String? text;

  Map<String, Object?> toJson() => <String, Object?>{
    'exportId': exportId,
    'fileName': fileName,
    'mimeType': mimeType,
    'byteSize': byteSize,
    'localPath': localPath,
    'hasText': text != null,
  };
}

enum ShareStatus {
  /// User completed the share sheet flow on a destination.
  completed,

  /// User dismissed the share sheet without picking a destination.
  dismissed,

  /// Share sheet reported an unrecoverable error.
  failed,

  /// No platform share surface is wired up (default).
  unsupported,
}

@immutable
class ShareResult {
  const ShareResult({required this.status, this.destination, this.error});

  final ShareStatus status;
  final String? destination;
  final String? error;

  bool get isTerminal =>
      status == ShareStatus.completed ||
      status == ShareStatus.dismissed ||
      status == ShareStatus.unsupported;
}
