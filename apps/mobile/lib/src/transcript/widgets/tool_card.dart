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
///   * A compact header with the canonical tool label, a status icon, and
///     a redundant status text label (icon and text are both visible so the
///     affordance never depends on colour alone).
///   * An optional truncation banner when the host dropped bytes.
///   * An expandable region for the arguments, the raw result, and
///     tool-specific highlights.
///
/// Widgets are immutable from the outside: the only state we keep is
/// `expanded`, which the user toggles by tapping the header.
///
/// Presentation: the card is rendered edge-to-edge with restrained chrome:
/// hairline top/bottom borders, no card elevation, and a compact single-line
/// header so a stack of tool calls reads as a list rather than as nested
/// boxes.
library;

import 'dart:convert';

import 'package:flutter/material.dart';

import '../../ui/theme/pi_theme.dart';
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

  @override
  void initState() {
    super.initState();
    _expanded = widget.data.toolName == 'Agent';
  }

  ToolCallViewData get _data => widget.data;
  TranscriptToolStatus get _status => _data.status;
  ColorScheme get _colors => Theme.of(context).colorScheme;
  TextTheme get _text => Theme.of(context).textTheme;

  /// Horizontal inset (logical pixels) shared across the transcript so the
  /// prose edges align.
  static const double _contentInset = 16;

  @override
  Widget build(BuildContext context) {
    final scheme = _colors;
    final statusColor = _status.resolveColor(scheme);
    final toolLabel = _toolLabel(_data.toolName, _data.arguments);
    final muted = scheme.onSurfaceVariant;
    return Semantics(
      container: true,
      label: 'Tool $toolLabel, ${_status.semanticLabel}',
      child: Card(
        margin: const EdgeInsets.symmetric(
          horizontal: PiSpacing.lg,
          vertical: PiSpacing.xs,
        ),
        elevation: 0,
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.65),
            ),
            borderRadius: BorderRadius.circular(PiRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: PiSpacing.md,
                    vertical: PiSpacing.sm,
                  ),
                  child: Row(
                    children: [
                      Icon(_status.icon, color: statusColor, size: 16),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          toolLabel,
                          style: _text.titleSmall?.copyWith(
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Status text + icon: redundant on purpose, so the
                      // affordance never relies on colour alone.
                      Text(
                        _status.label,
                        style: _text.labelMedium?.copyWith(
                          color: statusColor,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Icon(
                        _expanded ? Icons.expand_less : Icons.expand_more,
                        size: 18,
                        color: muted,
                      ),
                    ],
                  ),
                ),
              ),
              if (_data.truncation != null)
                _truncationBanner(_data.truncation!),
              if (_data.status == TranscriptToolStatus.error ||
                  _data.status == TranscriptToolStatus.policyDenied)
                _errorBanner(_data.errorMessage),
              if (_expanded) _expandedBody(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _expandedBody() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(_contentInset, 0, _contentInset, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Divider(height: 12, thickness: 1, color: _colors.outlineVariant),
          _argsSection(),
          const SizedBox(height: 8),
          _resultSection(),
          const SizedBox(height: 8),
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
        mainAxisSize: MainAxisSize.min,
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
        mainAxisSize: MainAxisSize.min,
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
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        title,
        style: _text.labelMedium?.copyWith(
          color: _colors.onSurfaceVariant,
          letterSpacing: 0.4,
        ),
      ),
      const SizedBox(height: 6),
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
      style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
    );
  }

  // ----- Per-tool renderers -----

  Widget _renderArgs() {
    switch (_data.toolName) {
      case 'Agent':
        return _kv([
          if (_data.arguments['description'] != null)
            MapEntry('task', _data.arguments['description']!),
          if (_data.arguments['subagent_type'] != null)
            MapEntry('agent', _data.arguments['subagent_type']!),
          if (_data.arguments['model'] != null)
            MapEntry('model', _data.arguments['model']!),
          if (_data.arguments['thinking'] != null)
            MapEntry('thinking', _data.arguments['thinking']!),
          if (_data.arguments['run_in_background'] != null)
            MapEntry('background', _data.arguments['run_in_background']!),
        ]);
      case 'get_subagent_result':
        return _kv([
          if (_data.arguments['agent_id'] != null)
            MapEntry('agent', _data.arguments['agent_id']!),
          if (_data.arguments['wait'] != null)
            MapEntry('wait', _data.arguments['wait']!),
        ]);
      case 'steer_subagent':
        return _kv([
          if (_data.arguments['agent_id'] != null)
            MapEntry('agent', _data.arguments['agent_id']!),
          if (_data.arguments['message'] != null)
            MapEntry('direction', _data.arguments['message']!),
        ]);
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
          mainAxisSize: MainAxisSize.min,
          children: [
            _kv([MapEntry('path', args.path)]),
            const SizedBox(height: 6),
            Text(
              'oldText',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            _codeBlock(args.oldText),
            const SizedBox(height: 6),
            Text(
              'newText',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            _codeBlock(args.newText),
          ],
        );
      case BuiltInToolName.write:
        final args = WriteToolArgs.fromMap(_data.arguments);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            _kv([MapEntry('path', args.path)]),
            const SizedBox(height: 6),
            Text(
              'content (${args.content.length} chars)',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
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
      return Text(
        'No result yet',
        style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
      );
    }
    switch (_data.toolName) {
      case BuiltInToolName.read:
        final r = ReadToolResult.fromMap(result);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            _kv([
              MapEntry('bytes', r.byteCount),
              if (r.totalLines != null) MapEntry('totalLines', r.totalLines!),
            ]),
            const SizedBox(height: 6),
            _codeBlock(r.content),
          ],
        );
      case BuiltInToolName.bash:
        final r = BashToolResult.fromMap(result);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            _kv([MapEntry('exitCode', r.exitCode)]),
            const SizedBox(height: 6),
            Text(
              'stdout',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            _codeBlock(r.stdout),
            const SizedBox(height: 6),
            Text(
              'stderr',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            _codeBlock(r.stderr),
          ],
        );
      case BuiltInToolName.edit:
        final r = EditToolResult.fromMap(result);
        if (r.diff == null || r.diff!.isEmpty) {
          return Text(
            'Edit completed',
            style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'diff',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            _codeBlock(r.diff!),
          ],
        );
      case BuiltInToolName.write:
        final r = WriteToolResult.fromMap(result);
        return _kv([MapEntry('bytes', r.byteCount)]);
      case BuiltInToolName.grep:
        final r = GrepToolResult.fromMap(result);
        if (r.matches.isEmpty) {
          return Text(
            'No matches',
            style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${r.matches.length} match(es)',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            for (final m in r.matches)
              _codeBlock('${m.path}:${m.lineNumber}: ${m.line}'),
          ],
        );
      case BuiltInToolName.find:
        final r = FindToolResult.fromMap(result);
        if (r.matches.isEmpty) {
          return Text(
            'No matches',
            style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${r.matches.length} match(es)',
              style: _text.labelSmall?.copyWith(
                color: _colors.onSurfaceVariant,
              ),
            ),
            for (final m in r.matches) _codeBlock(m.path),
          ],
        );
      case BuiltInToolName.ls:
        final r = LsToolResult.fromMap(result);
        if (r.entries.isEmpty) {
          return Text(
            'Empty directory',
            style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
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
      mainAxisSize: MainAxisSize.min,
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
                      color: _colors.onSurfaceVariant,
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
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: _text.labelSmall?.copyWith(color: _colors.onSurfaceVariant),
        ),
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
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: _colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SelectableText(
            visible,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              color: _colors.onSurface,
            ),
          ),
          if (clipped)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Preview capped at $previewCharacters characters; '
                '${text.length - previewCharacters} more are not rendered.',
                key: const Key('tool-inline-preview-cap'),
                style: _text.labelSmall?.copyWith(
                  color: _colors.onSurfaceVariant,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _notice(String message) => Container(
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: _colors.errorContainer,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      message,
      style: _text.bodySmall?.copyWith(color: _colors.onErrorContainer),
    ),
  );

  Widget _truncationBanner(ToolOutputTruncation t) => Container(
    key: const Key('tool-truncation-banner'),
    margin: const EdgeInsets.symmetric(horizontal: _contentInset, vertical: 4),
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: _colors.tertiaryContainer,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Row(
      children: [
        Icon(Icons.content_cut, size: 16, color: _colors.onTertiaryContainer),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'Truncated: ${t.summaryLabel}'
            '${t.digest == null ? '' : ' · SHA-256 ${t.digest}'}',
            style: _text.bodySmall?.copyWith(
              color: _colors.onTertiaryContainer,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _errorBanner(String? message) => Container(
    key: const Key('tool-error-banner'),
    margin: const EdgeInsets.symmetric(horizontal: _contentInset, vertical: 4),
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: _colors.errorContainer,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Row(
      children: [
        Icon(Icons.error_outline, size: 16, color: _colors.onErrorContainer),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message ?? 'Tool failed',
            style: _text.bodySmall?.copyWith(color: _colors.onErrorContainer),
          ),
        ),
      ],
    ),
  );

  static String _toolLabel(String toolName, Map<String, Object?> arguments) {
    if (BuiltInToolName.isBuiltIn(toolName)) return toolName;
    return switch (toolName) {
      'Agent' =>
        arguments['description'] is String
            ? 'Agent · ${arguments['description']}'
            : 'Agent',
      'get_subagent_result' => 'Agent result',
      'steer_subagent' => 'Steer agent',
      'web_search' => 'Web search',
      'fetch_content' => 'Fetch content',
      'get_search_content' => 'Search result',
      'goal_complete' => 'Goal completed',
      'goal_blocked' => 'Goal blocked',
      _ => toolName.replaceAll('_', ' '),
    };
  }
}
