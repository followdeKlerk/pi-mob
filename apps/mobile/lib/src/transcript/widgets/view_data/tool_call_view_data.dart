import 'dart:convert';

import '../transcript_status.dart';

class BuiltInToolName {
  const BuiltInToolName._();

  static const String read = 'read';
  static const String bash = 'bash';
  static const String edit = 'edit';
  static const String write = 'write';
  static const String grep = 'grep';
  static const String find = 'find';
  static const String ls = 'ls';

  static const List<String> all = <String>[
    read,
    bash,
    edit,
    write,
    grep,
    find,
    ls,
  ];

  static bool isBuiltIn(String name) => all.contains(name);
}

class ToolOutputTruncation {
  const ToolOutputTruncation({
    required this.retainedBytes,
    required this.totalBytes,
    this.digest,
  });

  final int retainedBytes;
  final int totalBytes;
  final String? digest;

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

  final String toolCallId;
  final String toolName;
  final Map<String, Object?> arguments;
  final TranscriptToolStatus status;
  final Map<String, Object?>? result;
  final String? errorMessage;
  final ToolOutputTruncation? truncation;
  final DateTime? startedAt;
  final DateTime? finishedAt;

  bool get isBuiltIn => BuiltInToolName.isBuiltIn(toolName);
}

class ReadToolArgs {
  const ReadToolArgs({required this.path, this.offset, this.limit});

  final String path;
  final int? offset;
  final int? limit;

  factory ReadToolArgs.fromMap(Map<String, Object?> map) {
    final offset = _optionalInt(map['offset'], 'read `offset`');
    final limit = _optionalInt(map['limit'], 'read `limit`');
    return ReadToolArgs(
      path: _displayPath(map['path'], 'read `path`'),
      offset: offset,
      limit: limit,
    );
  }
}

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
    if (cwd != null && cwd is! String) {
      throw const FormatException('bash `cwd` must be a string');
    }
    final timeoutMs = _optionalInt(map['timeoutMs'], 'bash `timeoutMs`');
    return BashToolArgs(
      command: command,
      cwd: cwd as String?,
      timeoutMs: timeoutMs,
    );
  }
}

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
    final oldText = map['oldText'];
    if (oldText is! String) {
      throw const FormatException('edit requires a string `oldText`');
    }
    final newText = map['newText'];
    if (newText is! String) {
      throw const FormatException('edit requires a string `newText`');
    }
    return EditToolArgs(
      path: _displayPath(map['path'], 'edit `path`'),
      oldText: oldText,
      newText: newText,
    );
  }
}

class WriteToolArgs {
  const WriteToolArgs({required this.path, required this.content});

  final String path;
  final String content;

  factory WriteToolArgs.fromMap(Map<String, Object?> map) {
    final content = map['content'];
    if (content is! String) {
      throw const FormatException('write requires a string `content`');
    }
    return WriteToolArgs(
      path: _displayPath(map['path'], 'write `path`'),
      content: content,
    );
  }
}

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

class LsToolArgs {
  const LsToolArgs({required this.path});

  final String path;

  factory LsToolArgs.fromMap(Map<String, Object?> map) =>
      LsToolArgs(path: _displayPath(map['path'], 'ls `path`'));
}

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
    final content = _resultText(map);
    if (content == null) {
      throw const FormatException('read result requires textual content');
    }
    final byteCount =
        _intFromResult(map, 'byteCount', 'read result `byteCount`') ??
        utf8.encode(content).length;
    final totalLines =
        _intFromResult(map, 'totalLines', 'read result `totalLines`') ??
        (content.isEmpty ? 0 : '\n'.allMatches(content).length + 1);
    return ReadToolResult(
      content: content,
      byteCount: byteCount,
      totalLines: totalLines,
    );
  }
}

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
    final stdout =
        _stringFromResult(map, 'stdout', 'bash result `stdout`') ??
        _resultText(map);
    if (stdout == null) {
      throw const FormatException('bash result requires textual output');
    }
    return BashToolResult(
      stdout: stdout,
      stderr: _stringFromResult(map, 'stderr', 'bash result `stderr`') ?? '',
      exitCode: _intFromResult(map, 'exitCode', 'bash result `exitCode`') ?? 0,
    );
  }
}

class EditToolResult {
  const EditToolResult({this.diff});

  final String? diff;

  factory EditToolResult.fromMap(Map<String, Object?> map) => EditToolResult(
    diff:
        _stringFromResult(map, 'diff', 'edit result `diff`') ??
        _resultText(map),
  );
}

class WriteToolResult {
  const WriteToolResult({required this.byteCount});

  final int byteCount;

  factory WriteToolResult.fromMap(Map<String, Object?> map) {
    final text = _resultText(map);
    final byteCount =
        _intFromResult(map, 'byteCount', 'write result `byteCount`') ??
        (text == null ? null : _byteCountFromText(text));
    if (byteCount == null) {
      throw const FormatException('write result requires a byte count');
    }
    return WriteToolResult(byteCount: byteCount);
  }
}

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

class GrepToolResult {
  const GrepToolResult({required this.matches});

  final List<GrepToolMatch> matches;

