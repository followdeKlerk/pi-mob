/// View-data types for a single tool call.
///
/// The mobile transcript renders a stream of turns. Each turn may contain zero
/// or more tool calls, zero or one reasoning block, and zero or one final
/// answer. The transcript widgets are intentionally decoupled from the
/// protocol-domain types so the same widgets can be exercised by tests
/// without spinning up a coordinator, and so the domain can evolve without
/// invalidating the presentation layer.
///
/// All view-data here is **immutable**. Once constructed, a [ToolCallViewData]
/// cannot change. New state replaces the old value, which keeps widget
/// `==` stable and lets Flutter reuse [Element]s across rebuilds.
///
/// The argument and result parsers are deliberately strict: unknown fields are
/// tolerated but malformed fields throw a [FormatException] so the reducer
/// surfaces the bug at the boundary instead of rendering silent placeholders.
library;

import '../transcript_status.dart';

/// Names of the built-in tools the mobile transcript renders with a dedicated
/// card. Anything outside this set falls through to [UnknownToolCard].
class BuiltInToolName {
  const BuiltInToolName._();

  static const String read = 'read';
  static const String bash = 'bash';
  static const String edit = 'edit';
  static const String write = 'write';
  static const String grep = 'grep';
  static const String find = 'find';
  static const String ls = 'ls';

  /// All built-in tool names. Order matters: it is the order the factory
  /// uses to pick the dedicated card before falling back to the unknown card.
  static const List<String> all = <String>[
    read,
    bash,
    edit,
    write,
    grep,
    find,
    ls,
  ];

  /// Returns true when [name] matches a built-in tool.
  static bool isBuiltIn(String name) => all.contains(name);
}

/// Truncation notice attached to a tool result when the host has dropped
/// part of the output. The mobile widget surfaces the notice prominently so
/// the user knows the answer is partial and can request the full payload.
class ToolOutputTruncation {
  const ToolOutputTruncation({
    required this.retainedBytes,
    required this.totalBytes,
    this.digest,
  });

  /// Bytes retained in the cached result the mobile widget will render.
  final int retainedBytes;

  /// Bytes the host originally produced before truncation.
  final int totalBytes;

  /// Optional SHA-256 digest of the full original payload. When present the
  /// widget exposes it so the user can verify they are looking at the same
  /// bytes the host produced.
  final String? digest;

  /// Sanity-check factory: [retainedBytes] must be smaller than
  /// [totalBytes], both must be non-negative.
  factory ToolOutputTruncation.parse({
    required int retainedBytes,
    required int totalBytes,
    String? digest,
  }) {
    if (retainedBytes < 0) {
      throw const FormatException(
        'ToolOutputTruncation.retainedBytes must be >= 0',
      );
    }
    if (totalBytes < retainedBytes) {
      throw const FormatException(
        'ToolOutputTruncation.totalBytes must be >= retainedBytes',
      );
    }
    return ToolOutputTruncation(
      retainedBytes: retainedBytes,
      totalBytes: totalBytes,
      digest: digest,
    );
  }

  /// Human-readable summary suitable for the visible truncation label.
  String get summaryLabel {
    final retained = _formatBytes(retainedBytes);
    final total = _formatBytes(totalBytes);
    return '$retained of $total bytes retained';
  }

  @override
  bool operator ==(Object other) =>
      other is ToolOutputTruncation &&
      other.retainedBytes == retainedBytes &&
      other.totalBytes == totalBytes &&
      other.digest == digest;

  @override
  int get hashCode => Object.hash(retainedBytes, totalBytes, digest);
}

/// View-data describing one tool invocation as the transcript widget sees
/// it. The widget never inspects the raw protocol payload directly; the
/// reducer has already lowered it into a [ToolCallViewData].
class ToolCallViewData {
  const ToolCallViewData({
    required this.toolCallId,
    required this.toolName,
    required this.arguments,
    required this.status,
    this.result,
    this.errorMessage,
    this.truncation,
    this.startedAt,
    this.finishedAt,
  });

  /// Stable identifier for the tool call. The mobile list keys cards by this
  /// value so the framework reuses the correct [Element] across rebuilds.
  final String toolCallId;

  /// Canonical tool name. Compared against [BuiltInToolName] to decide
  /// whether a dedicated card or the generic unknown card is rendered.
  final String toolName;

