import 'package:flutter/material.dart';

typedef _Json = Map<String, Object?>;

enum MobileProcessAction { stop, restart, rerun }

class MobileProcessPort {
  const MobileProcessPort({required this.port, required this.protocol});

  final int port;
  final String protocol;
}

class MobileProcessTruncation {
  const MobileProcessTruncation({
    required this.retainedBytes,
    required this.totalBytes,
    required this.isTruncated,
    this.digest,
  });

  final int retainedBytes;
  final int totalBytes;
  final bool isTruncated;
  final String? digest;
}

class MobileProcessOutput {
  const MobileProcessOutput({
    required this.sessionId,
    required this.processId,
    required this.revision,
    required this.stream,
    required this.content,
    required this.truncation,
    this.cursor,
    this.pageToken,
  });

  final String sessionId;
  final String processId;
  final String revision;
  final String stream;
  final String content;
  final MobileProcessTruncation truncation;
  final String? cursor;
  final String? pageToken;
}

class MobileCapabilityStatus {
  const MobileCapabilityStatus({
    required this.state,
    this.reason,
    this.remediation,
    this.source,
    this.revision,
  });

  final String state;
  final String? reason;
  final String? remediation;
  final String? source;
  final String? revision;
}

class MobileProcess {
  const MobileProcess({
    required this.sessionId,
    required this.processId,
    required this.revision,
    required this.status,
    required this.command,
    required this.startedAt,
    required this.capability,
    required this.stale,
    this.supportedActions = const <MobileProcessAction>[],
    this.turnId,
    this.toolCallId,
    this.pid,
    this.cwd,
    this.finishedAt,
    this.durationMs,
    this.exitCode,
    this.signal,
    this.ports = const <MobileProcessPort>[],
    this.stdout,
    this.stderr,
    this.unavailableStatus,
  });

  final String sessionId;
  final String processId;
  final String revision;
  final String status;
  final String command;
  final DateTime startedAt;
  final String capability;
  final bool stale;
  final List<MobileProcessAction> supportedActions;
  final String? turnId;
  final String? toolCallId;
  final int? pid;
  final String? cwd;
  final DateTime? finishedAt;
  final int? durationMs;
  final int? exitCode;
  final String? signal;
  final List<MobileProcessPort> ports;
  final MobileProcessOutput? stdout;
  final MobileProcessOutput? stderr;
  final MobileCapabilityStatus? unavailableStatus;

  bool get available => unavailableStatus == null;

  bool supports(MobileProcessAction action) =>
      available && !stale && supportedActions.contains(action);

  MobileProcess copyWith({
    String? revision,
    String? status,
    String? command,
    DateTime? startedAt,
    String? capability,
    bool? stale,
    List<MobileProcessAction>? supportedActions,
    Object? turnId = _sentinel,
    Object? toolCallId = _sentinel,
    Object? pid = _sentinel,
    Object? cwd = _sentinel,
    Object? finishedAt = _sentinel,
    Object? durationMs = _sentinel,
    Object? exitCode = _sentinel,
    Object? signal = _sentinel,
    List<MobileProcessPort>? ports,
    Object? stdout = _sentinel,
    Object? stderr = _sentinel,
    Object? unavailableStatus = _sentinel,
  }) => MobileProcess(
    sessionId: sessionId,
    processId: processId,
    revision: revision ?? this.revision,
    status: status ?? this.status,
    command: command ?? this.command,
    startedAt: startedAt ?? this.startedAt,
    capability: capability ?? this.capability,
    stale: stale ?? this.stale,
    supportedActions: supportedActions ?? this.supportedActions,
    turnId: identical(turnId, _sentinel) ? this.turnId : turnId as String?,
    toolCallId: identical(toolCallId, _sentinel)
        ? this.toolCallId
        : toolCallId as String?,
    pid: identical(pid, _sentinel) ? this.pid : pid as int?,
    cwd: identical(cwd, _sentinel) ? this.cwd : cwd as String?,
    finishedAt: identical(finishedAt, _sentinel)
        ? this.finishedAt
        : finishedAt as DateTime?,
    durationMs: identical(durationMs, _sentinel)
        ? this.durationMs
        : durationMs as int?,
    exitCode: identical(exitCode, _sentinel)
        ? this.exitCode
        : exitCode as int?,
    signal: identical(signal, _sentinel) ? this.signal : signal as String?,
    ports: ports ?? this.ports,
    stdout: identical(stdout, _sentinel)
        ? this.stdout
        : stdout as MobileProcessOutput?,
    stderr: identical(stderr, _sentinel)
        ? this.stderr
        : stderr as MobileProcessOutput?,
    unavailableStatus: identical(unavailableStatus, _sentinel)
        ? this.unavailableStatus
        : unavailableStatus as MobileCapabilityStatus?,
  );
}