  factory GrepToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['matches'];
    if (raw != null) {
      if (raw is! List) {
        throw const FormatException('grep result `matches` must be a list');
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

    final lines = _resultLines(map);
    final matches = <GrepToolMatch>[];
    final pattern = RegExp(r'^(.+?):(\d+):(.*)$');
    for (var index = 0; index < lines.length; index++) {
      final line = lines[index];
      final match = pattern.firstMatch(line);
      matches.add(
        match == null
            ? GrepToolMatch(path: 'output', lineNumber: index + 1, line: line)
            : GrepToolMatch(
                path: match.group(1)!,
                lineNumber: int.parse(match.group(2)!),
                line: match.group(3)!.trimLeft(),
              ),
      );
    }
    return GrepToolResult(matches: List<GrepToolMatch>.unmodifiable(matches));
  }
}

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

class FindToolResult {
  const FindToolResult({required this.matches});

  final List<FindToolMatch> matches;

  factory FindToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['matches'];
    if (raw != null) {
      if (raw is! List) {
        throw const FormatException('find result `matches` must be a list');
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
    return FindToolResult(
      matches: List<FindToolMatch>.unmodifiable(
        _resultLines(map).map((line) => FindToolMatch(path: line)),
      ),
    );
  }
}

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
    final sizeBytes = _optionalInt(map['sizeBytes'], 'ls entry `sizeBytes`');
    return LsEntry(name: name, kind: kind, sizeBytes: sizeBytes);
  }
}

class LsToolResult {
  const LsToolResult({required this.entries});

  final List<LsEntry> entries;

  factory LsToolResult.fromMap(Map<String, Object?> map) {
    final raw = map['entries'];
    if (raw != null) {
      if (raw is! List) {
        throw const FormatException('ls result `entries` must be a list');
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
    return LsToolResult(
      entries: List<LsEntry>.unmodifiable(
        _resultLines(map).map((line) => LsEntry(name: line, kind: 'item')),
      ),
    );
  }
}

const String _redactedPathLabel = '<path redacted>';
const Object _missingResultField = Object();

String _displayPath(Object? value, String label) {
  if (value == null) return _redactedPathLabel;
  if (value is! String) {
    throw FormatException('$label must be a string');
  }
  if (value.isEmpty) {
    throw FormatException('$label must be non-empty');
  }
  return value;
}

int? _optionalInt(Object? value, String label) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num && value.isFinite && value.toInt() == value) {
    return value.toInt();
  }
  throw FormatException('$label must be an integer');
}

Map<String, Object?>? _details(Map<String, Object?> map) {
  if (!map.containsKey('details') || map['details'] == null) return null;
  final value = map['details'];
  if (value is! Map) {
    throw const FormatException('tool result `details` must be an object');
  }
  return Map<String, Object?>.from(value);
}

Object? _resultField(Map<String, Object?> map, String key) {
  if (map.containsKey(key)) return map[key];
  final details = _details(map);
  if (details != null && details.containsKey(key)) return details[key];
  return _missingResultField;
}

String? _stringFromResult(Map<String, Object?> map, String key, String label) {
  final value = _resultField(map, key);
  if (identical(value, _missingResultField) || value == null) return null;
  if (value is! String) {
    throw FormatException('$label must be a string');
  }
  return value;
}

int? _intFromResult(Map<String, Object?> map, String key, String label) {
  final value = _resultField(map, key);
  if (identical(value, _missingResultField) || value == null) return null;
  if (value is! int) {
    throw FormatException('$label must be an integer');
  }
  return value;
}

String? _resultText(Map<String, Object?> map) {
  for (final entry in const <(String, String)>[
    ('output', 'tool result `output`'),
    ('stdout', 'tool result `stdout`'),
    ('text', 'tool result `text`'),
  ]) {
    final value = _stringFromResult(map, entry.$1, entry.$2);
    if (value != null) return value;
  }

  final content = _resultField(map, 'content');
  if (identical(content, _missingResultField) || content == null) return null;
  return _textFromContent(content);
}

String? _textFromContent(Object content) {
  if (content is String) return content;
  if (content is! List) {
    throw const FormatException(
      'tool result `content` must be a string or list',
    );
  }

  final parts = <String>[];
  for (final item in content) {
    if (item is String) {
      parts.add(item);
      continue;
    }
    if (item is! Map) {
      throw const FormatException(
        'tool result content blocks must be strings or objects',
      );
    }
    if (!item.containsKey('text') || item['text'] == null) continue;
    final text = item['text'];
    if (text is! String) {
      throw const FormatException(
        'tool result content block `text` must be a string',
      );
    }
    parts.add(text);
  }
  return parts.isEmpty ? null : parts.join('\n');
}

int? _byteCountFromText(String text) {
  final match = RegExp(
    r'(\d+)\s+bytes?',
    caseSensitive: false,
  ).firstMatch(text);
  return match == null ? null : int.tryParse(match.group(1)!);
}

List<String> _resultLines(Map<String, Object?> map) {
  final text = _resultText(map);
  if (text == null || text.isEmpty) return const <String>[];
  return text
      .split('\n')
      .map((line) => line.trimRight())
      .where((line) => line.isNotEmpty)
      .toList(growable: false);
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  var value = bytes / 1024;
  var unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return '${value.toStringAsFixed(1)} ${units[unitIndex]}';
}

String formatRetainedBytes(int bytes) => _formatBytes(bytes);
