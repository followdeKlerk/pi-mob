import 'package:flutter/foundation.dart';

const maxWorkspaceTreeItems = 200;
const maxFilenameMatches = 100;
const maxContentMatches = 200;
const maxFileReadLines = 2000;
const maxFileReferenceRanges = 16;

@immutable
class FileLineRange {
  const FileLineRange(this.startLine, this.endLine)
    : assert(startLine >= 1), assert(endLine >= startLine);
  final int startLine;
  final int endLine;

  Map<String, Object> toJson() => {'startLine': startLine, 'endLine': endLine};
}

@immutable
class WorkspaceFileReference {
  const WorkspaceFileReference({
    required this.workspaceId,
    required this.path,
    required this.digest,
    required this.revision,
    this.ranges = const [],
  });
  final String workspaceId;
  final String path;
  final String digest;
  final String revision;
  final List<FileLineRange> ranges;

  Map<String, Object> toJson() => {
    'workspaceId': workspaceId,
    'path': path,
    'digest': digest,
    'revision': revision,
    if (ranges.isNotEmpty) 'ranges': ranges.map((range) => range.toJson()).toList(),
  };
}

enum WorkspaceFileKind { file, directory }

@immutable
class WorkspaceFileNode {
  const WorkspaceFileNode({required this.path, required this.kind, required this.depth, this.modified = false, this.isBinary = false});
  final String path;
  final WorkspaceFileKind kind;
  final int depth;
  final bool modified;
  final bool isBinary;
}

@immutable
class WorkspaceContentMatch {
  const WorkspaceContentMatch({required this.path, required this.line, required this.lineText});
  final String path;
  final int line;
  final String lineText;
}

@immutable
class WorkspaceFileDocument {
  const WorkspaceFileDocument({required this.path, required this.revision, required this.digest, required this.rangeStart, required this.totalLines, required this.lines, this.languageHint, this.isTruncated = false, this.stale = false});
  final String path;
  final String revision;
  final String digest;
  final int rangeStart;
  final int totalLines;
  final List<String> lines;
  final String? languageHint;
  final bool isTruncated;
  final bool stale;

  FileLineRange? selection(int? start, int? end) => start == null || end == null ? null : FileLineRange(start < end ? start : end, start < end ? end : start);
}

enum FileBrowserState { loading, ready, unavailable, failed }
enum FileBrowserMode { tree, filenameSearch, contentSearch, read }

/// Coordinator-independent, bounded projection. No method here mutates host
/// context or sends a prompt.
@immutable
class FileBrowserViewData {
  const FileBrowserViewData({
    required this.workspaceId,
    this.state = FileBrowserState.ready,
    this.mode = FileBrowserMode.tree,
    this.nodes = const [],
    this.filenameMatches = const [],
    this.contentMatches = const [],
    this.recents = const [],
    this.document,
    this.nextPageToken,
    this.message,
    this.selectedStart,
    this.selectedEnd,
  });
  final String workspaceId;
  final FileBrowserState state;
  final FileBrowserMode mode;
  final List<WorkspaceFileNode> nodes;
  final List<String> filenameMatches;
  final List<WorkspaceContentMatch> contentMatches;
  final List<String> recents;
  final WorkspaceFileDocument? document;
  final String? nextPageToken;
  final String? message;
  final int? selectedStart;
  final int? selectedEnd;

  WorkspaceFileReference? get selectedReference {
    final value = document;
    if (value == null || value.stale || value.digest.length != 64) return null;
    final range = value.selection(selectedStart, selectedEnd);
    return WorkspaceFileReference(workspaceId: workspaceId, path: value.path, digest: value.digest, revision: value.revision, ranges: range == null ? const [] : [range]);
  }
}

typedef FilePathCallback = void Function(String path);
typedef FileSearchCallback = void Function(String query, bool content);
typedef FileReferenceCallback = void Function(WorkspaceFileReference reference);

@immutable
class FileBrowserCallbacks {
  const FileBrowserCallbacks({this.onOpen, this.onSearch, this.onLoadMore, this.onRefresh, this.onSelectLine, this.onCopyPath, this.onCopyText, this.onInsertReference, this.onPrepareAttachment});
  final FilePathCallback? onOpen;
  final FileSearchCallback? onSearch;
  final VoidCallback? onLoadMore;
  final VoidCallback? onRefresh;
  final void Function(int line, bool extend)? onSelectLine;
  final FilePathCallback? onCopyPath;
  final void Function(String text)? onCopyText;
  /// Adds a revision-bound textual reference to composer draft state only.
  final FileReferenceCallback? onInsertReference;
  /// Prepares attachment draft state only; it must never dispatch a prompt.
  final FileReferenceCallback? onPrepareAttachment;
}