  /// Argument map as lowered by the reducer. Built-in cards cast the values
  /// they care about via [ReadToolArgs.fromMap] etc. and ignore unknown
  /// fields. The map is unmodifiable so widgets can rely on referential
  /// equality during rebuild.
  final Map<String, Object?> arguments;

  /// Lifecycle status. See [TranscriptToolStatus].
  final TranscriptToolStatus status;

  /// Optional structured result. Built-in cards parse it into a typed shape
  /// (e.g. [ReadToolResult]); unknown cards display the raw JSON.
  final Map<String, Object?>? result;

  /// Short human-readable error message. Populated only when
  /// [status] is [TranscriptToolStatus.error] or [TranscriptToolStatus.policyDenied].
  final String? errorMessage;

  /// Optional truncation notice. When present, the card renders a warning
  /// badge and a "View full output" affordance.
  final ToolOutputTruncation? truncation;

  /// When the call started. Optional so older journals without timestamps
  /// still render.
  final DateTime? startedAt;

  /// When the call finished. Same rationale as [startedAt].
  final DateTime? finishedAt;

  /// Convenience flag: true when the tool has a dedicated card.
  bool get isBuiltIn => BuiltInToolName.isBuiltIn(toolName);
}

/// Strict parser for the argument shape of the `read` tool.
class ReadToolArgs {
  const ReadToolArgs({required this.path, this.offset, this.limit});

  final String path;
  final int? offset;
  final int? limit;

  factory ReadToolArgs.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    if (path is! String || path.isEmpty) {
      throw const FormatException('read requires a non-empty string `path`');
    }
    final offset = map['offset'];
    final limit = map['limit'];
    if (offset != null && offset is! int) {
      throw const FormatException('read `offset` must be an integer');
    }
    if (limit != null && limit is! int) {
      throw const FormatException('read `limit` must be an integer');
    }
    return ReadToolArgs(
      path: path,
      offset: offset as int?,
      limit: limit as int?,
    );
  }
}

/// Strict parser for the argument shape of the `bash` tool.
class BashToolArgs {
  const BashToolArgs({required this.command, this.cwd, this.timeoutMs});

  final String command;
  final String? cwd;
  final int? timeoutMs;

  factory BashToolArgs.fromMap(Map<String, Object?> map) {
    final command = map['command'];
    if (command is! String || command.isEmpty) {
      throw const FormatException('bash requires a non-empty string `command`');
    }
    final cwd = map['cwd'];
    final timeoutMs = map['timeoutMs'];
    if (cwd != null && cwd is! String) {
      throw const FormatException('bash `cwd` must be a string');
    }
    if (timeoutMs != null && timeoutMs is! int) {
      throw const FormatException('bash `timeoutMs` must be an integer');
    }
    return BashToolArgs(
      command: command,
      cwd: cwd as String?,
      timeoutMs: timeoutMs as int?,
    );
  }
}

/// Strict parser for the argument shape of the `edit` tool. `edit` replaces
/// the unique occurrence of [oldText] in [path] with [newText].
class EditToolArgs {
  const EditToolArgs({
    required this.path,
    required this.oldText,
    required this.newText,
  });

  final String path;
  final String oldText;
  final String newText;

  factory EditToolArgs.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    if (path is! String || path.isEmpty) {
      throw const FormatException('edit requires a non-empty string `path`');
    }
    final oldText = map['oldText'];
    if (oldText is! String) {
      throw const FormatException('edit requires a string `oldText`');
    }
    final newText = map['newText'];
    if (newText is! String) {
      throw const FormatException('edit requires a string `newText`');
    }
    return EditToolArgs(path: path, oldText: oldText, newText: newText);
  }
}

/// Strict parser for the argument shape of the `write` tool.
class WriteToolArgs {
  const WriteToolArgs({required this.path, required this.content});

  final String path;
  final String content;

  factory WriteToolArgs.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    if (path is! String || path.isEmpty) {
      throw const FormatException('write requires a non-empty string `path`');
    }
    final content = map['content'];
    if (content is! String) {
      throw const FormatException('write requires a string `content`');
    }
    return WriteToolArgs(path: path, content: content);
  }
}

/// Strict parser for the argument shape of the `grep` tool.
class GrepToolArgs {
  const GrepToolArgs({
    required this.pattern,
    this.path,
    this.include,
    this.ignoreCase = false,
  });

  final String pattern;
  final String? path;
  final String? include;
  final bool ignoreCase;

