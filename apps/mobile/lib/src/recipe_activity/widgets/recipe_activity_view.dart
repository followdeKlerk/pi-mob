import 'dart:convert';

import 'package:flutter/material.dart';

import '../../ui/theme/pi_theme.dart';
import '../domain/recipe_activity.dart';

/// Compact, collapsed-by-default presentation of one R1 activity.
///
/// The widget intentionally exposes only the bounded projection. It never
/// receives or renders raw normalized event payloads and has no persistence or
/// coordinator dependency.
class RecipeActivityView extends StatefulWidget {
  const RecipeActivityView({required this.activity, super.key});

  final RecipeActivity activity;

  @override
  State<RecipeActivityView> createState() => _RecipeActivityViewState();
}

class _RecipeActivityViewState extends State<RecipeActivityView> {
  bool _expanded = false;

  RecipeActivity get activity => widget.activity;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = _statusLabel(activity.status);
    final subagent = _subagentSummary(activity);
    final label = activity.kind == RecipeActivityKind.tool
        ? '${subagent?.label ?? activity.toolName ?? activity.title}, $status'
        : '${activity.title}, $status';
    return Semantics(
      container: true,
      label: label,
      child: Card(
        margin: const EdgeInsets.symmetric(
          horizontal: PiSpacing.lg,
          vertical: PiSpacing.xs,
        ),
        elevation: 0,
        color: scheme.surfaceContainerLow,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
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
                    Icon(
                      subagent == null
                          ? _statusIcon(activity.status)
                          : Icons.hub_outlined,
                      size: 17,
                      color: _statusColor(scheme, activity.status),
                    ),
                    const SizedBox(width: PiSpacing.sm),
                    Expanded(
                      child: Text(
                        subagent?.label ?? activity.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(status, style: Theme.of(context).textTheme.labelSmall),
                    const SizedBox(width: PiSpacing.xs),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                    ),
                  ],
                ),
              ),
            ),
            if (_expanded) _details(context),
          ],
        ),
      ),
    );
  }

  Widget _details(BuildContext context) {
    final text = Theme.of(context).textTheme.bodySmall;
    final subagent = _subagentSummary(activity);
    final lines = <String>[];
    if (subagent != null) {
      lines.addAll(subagent.details);
      lines.addAll(_subagentOutputDetails(activity.output));
    } else if (activity.kind == RecipeActivityKind.tool) {
      lines.add('Arguments: ${activity.arguments ?? '-'}');
    }
    if (activity.kind == RecipeActivityKind.tool && subagent == null) {
      lines.add('Output: ${activity.output ?? '-'}');
    }
    if (activity.errorInfo != null) {
      lines.add('Error: ${activity.errorInfo!.message}');
    }
    if (activity.truncation?.isTruncated == true) {
      lines.add(
        'Output truncated: ${activity.truncation!.retainedBytes} of ${activity.truncation!.totalBytes} bytes',
      );
    }
    if (lines.isEmpty) lines.add('No additional details available.');
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PiSpacing.md,
        0,
        PiSpacing.md,
        PiSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [for (final line in lines) Text(line, style: text)],
      ),
    );
  }
}

final class _SubagentSummary {
  const _SubagentSummary({required this.label, required this.details});

  final String label;
  final List<String> details;
}

_SubagentSummary? _subagentSummary(RecipeActivity activity) {
  if (activity.kind != RecipeActivityKind.tool ||
      activity.toolName != 'subagent') {
    return null;
  }

  final decoded = _decodeArguments(activity.arguments);
  if (decoded == null) {
    return const _SubagentSummary(
      label: 'Subagent setup',
      details: <String>['Subagent request details unavailable.'],
    );
  }
  final action = _text(decoded['action']);
  if (action == 'list' || action == 'models') {
    return _SubagentSummary(
      label: 'Subagent setup',
      details: <String>['Management: $action'],
    );
  }

  final workers = <String>[];
  final tasks = decoded['tasks'];
  if (tasks is List) {
    for (final item in tasks) {
      if (item is Map) workers.add(_workerLine(item, prefix: 'Worker'));
    }
  }
  final chain = decoded['chain'];
  if (chain is List) {
    var step = 0;
    for (final item in chain) {
      step++;
      if (item is! Map) continue;
      final parallel = item['parallel'];
      if (parallel is List) {
        var branch = 0;
        for (final child in parallel) {
          branch++;
          if (child is Map) {
            workers.add(
              _workerLine(child, prefix: 'Chain step $step, worker $branch'),
            );
          }
        }
      } else {
        workers.add(_workerLine(item, prefix: 'Chain step $step'));
      }
    }
  }
  if (workers.isEmpty &&
      (_text(decoded['agent']) != null || _text(decoded['task']) != null)) {
    workers.add(_workerLine(decoded, prefix: 'Worker'));
  }

  final count = _subagentCount(decoded, workers.length);
  final label = '$count subagent${count == 1 ? '' : 's'}';
  return _SubagentSummary(
    label: label,
    details: workers.isEmpty
        ? const <String>['Execution details unavailable.']
        : List<String>.unmodifiable(workers),
  );
}

const _maxSubagentJsonLength = 16 * 1024;

Map<String, Object?>? _decodeArguments(String? arguments) {
  if (arguments == null || arguments.length > _maxSubagentJsonLength) {
    return null;
  }
  try {
    final value = jsonDecode(arguments);
    if (value is! Map) return null;
    return <String, Object?>{
      for (final entry in value.entries)
        if (entry.key is String) entry.key as String: entry.value,
    };
  } catch (_) {
    return null;
  }
}