class ProcessDomainState {
  const ProcessDomainState({
    this.items = const <MobileProcess>[],
    this.unavailableBySession = const <String, MobileCapabilityStatus>{},
  });

  final List<MobileProcess> items;
  final Map<String, MobileCapabilityStatus> unavailableBySession;

  bool get unavailable => unavailableBySession.isNotEmpty;
}

ProcessDomainState reduceProcess(ProcessDomainState state, Map<String, Object?> envelope) {
  final type = envelope['type'];
  final payload = _asJson(envelope['payload']);
  if (type is! String || payload == null) return state;

  switch (type) {
    case 'process.snapshot':
      final snapshot = _parseSnapshot(payload);
      return snapshot == null ? state : _upsertSnapshot(state, snapshot);
    case 'process.snapshot.result':
      final rawItems = payload['items'];
      if (rawItems is! List) return state;
      final snapshots = rawItems.map(_asJson).whereType<_Json>().map(_parseSnapshot).whereType<MobileProcess>().toList(growable: false);
      return snapshots.isEmpty ? state : _replaceSessions(state, snapshots);
    case 'process.output':
    case 'process.output.page.result':
      final output = _parseOutput(payload);
      return output == null ? state : _applyOutput(state, output);
    case 'process.unavailable':
      final parsed = _parseUnavailable(payload);
      return parsed == null ? state : _applyUnavailable(state, parsed.sessionId, parsed.status);
    default:
      return state;
  }
}

class _UnavailablePayload {
  const _UnavailablePayload({required this.sessionId, required this.status});

  final String sessionId;
  final MobileCapabilityStatus status;
}

ProcessDomainState _upsertSnapshot(ProcessDomainState state, MobileProcess snapshot) {
  final unavailableBySession = Map<String, MobileCapabilityStatus>.from(state.unavailableBySession)
    ..remove(snapshot.sessionId);
  final next = <MobileProcess>[];
  var replaced = false;
  for (final item in state.items) {
    if (item.sessionId == snapshot.sessionId && item.processId == snapshot.processId) {
      final keepOutput = item.revision == snapshot.revision;
      next.add(snapshot.copyWith(
        stdout: keepOutput ? item.stdout : null,
        stderr: keepOutput ? item.stderr : null,
      ));
      replaced = true;
    } else {
      next.add(item);
    }
  }
  if (!replaced) next.add(snapshot);
  return ProcessDomainState(
    items: List<MobileProcess>.unmodifiable(next),
    unavailableBySession: Map<String, MobileCapabilityStatus>.unmodifiable(
      unavailableBySession,
    ),
  );
}

ProcessDomainState _replaceSessions(
  ProcessDomainState state,
  List<MobileProcess> snapshots,
) {
  final sessionIds = snapshots.map((item) => item.sessionId).toSet();
  final retained = state.items
      .where((item) => !sessionIds.contains(item.sessionId))
      .toList(growable: true);
  final unavailableBySession = Map<String, MobileCapabilityStatus>.from(
    state.unavailableBySession,
  )..removeWhere((key, _) => sessionIds.contains(key));
  for (final snapshot in snapshots) {
    final existing = state.items.where(
      (item) =>
          item.sessionId == snapshot.sessionId &&
          item.processId == snapshot.processId &&
          item.revision == snapshot.revision,
    );
    final current = existing.isEmpty ? null : existing.first;
    retained.add(snapshot.copyWith(stdout: current?.stdout, stderr: current?.stderr));
  }
  return ProcessDomainState(
    items: List<MobileProcess>.unmodifiable(retained),
    unavailableBySession: Map<String, MobileCapabilityStatus>.unmodifiable(
      unavailableBySession,
    ),
  );
}

