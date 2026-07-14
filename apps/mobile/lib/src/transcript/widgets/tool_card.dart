/// Single factory + scaffold for every tool card in the transcript.
///
/// All seven built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`,
/// `ls`) and any unknown tool render through the same [ToolCard] widget.
/// The factory [ToolCard.forViewData] is the only public entry point; the
/// private constructor and the private builder closure inside [_ToolCardState]
/// decide which body to render based on [ToolCallViewData.toolName].
///
/// The card always renders:
///
///   * A header with the canonical tool label and a status icon.
///   * An optional truncation banner when the host dropped bytes.
///   * An expandable region for the arguments, the raw result, and
///     tool-specific highlights.
///
/// Widgets are immutable from the outside: the only state we keep is
/// `expanded`, which the user toggles by tapping the header.
library;

import 'dart:convert';

import 'package:flutter/material.dart';

import '../widgets/transcript_status.dart';
import 'view_data/tool_call_view_data.dart';

/// Public, compact tool-card widget. Use the [ToolCard.forViewData] factory
/// rather than the default constructor; the latter is private so callers
/// cannot accidentally bypass the [ToolCallViewData] lowering.
class ToolCard extends StatefulWidget {
  const ToolCard._({required this.data, super.key});

  /// Builds a [ToolCard] from a [ToolCallViewData]. The widget key defaults
  /// to a value derived from [ToolCallViewData.toolCallId] so the framework
  /// can reuse the existing [Element] across rebuilds.
  factory ToolCard.forViewData(ToolCallViewData data, {Key? key}) => ToolCard._(
    key: key ?? ValueKey('tool-card-${data.toolCallId}'),
    data: data,
  );

  /// View-data describing this call. Immutable for the lifetime of the
  /// widget; status changes are delivered as a new [ToolCallViewData].
  final ToolCallViewData data;