List<String> _subagentOutputDetails(String? output) {
  if (output == null || output.trim().isEmpty) return const <String>[];

  final decoded = _decodeJson(output);
  if (decoded == null) {
    return <String>['Output: ${_shorten(output.trim())}'];
  }

  final readable = <String>[];
  _appendOutputSummary(decoded, readable);
  if (readable.isEmpty) {
    return const <String>['Output: Structured result received.'];
  }
  return <String>['Output: ${readable.first}', ...readable.skip(1)];
}

Object? _decodeJson(String value) {
  if (value.length > _maxSubagentJsonLength) return null;
  try {
    return jsonDecode(value);
  } catch (_) {
    return null;
  }
}

void _appendOutputSummary(Object? value, List<String> lines) {
  if (lines.length >= 8) return;
  if (value is String) {
    final text = value.trim();
    if (text.isNotEmpty) lines.add(_shorten(text));
    return;
  }
  if (value is List) {
    for (final child in value) {
      if (lines.length >= 8) break;
      final summary = _childSummary(child);
      if (summary != null) lines.add(summary);
    }
    return;
  }
  if (value is! Map) return;

  final status = _outputField(value, const ['status', 'state', 'phase']);
  if (status != null) lines.add('Status: ${_shorten(status)}');
  final text = _outputField(value, const [
    'text',
    'message',
    'summary',
    'description',
    'content',
  ]);
  if (text != null) lines.add(_shorten(text));
  final directOutput = value['output'];
  if (directOutput is String && directOutput.trim().isNotEmpty) {
    lines.add(_shorten(directOutput.trim()));
  } else if (directOutput is Map || directOutput is List) {
    _appendOutputSummary(directOutput, lines);
  }

  for (final key in const ['children', 'workers', 'results']) {
    final children = value[key];
    if (children is! List) continue;
    for (final child in children) {
      if (lines.length >= 8) break;
      final summary = _childSummary(child);
      if (summary != null) lines.add(summary);
    }
  }
  final result = value['result'];
  if (lines.length < 8 && (result is Map || result is List || result is String)) {
    _appendOutputSummary(result, lines);
  }
}

String? _outputField(Map value, List<String> keys) {
  for (final key in keys) {
    final field = value[key];
    if (field is String && field.trim().isNotEmpty) return field.trim();
  }
  return null;
}

String? _childSummary(Object? child) {
  if (child is! Map) return child is String ? _shorten(child.trim()) : null;
  final agent = _text(child['agent']) ??
      _text(child['subagent_type']) ??
      _text(child['name']);
  final status = _outputField(child, const ['status', 'state', 'phase']);
  final text = _outputField(child, const [
    'text',
    'message',
    'summary',
    'description',
    'content',
  ]);
  final parts = <String>[
    if (agent != null) agent,
    if (status != null) 'status ${_shorten(status)}',
    if (text != null) _shorten(text),
  ];
  return parts.isEmpty ? null : 'Child: ${parts.join(' · ')}';
}

int _subagentCount(Map<String, Object?> args, int readableWorkers) {
  int countItems(Object? value) {
    if (value is! List) return 0;
    var total = 0;
    for (final item in value) {
      if (item is Map) {
        final repeat = item['count'];
        total += repeat is int && repeat > 0 ? repeat : 1;
      }
    }
    return total;
  }

  final tasks = countItems(args['tasks']);
  if (tasks > 0) return tasks > 99 ? 99 : tasks;
  final chain = args['chain'];
  if (chain is List) {
    var total = 0;
    for (final item in chain) {
      if (item is Map && item['parallel'] is List) {
        total += countItems(item['parallel']);
      } else if (item is Map) {
        final repeat = item['count'];
        total += repeat is int && repeat > 0 ? repeat : 1;
      }
    }
    if (total > 0) return total > 99 ? 99 : total;
  }
  if (readableWorkers <= 0) return 1;
  return readableWorkers > 99 ? 99 : readableWorkers;
}

String _workerLine(Map item, {required String prefix}) {
  final agent = _text(item['agent']) ??
      _text(item['subagent_type']) ??
      _text(item['name']);
  final model = _text(item['model']);
  final task = _text(item['task']) ?? _text(item['description']);
  final fields = <String>[
    if (agent != null) 'agent $agent',
    if (model != null) 'model $model',
    if (task != null) 'task ${_shorten(task)}',
  ];
  return '$prefix${fields.isEmpty ? '' : ': ${fields.join(' · ')}'}';
}

String? _text(Object? value) => value is String && value.trim().isNotEmpty
    ? _shorten(value.trim())
    : null;

String _shorten(String value) =>
    value.length <= 120 ? value : '${value.substring(0, 117)}…';

String _statusLabel(RecipeActivityStatus status) => switch (status) {
  RecipeActivityStatus.pending => 'Pending',
  RecipeActivityStatus.running => 'Running',
  RecipeActivityStatus.completed => 'Completed',
  RecipeActivityStatus.failed => 'Failed',
  RecipeActivityStatus.cancelled => 'Cancelled',
};
IconData _statusIcon(RecipeActivityStatus status) => switch (status) {
  RecipeActivityStatus.pending => Icons.schedule,
  RecipeActivityStatus.running => Icons.sync,
  RecipeActivityStatus.completed => Icons.check_circle_outline,
  RecipeActivityStatus.failed => Icons.error_outline,
  RecipeActivityStatus.cancelled => Icons.cancel_outlined,
};
Color _statusColor(ColorScheme scheme, RecipeActivityStatus status) =>
    switch (status) {
      RecipeActivityStatus.pending => scheme.onSurfaceVariant,
      RecipeActivityStatus.running => scheme.primary,
      RecipeActivityStatus.completed => scheme.tertiary,
      RecipeActivityStatus.failed => scheme.error,
      RecipeActivityStatus.cancelled => scheme.onSurfaceVariant,
    };