ProcessDomainState _applyOutput(
  ProcessDomainState state,
  MobileProcessOutput output,
) {
  final next = state.items.map((item) {
    if (item.sessionId != output.sessionId ||
        item.processId != output.processId ||
        item.revision != output.revision) {
      return item;
    }
    return output.stream == 'stdout'
        ? item.copyWith(stdout: output)
        : item.copyWith(stderr: output);
  }).toList(growable: false);
  return ProcessDomainState(
    items: List<MobileProcess>.unmodifiable(next),
    unavailableBySession: state.unavailableBySession,
  );
}

ProcessDomainState _applyUnavailable(
  ProcessDomainState state,
  String sessionId,
  MobileCapabilityStatus status,
) {
  final next = state.items.map((item) {
    if (item.sessionId != sessionId) return item;
    return item.copyWith(
      supportedActions: const <MobileProcessAction>[],
      unavailableStatus: status,
    );
  }).toList(growable: false);
  final unavailableBySession = Map<String, MobileCapabilityStatus>.from(
    state.unavailableBySession,
  )..[sessionId] = status;
  return ProcessDomainState(
    items: List<MobileProcess>.unmodifiable(next),
    unavailableBySession: Map<String, MobileCapabilityStatus>.unmodifiable(
      unavailableBySession,
    ),
  );
}

MobileProcess? _parseSnapshot(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final processId = _string(payload['processId']);
  final revision = _string(payload['revision']);
  final status = _string(payload['status']);
  final command = _string(payload['command']);
  final startedAt = _dateTime(payload['startedAt']);
  final capability = _string(payload['capability']);
  final stale = payload['stale'];
  if (sessionId == null ||
      processId == null ||
      revision == null ||
      status == null ||
      command == null ||
      startedAt == null ||
      capability != 'runtime.processes.v1' ||
      stale is! bool) {
    return null;
  }
  return MobileProcess(
    sessionId: sessionId,
    processId: processId,
    revision: revision,
    status: status,
    command: command,
    startedAt: startedAt,
    capability: capability!,
    stale: stale,
    supportedActions: _parseActions(payload['supportedActions']),
    turnId: _string(payload['turnId']),
    toolCallId: _string(payload['toolCallId']),
    pid: payload['pid'] is int ? payload['pid'] as int : null,
    cwd: _string(payload['cwd']),
    finishedAt: _dateTime(payload['finishedAt']),
    durationMs: payload['durationMs'] is int ? payload['durationMs'] as int : null,
    exitCode: payload['exitCode'] is int ? payload['exitCode'] as int : null,
    signal: _string(payload['signal']),
    ports: _parsePorts(payload['ports']),
  );
}

MobileProcessOutput? _parseOutput(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final processId = _string(payload['processId']);
  final revision = _string(payload['revision']);
  final stream = _string(payload['stream']);
  final content = _string(payload['content']);
  final truncation = _asJson(payload['truncation']);
  if (sessionId == null ||
      processId == null ||
      revision == null ||
      (stream != 'stdout' && stream != 'stderr') ||
      content == null ||
      truncation == null) {
    return null;
  }
  final parsedTruncation = _parseTruncation(truncation);
  if (parsedTruncation == null) return null;
  return MobileProcessOutput(
    sessionId: sessionId,
    processId: processId,
    revision: revision,
    stream: stream!,
    content: content,
    truncation: parsedTruncation,
    cursor: _string(payload['cursor']),
    pageToken: _string(payload['pageToken']),
  );
}