  @override
  State<ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends State<ToolCard> {
  bool _expanded = false;

  ToolCallViewData get _data => widget.data;
  TranscriptToolStatus get _status => _data.status;
  ColorScheme get _colors => Theme.of(context).colorScheme;
  TextTheme get _text => Theme.of(context).textTheme;

  @override
  Widget build(BuildContext context) {
    final color = _status.resolveColor(_colors);
    final toolLabel = _toolLabel(_data.toolName);
    return Semantics(
      container: true,
      label: 'Tool $toolLabel, ${_status.semanticLabel}',
      child: Card(
        margin: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                child: Row(
                  children: [
                    Icon(_status.icon, color: color, size: 18),
                    const SizedBox(width: 8),
                    Expanded(child: Text(toolLabel, style: _text.titleSmall)),
                    Text(
                      _status.label,
                      style: _text.labelSmall?.copyWith(color: color),
                    ),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                    ),
                  ],
                ),
              ),
            ),
            if (_data.truncation != null) _truncationBanner(_data.truncation!),
            if (_data.status == TranscriptToolStatus.error ||
                _data.status == TranscriptToolStatus.policyDenied)
              _errorBanner(_data.errorMessage),
            if (_expanded) _expandedBody(),
          ],
        ),
      ),
    );
  }

  Widget _expandedBody() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Divider(height: 1),
          const SizedBox(height: 6),
          _argsSection(),
          const SizedBox(height: 6),
          _resultSection(),
          const SizedBox(height: 6),
          _timingRow(),
        ],
      ),
    );
  }

  Widget _argsSection() {
    Widget body;
    try {
      body = _renderArgs();
    } on FormatException catch (e) {
      body = _jsonBlock(_data.arguments, label: 'Raw arguments');
      // Surface the parse failure alongside the raw args so the user can see
      // why the dedicated renderer fell back.
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _notice('Argument parse failed: ${e.message}'),
          const SizedBox(height: 4),
          body,
        ],
      );
    }
    return _section('Arguments', body);
  }

  Widget _resultSection() {
    Widget body;
    try {
      body = _renderResult();
    } on FormatException catch (e) {
      body = _jsonBlock(
        _data.result ?? const <String, Object?>{},
        label: 'Raw result',
      );
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _notice('Result parse failed: ${e.message}'),
          const SizedBox(height: 4),
          body,
        ],
      );
    }
    return _section('Result', body);
  }

  Widget _section(String title, Widget body) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(title, style: _text.labelMedium),
      const SizedBox(height: 4),
      body,
    ],
  );

  Widget _timingRow() {
    final start = _data.startedAt;
    final end = _data.finishedAt;
    if (start == null && end == null) return const SizedBox.shrink();
    final startLabel = start?.toIso8601String() ?? '—';
    final endLabel = end?.toIso8601String() ?? '—';
    return Text(
      'Started: $startLabel · Finished: $endLabel',
      style: _text.bodySmall,
    );
  }

  // ----- Per-tool renderers -----

  Widget _renderArgs() {
    switch (_data.toolName) {
      case BuiltInToolName.read:
        final args = ReadToolArgs.fromMap(_data.arguments);
        return _kv([
          MapEntry('path', args.path),
          if (args.offset != null) MapEntry('offset', args.offset!),
          if (args.limit != null) MapEntry('limit', args.limit!),
        ]);
      case BuiltInToolName.bash:
        final args = BashToolArgs.fromMap(_data.arguments);
        return _kv([
          MapEntry('command', args.command),
          if (args.cwd != null) MapEntry('cwd', args.cwd!),
          if (args.timeoutMs != null) MapEntry('timeoutMs', args.timeoutMs!),
        ]);
      case BuiltInToolName.edit:
        final args = EditToolArgs.fromMap(_data.arguments);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _kv([MapEntry('path', args.path)]),
            const SizedBox(height: 4),
            Text('oldText', style: _text.labelSmall),
            _codeBlock(args.oldText),
            const SizedBox(height: 4),
            Text('newText', style: _text.labelSmall),
            _codeBlock(args.newText),
          ],
        );
      case BuiltInToolName.write:
        final args = WriteToolArgs.fromMap(_data.arguments);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _kv([MapEntry('path', args.path)]),
            const SizedBox(height: 4),
            Text(
              'content (${args.content.length} chars)',
              style: _text.labelSmall,
            ),
            _codeBlock(args.content),
          ],
        );
      case BuiltInToolName.grep:
        final args = GrepToolArgs.fromMap(_data.arguments);
        return _kv([
          MapEntry('pattern', args.pattern),
          if (args.path != null) MapEntry('path', args.path!),
          if (args.include != null) MapEntry('include', args.include!),
          if (args.ignoreCase) MapEntry('ignoreCase', args.ignoreCase),
        ]);
      case BuiltInToolName.find:
        final args = FindToolArgs.fromMap(_data.arguments);
        return _kv([
          MapEntry('pattern', args.pattern),
          if (args.path != null) MapEntry('path', args.path!),
          if (args.type != null) MapEntry('type', args.type!),
        ]);
      case BuiltInToolName.ls:
        final args = LsToolArgs.fromMap(_data.arguments);
        return _kv([MapEntry('path', args.path)]);
      default:
        return _jsonBlock(_data.arguments, label: 'Raw arguments');
    }
  }

  Widget _renderResult() {
    final result = _data.result;
    if (result == null) {
      return Text('No result yet', style: _text.bodySmall);
    }
    switch (_data.toolName) {
      case BuiltInToolName.read:
        final r = ReadToolResult.fromMap(result);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _kv([
              MapEntry('bytes', r.byteCount),
              if (r.totalLines != null) MapEntry('totalLines', r.totalLines!),
            ]),
            const SizedBox(height: 4),
            _codeBlock(r.content),
          ],
        );
      case BuiltInToolName.bash:
        final r = BashToolResult.fromMap(result);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _kv([MapEntry('exitCode', r.exitCode)]),
            const SizedBox(height: 4),
            Text('stdout', style: _text.labelSmall),
            _codeBlock(r.stdout),
            const SizedBox(height: 4),
            Text('stderr', style: _text.labelSmall),
            _codeBlock(r.stderr),
          ],
        );
      case BuiltInToolName.edit:
        final r = EditToolResult.fromMap(result);
        if (r.diff == null || r.diff!.isEmpty) {
          return Text('Edit completed', style: _text.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('diff', style: _text.labelSmall),
            _codeBlock(r.diff!),
          ],
        );
      case BuiltInToolName.write:
        final r = WriteToolResult.fromMap(result);
        return _kv([MapEntry('bytes', r.byteCount)]);
      case BuiltInToolName.grep:
        final r = GrepToolResult.fromMap(result);
        if (r.matches.isEmpty) {
          return Text('No matches', style: _text.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${r.matches.length} match(es)', style: _text.labelSmall),
            for (final m in r.matches)
              _codeBlock('${m.path}:${m.lineNumber}: ${m.line}'),
          ],
        );
      case BuiltInToolName.find:
        final r = FindToolResult.fromMap(result);
        if (r.matches.isEmpty) {
          return Text('No matches', style: _text.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${r.matches.length} match(es)', style: _text.labelSmall),
            for (final m in r.matches) _codeBlock(m.path),
          ],
        );
      case BuiltInToolName.ls:
        final r = LsToolResult.fromMap(result);
        if (r.entries.isEmpty) {
          return Text('Empty directory', style: _text.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final e in r.entries)
              Text(
                '${e.kind.padRight(4)}  ${e.name}'
                '${e.sizeBytes == null ? '' : '  (${e.sizeBytes} B)'}',
                style: _text.bodySmall,
              ),
          ],
        );
      default:
        return _jsonBlock(result, label: 'Raw result');
    }
  }

  // ----- Visual helpers -----

  Widget _kv(List<MapEntry<String, Object>> entries) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 1),
            child: RichText(
              text: TextSpan(
                style: _text.bodySmall,
                children: [
                  TextSpan(
                    text: '${entry.key}: ',
                    style: _text.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  TextSpan(text: '${entry.value}'),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _jsonBlock(Map<String, Object?> map, {required String label}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(label, style: _text.labelSmall),
        _codeBlock(const JsonEncoder.withIndent('  ').convert(map)),
      ],
    );
  }

  Widget _codeBlock(String text) {
    const previewCharacters = 1024;
    final clipped = text.length > previewCharacters;
    final visible = clipped ? text.substring(0, previewCharacters) : text;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: const Color(0x11000000),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SelectableText(
            visible,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
          if (clipped)
            Text(
              'Preview capped at $previewCharacters characters; '
              '${text.length - previewCharacters} more are not rendered.',
              key: const Key('tool-inline-preview-cap'),
              style: _text.labelSmall,
            ),
        ],
      ),
    );
  }

  Widget _notice(String message) => Container(
    padding: const EdgeInsets.all(6),
    decoration: BoxDecoration(
      color: _colors.errorContainer,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      message,
      style: _text.bodySmall?.copyWith(color: _colors.onErrorContainer),
    ),
  );

  Widget _truncationBanner(ToolOutputTruncation t) => Container(
    key: const Key('tool-truncation-banner'),
    margin: const EdgeInsets.symmetric(horizontal: 12),
    padding: const EdgeInsets.all(6),
    decoration: BoxDecoration(
      color: _colors.tertiaryContainer,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Row(
      children: [
        const Icon(Icons.content_cut, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'Truncated: ${t.summaryLabel}'
            '${t.digest == null ? '' : ' · SHA-256 ${t.digest}'}',
            style: _text.bodySmall,
          ),
        ),
      ],
    ),
  );

  Widget _errorBanner(String? message) => Container(
    key: const Key('tool-error-banner'),
    margin: const EdgeInsets.symmetric(horizontal: 12),
    padding: const EdgeInsets.all(6),
    decoration: BoxDecoration(
      color: _colors.errorContainer,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Row(
      children: [
        Icon(Icons.error_outline, size: 16, color: _colors.onErrorContainer),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message ?? 'Tool failed',
            style: _text.bodySmall?.copyWith(color: _colors.onErrorContainer),
          ),
        ),
      ],
    ),
  );

  static String _toolLabel(String toolName) {
    if (BuiltInToolName.isBuiltIn(toolName)) {
      return toolName;
    }
    return 'Unknown tool: $toolName';
  }
}