  factory GrepToolArgs.fromMap(Map<String, Object?> map) {
    final pattern = map['pattern'];
    if (pattern is! String) {
      throw const FormatException('grep requires a string `pattern`');
    }
    final path = map['path'];
    final include = map['include'];
    final ignoreCase = map['ignoreCase'];
    if (path != null && path is! String) {
      throw const FormatException('grep `path` must be a string');
    }
    if (include != null && include is! String) {
      throw const FormatException('grep `include` must be a string');
    }
    if (ignoreCase != null && ignoreCase is! bool) {
      throw const FormatException('grep `ignoreCase` must be a boolean');
    }
    return GrepToolArgs(
      pattern: pattern,
      path: path as String?,
      include: include as String?,
      ignoreCase: (ignoreCase as bool?) ?? false,
    );
  }
}

/// Strict parser for the argument shape of the `find` tool.
class FindToolArgs {
  const FindToolArgs({required this.pattern, this.path, this.type});

  final String pattern;
  final String? path;
  final String? type;

  factory FindToolArgs.fromMap(Map<String, Object?> map) {
    final pattern = map['pattern'];
    if (pattern is! String) {
      throw const FormatException('find requires a string `pattern`');
    }
    final path = map['path'];
    final type = map['type'];
    if (path != null && path is! String) {
      throw const FormatException('find `path` must be a string');
    }
    if (type != null && type is! String) {
      throw const FormatException('find `type` must be a string');
    }
    return FindToolArgs(
      pattern: pattern,
      path: path as String?,
      type: type as String?,
    );
  }
}

/// Strict parser for the argument shape of the `ls` tool.
class LsToolArgs {
  const LsToolArgs({required this.path});

  final String path;

  factory LsToolArgs.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    if (path is! String || path.isEmpty) {
      throw const FormatException('ls requires a non-empty string `path`');
    }
    return LsToolArgs(path: path);
  }
}

/// Result shape for a `read` call.
class ReadToolResult {
  const ReadToolResult({
    required this.content,
    required this.byteCount,
    this.totalLines,
  });

  final String content;
  final int byteCount;
  final int? totalLines;

  factory ReadToolResult.fromMap(Map<String, Object?> map) {
    final content = map['content'];
    if (content is! String) {
      throw const FormatException('read result requires string `content`');
    }
    final byteCount = map['byteCount'];
    if (byteCount is! int) {
      throw const FormatException('read result requires int `byteCount`');
    }
    final totalLines = map['totalLines'];
    if (totalLines != null && totalLines is! int) {
      throw const FormatException('read result `totalLines` must be int');
    }
    return ReadToolResult(
      content: content,
      byteCount: byteCount,
      totalLines: totalLines as int?,
    );
  }
}

/// Result shape for a `bash` call.
class BashToolResult {
  const BashToolResult({
    required this.stdout,
    required this.stderr,
    required this.exitCode,
  });

  final String stdout;
  final String stderr;
  final int exitCode;

  factory BashToolResult.fromMap(Map<String, Object?> map) {
    final stdout = map['stdout'];
    final stderr = map['stderr'];
    final exitCode = map['exitCode'];
    if (stdout is! String) {
      throw const FormatException('bash result requires string `stdout`');
    }
    if (stderr is! String) {
      throw const FormatException('bash result requires string `stderr`');
    }
    if (exitCode is! int) {
      throw const FormatException('bash result requires int `exitCode`');
    }
    return BashToolResult(stdout: stdout, stderr: stderr, exitCode: exitCode);
  }
}

/// Result shape for an `edit` call. The optional [diff] is the host-reported
/// unified diff; the widget falls back to a before/after preview when absent.
class EditToolResult {
  const EditToolResult({this.diff});

  final String? diff;

  factory EditToolResult.fromMap(Map<String, Object?> map) {
    final diff = map['diff'];
    if (diff != null && diff is! String) {
      throw const FormatException('edit result `diff` must be a string');
    }
    return EditToolResult(diff: diff as String?);
  }
}

/// Result shape for a `write` call.
class WriteToolResult {
  const WriteToolResult({required this.byteCount});

  final int byteCount;

  factory WriteToolResult.fromMap(Map<String, Object?> map) {
    final byteCount = map['byteCount'];
    if (byteCount is! int) {
      throw const FormatException('write result requires int `byteCount`');
    }
    return WriteToolResult(byteCount: byteCount);
  }
}