_UnavailablePayload? _parseUnavailable(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final capability = _string(payload['capability']);
  final status = _asJson(payload['status']);
  if (sessionId == null || capability != 'runtime.processes.v1' || status == null) {
    return null;
  }
  final parsedStatus = _parseStatus(status);
  if (parsedStatus == null) return null;
  return _UnavailablePayload(sessionId: sessionId, status: parsedStatus);
}

MobileCapabilityStatus? _parseStatus(_Json payload) {
  final state = _string(payload['state']);
  if (state == null) return null;
  return MobileCapabilityStatus(
    state: state,
    reason: _string(payload['reason']),
    remediation: _string(payload['remediation']),
    source: _string(payload['source']),
    revision: _string(payload['revision']),
  );
}

MobileProcessTruncation? _parseTruncation(_Json payload) {
  final retainedBytes = payload['retainedBytes'];
  final totalBytes = payload['totalBytes'];
  final isTruncated = payload['isTruncated'];
  if (retainedBytes is! int || totalBytes is! int || isTruncated is! bool) {
    return null;
  }
  return MobileProcessTruncation(
    retainedBytes: retainedBytes,
    totalBytes: totalBytes,
    isTruncated: isTruncated,
    digest: _string(payload['digest']),
  );
}

List<MobileProcessPort> _parsePorts(Object? raw) {
  if (raw is! List) return const <MobileProcessPort>[];
  return raw
      .map(_asJson)
      .whereType<_Json>()
      .map((payload) {
        final port = payload['port'];
        final protocol = _string(payload['protocol']);
        if (port is! int || protocol == null) return null;
        return MobileProcessPort(port: port, protocol: protocol);
      })
      .whereType<MobileProcessPort>()
      .toList(growable: false);
}

List<MobileProcessAction> _parseActions(Object? raw) {
  if (raw is! List) return const <MobileProcessAction>[];
  final result = <MobileProcessAction>[];
  for (final item in raw) {
    if (item == 'stop') result.add(MobileProcessAction.stop);
    if (item == 'restart') result.add(MobileProcessAction.restart);
    if (item == 'rerun') result.add(MobileProcessAction.rerun);
  }
  return List<MobileProcessAction>.unmodifiable(result);
}

String? _string(Object? value) => value is String ? value : null;

DateTime? _dateTime(Object? value) {
  final text = _string(value);
  if (text == null) return null;
  return DateTime.tryParse(text)?.toUtc();
}

_Json? _asJson(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    return value.map(
      (key, item) => MapEntry(key.toString(), item),
    );
  }
  return null;
}

const _sentinel = Object();

class ProcessSheet extends StatelessWidget {
  const ProcessSheet({
    super.key,
    required this.state,
    required this.onStop,
    required this.onRestart,
    required this.onRerun,
  });

  final ProcessDomainState state;
  final void Function(MobileProcess) onStop;
  final void Function(MobileProcess) onRestart;
  final void Function(MobileProcess) onRerun;

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      ...state.unavailableBySession.entries.map(
        (entry) => ListTile(
          title: const Text('Processes unavailable'),
          subtitle: Text(
            entry.value.reason ?? 'The host did not provide process metadata.',
          ),
        ),
      ),
      ...state.items.map(
        (process) => ListTile(
          title: Text(process.command),
          subtitle: Text(_subtitle(process)),
          trailing: Wrap(
            children: [
              if (process.supports(MobileProcessAction.stop))
                IconButton(
                  onPressed: () => onStop(process),
                  icon: const Icon(Icons.stop),
                ),
              if (process.supports(MobileProcessAction.restart))
                IconButton(
                  onPressed: () => onRestart(process),
                  icon: const Icon(Icons.refresh),
                ),
              if (process.supports(MobileProcessAction.rerun))
                IconButton(
                  onPressed: () => onRerun(process),
                  icon: const Icon(Icons.replay),
                ),
            ],
          ),
        ),
      ),
    ],
  );
}

String _subtitle(MobileProcess process) {
  final parts = <String>[process.status];
  if (process.pid != null) parts.add('PID ${process.pid}');
  if (process.stale) parts.add('stale');
  if (!process.available) parts.add('actions unavailable');
  return parts.join(' · ');
}