/// One match in a `grep` result.
class GrepToolMatch {
  const GrepToolMatch({
    required this.path,
    required this.lineNumber,
    required this.line,
  });

  final String path;
  final int lineNumber;
  final String line;

  factory GrepToolMatch.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    final lineNumber = map['lineNumber'];
    final line = map['line'];
    if (path is! String) {
      throw const FormatException('grep match requires string `path`');
    }
    if (lineNumber is! int) {
      throw const FormatException('grep match requires int `lineNumber`');
    }
    if (line is! String) {
      throw const FormatException('grep match requires string `line`');
    }
    return GrepToolMatch(path: path, lineNumber: lineNumber, line: line);
  }
}

/// Result shape for a `grep` call.
class GrepToolResult {
  const GrepToolResult({required this.matches});

  final List<GrepToolMatch> matches;

  factory GrepToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['matches'];
    if (raw is! List) {
      throw const FormatException('grep result requires list `matches`');
    }
    final matches = <GrepToolMatch>[];
    for (final item in raw) {
      if (item is! Map) {
        throw const FormatException('grep match must be an object');
      }
      matches.add(GrepToolMatch.fromMap(Map<String, Object?>.from(item)));
    }
    return GrepToolResult(matches: List<GrepToolMatch>.unmodifiable(matches));
  }
}

/// One match in a `find` result.
class FindToolMatch {
  const FindToolMatch({required this.path});

  final String path;

  factory FindToolMatch.fromMap(Map<String, Object?> map) {
    final path = map['path'];
    if (path is! String) {
      throw const FormatException('find match requires string `path`');
    }
    return FindToolMatch(path: path);
  }
}

/// Result shape for a `find` call.
class FindToolResult {
  const FindToolResult({required this.matches});

  final List<FindToolMatch> matches;

  factory FindToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['matches'];
    if (raw is! List) {
      throw const FormatException('find result requires list `matches`');
    }
    final matches = <FindToolMatch>[];
    for (final item in raw) {
      if (item is! Map) {
        throw const FormatException('find match must be an object');
      }
      matches.add(FindToolMatch.fromMap(Map<String, Object?>.from(item)));
    }
    return FindToolResult(matches: List<FindToolMatch>.unmodifiable(matches));
  }
}

/// One entry in an `ls` result.
class LsEntry {
  const LsEntry({required this.name, required this.kind, this.sizeBytes});

  final String name;
  final String kind;
  final int? sizeBytes;

  factory LsEntry.fromMap(Map<String, Object?> map) {
    final name = map['name'];
    final kind = map['kind'];
    if (name is! String) {
      throw const FormatException('ls entry requires string `name`');
    }
    if (kind is! String) {
      throw const FormatException('ls entry requires string `kind`');
    }
    final sizeBytes = map['sizeBytes'];
    if (sizeBytes != null && sizeBytes is! int) {
      throw const FormatException('ls entry `sizeBytes` must be int');
    }
    return LsEntry(name: name, kind: kind, sizeBytes: sizeBytes as int?);
  }
}

/// Result shape for an `ls` call.
class LsToolResult {
  const LsToolResult({required this.entries});

  final List<LsEntry> entries;

  factory LsToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['entries'];
    if (raw is! List) {
      throw const FormatException('ls result requires list `entries`');
    }
    final entries = <LsEntry>[];
    for (final item in raw) {
      if (item is! Map) {
        throw const FormatException('ls entry must be an object');
      }
      entries.add(LsEntry.fromMap(Map<String, Object?>.from(item)));
    }
    return LsToolResult(entries: List<LsEntry>.unmodifiable(entries));
  }
}

/// Approximate human-readable byte formatter shared across the truncation
/// notice and large-output viewer. Always uses the larger unit that still
/// yields a value greater than or equal to 1, except for sub-kilobyte
/// values which stay in bytes.
String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  var value = bytes / 1024;
  var unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  // Always use one decimal place for KB+ so values like 5120 B render as
  // "5.0 KB" rather than inconsistently switching between "5 KB" and
  // "5.0 KB" depending on whether the scaled value happens to be integer.
  return '${value.toStringAsFixed(1)} ${units[unitIndex]}';
}

/// Public wrapper so widgets and tests can use the formatter without
/// accessing the private symbol.
String formatRetainedBytes(int bytes) => _formatBytes(bytes);
