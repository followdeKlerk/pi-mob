import 'package:flutter/material.dart';

typedef _Json = Map<String, Object?>;

enum MobileProcessAction { stop, restart, rerun }

enum MobileProcessStatus { running, completed, failed, stopped }

enum MobileProcessPortProtocol { tcp, udp }

enum MobileProcessStream { stdout, stderr }

enum MobileCapabilityState { available, degraded, unavailable, stale }

class MobileProcessPort {
  const MobileProcessPort({required this.port, required this.protocol});

  final int port;
  final MobileProcessPortProtocol protocol;
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
  final MobileProcessStream stream;
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

  final MobileCapabilityState state;
  final String? reason;
  final String? remediation;
  final String? source;
  final String? revision;
}

class MobileProcessError {
  const MobileProcessError({
    required this.code,
    required this.message,
    required this.retryable,
  });

  final String code;
  final String message;
  final bool retryable;
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
    this.error,
  });

  final String sessionId;
  final String processId;
  final String revision;
  final MobileProcessStatus status;
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
  final MobileProcessError? error;

  bool get available => unavailableStatus == null;

  bool supports(MobileProcessAction action) =>
      available && !stale && supportedActions.contains(action);

  MobileProcess copyWith({
    String? revision,
    MobileProcessStatus? status,
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
    Object? error = _sentinel,
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
    exitCode: identical(exitCode, _sentinel) ? this.exitCode : exitCode as int?,
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
    error: identical(error, _sentinel)
        ? this.error
        : error as MobileProcessError?,
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

ProcessDomainState reduceProcess(
  ProcessDomainState state,
  Map<String, Object?> envelope, {
  String? requestedSessionId,
}) {
  final type = envelope['type'];
  final payload = _asJson(envelope['payload']);
  if (type is! String || payload == null) return state;

  switch (type) {
    case 'process.snapshot':
      final snapshot = _parseSnapshot(payload);
      return snapshot == null ? state : _upsertSnapshot(state, snapshot);
    case 'process.snapshot.result':
      if (requestedSessionId == null) return state;
      final parsed = _parseSnapshotResult(payload, requestedSessionId);
      return parsed == null
          ? state
          : _replaceSession(state, requestedSessionId, parsed.items);
    case 'process.output':
    case 'process.output.page.result':
      final output = _parseOutput(payload);
      return output == null ? state : _applyOutput(state, output);
    case 'process.unavailable':
      final parsed = _parseUnavailable(payload);
      return parsed == null
          ? state
          : _applyUnavailable(state, parsed.sessionId, parsed.status);
    case 'process.error':
      final parsed = _parseErrorPayload(payload);
      return parsed == null ? state : _applyError(state, parsed);
    default:
      return state;
  }
}

class _UnavailablePayload {
  const _UnavailablePayload({required this.sessionId, required this.status});

  final String sessionId;
  final MobileCapabilityStatus status;
}

class _SnapshotResultPayload {
  const _SnapshotResultPayload({required this.items});

  final List<MobileProcess> items;
}

class _ProcessErrorPayload {
  const _ProcessErrorPayload({
    required this.sessionId,
    required this.processId,
    required this.revision,
    required this.error,
  });

  final String sessionId;
  final String processId;
  final String revision;
  final MobileProcessError error;
}

ProcessDomainState _upsertSnapshot(
  ProcessDomainState state,
  MobileProcess snapshot,
) {
  final unavailableBySession = Map<String, MobileCapabilityStatus>.from(
    state.unavailableBySession,
  )..remove(snapshot.sessionId);
  final next = <MobileProcess>[];
  var replaced = false;
  for (final item in state.items) {
    if (item.sessionId == snapshot.sessionId &&
        item.processId == snapshot.processId) {
      final keepRevisionState = item.revision == snapshot.revision;
      next.add(
        snapshot.copyWith(
          stdout: keepRevisionState ? item.stdout : null,
          stderr: keepRevisionState ? item.stderr : null,
          error: keepRevisionState ? item.error : null,
        ),
      );
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

ProcessDomainState _replaceSession(
  ProcessDomainState state,
  String sessionId,
  List<MobileProcess> snapshots,
) {
  final retained = state.items
      .where((item) => item.sessionId != sessionId)
      .toList(growable: true);
  final unavailableBySession = Map<String, MobileCapabilityStatus>.from(
    state.unavailableBySession,
  )..remove(sessionId);
  final deduped = <String, MobileProcess>{};
  for (final snapshot in snapshots) {
    deduped['${snapshot.sessionId}:${snapshot.processId}'] = snapshot;
  }
  for (final snapshot in deduped.values) {
    final current = state.items.where(
      (item) =>
          item.sessionId == snapshot.sessionId &&
          item.processId == snapshot.processId &&
          item.revision == snapshot.revision,
    );
    final existing = current.isEmpty ? null : current.first;
    retained.add(
      snapshot.copyWith(
        stdout: existing?.stdout,
        stderr: existing?.stderr,
        error: existing?.error,
      ),
    );
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
  final next = state.items
      .map((item) {
        if (item.sessionId != output.sessionId ||
            item.processId != output.processId ||
            item.revision != output.revision) {
          return item;
        }
        return output.stream == MobileProcessStream.stdout
            ? item.copyWith(stdout: output)
            : item.copyWith(stderr: output);
      })
      .toList(growable: false);
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
  final next = state.items
      .map((item) {
        if (item.sessionId != sessionId) return item;
        return item.copyWith(
          supportedActions: const <MobileProcessAction>[],
          unavailableStatus: status,
        );
      })
      .toList(growable: false);
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

ProcessDomainState _applyError(
  ProcessDomainState state,
  _ProcessErrorPayload payload,
) {
  final next = state.items
      .map((item) {
        if (item.sessionId != payload.sessionId ||
            item.processId != payload.processId ||
            item.revision != payload.revision) {
          return item;
        }
        return item.copyWith(error: payload.error);
      })
      .toList(growable: false);
  return ProcessDomainState(
    items: List<MobileProcess>.unmodifiable(next),
    unavailableBySession: state.unavailableBySession,
  );
}

MobileProcess? _parseSnapshot(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final processId = _string(payload['processId']);
  final revision = _string(payload['revision']);
  final status = _parseProcessStatus(payload['status']);
  final command = _string(payload['command']);
  final startedAt = _dateTime(payload['startedAt']);
  final capability = _string(payload['capability']);
  final stale = payload['stale'];
  final actions = _parseActions(payload['supportedActions']);
  final ports = _parsePorts(payload['ports']);
  if (sessionId == null ||
      processId == null ||
      revision == null ||
      status == null ||
      command == null ||
      command.isEmpty ||
      startedAt == null ||
      capability != 'runtime.processes.v1' ||
      stale is! bool ||
      actions == null ||
      ports == null) {
    return null;
  }
  final pid = payload['pid'];
  final durationMs = payload['durationMs'];
  final exitCode = payload['exitCode'];
  if (pid != null && (pid is! int || pid < 1)) return null;
  if (durationMs != null && (durationMs is! int || durationMs < 0)) return null;
  if (exitCode != null && exitCode is! int) return null;
  return MobileProcess(
    sessionId: sessionId,
    processId: processId,
    revision: revision,
    status: status,
    command: command,
    startedAt: startedAt,
    capability: capability!,
    stale: stale,
    supportedActions: actions,
    turnId: _nonEmptyString(payload['turnId']),
    toolCallId: _nonEmptyString(payload['toolCallId']),
    pid: pid as int?,
    cwd: _nonEmptyString(payload['cwd']),
    finishedAt: _optionalDateTime(payload['finishedAt']),
    durationMs: durationMs as int?,
    exitCode: exitCode as int?,
    signal: _nonEmptyString(payload['signal']),
    ports: ports,
  );
}

_SnapshotResultPayload? _parseSnapshotResult(
  _Json payload,
  String requestedSessionId,
) {
  if (payload.keys.any((key) => key != 'items')) return null;
  final rawItems = payload['items'];
  if (rawItems is! List) return null;
  final items = <MobileProcess>[];
  for (final raw in rawItems) {
    final item = _asJson(raw);
    final parsed = item == null ? null : _parseSnapshot(item);
    if (parsed == null || parsed.sessionId != requestedSessionId) return null;
    items.add(parsed);
  }
  return _SnapshotResultPayload(items: items);
}

MobileProcessOutput? _parseOutput(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final processId = _string(payload['processId']);
  final revision = _string(payload['revision']);
  final stream = _parseStream(payload['stream']);
  final content = _string(payload['content']);
  final truncation = _asJson(payload['truncation']);
  if (sessionId == null ||
      processId == null ||
      revision == null ||
      stream == null ||
      content == null ||
      content.length > 262144 ||
      truncation == null) {
    return null;
  }
  final parsedTruncation = _parseTruncation(truncation);
  final cursor = payload.containsKey('cursor')
      ? _nonEmptyString(payload['cursor'])
      : _string(payload['cursor']);
  final pageToken = payload.containsKey('pageToken')
      ? _nonEmptyString(payload['pageToken'])
      : _string(payload['pageToken']);
  if (parsedTruncation == null) return null;
  if (payload.containsKey('cursor') && cursor == null) return null;
  if (payload.containsKey('pageToken') && pageToken == null) return null;
  return MobileProcessOutput(
    sessionId: sessionId,
    processId: processId,
    revision: revision,
    stream: stream,
    content: content,
    truncation: parsedTruncation,
    cursor: cursor,
    pageToken: pageToken,
  );
}

_UnavailablePayload? _parseUnavailable(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final capability = _string(payload['capability']);
  final status = _asJson(payload['status']);
  if (sessionId == null ||
      capability != 'runtime.processes.v1' ||
      status == null) {
    return null;
  }
  final parsedStatus = _parseStatus(status);
  if (parsedStatus == null) return null;
  return _UnavailablePayload(sessionId: sessionId, status: parsedStatus);
}

_ProcessErrorPayload? _parseErrorPayload(_Json payload) {
  final sessionId = _string(payload['sessionId']);
  final processId = _string(payload['processId']);
  final revision = _string(payload['revision']);
  final error = _asJson(payload['error']);
  if (sessionId == null ||
      processId == null ||
      revision == null ||
      error == null) {
    return null;
  }
  final parsedError = _parseError(error);
  if (parsedError == null) return null;
  return _ProcessErrorPayload(
    sessionId: sessionId,
    processId: processId,
    revision: revision,
    error: parsedError,
  );
}

MobileCapabilityStatus? _parseStatus(_Json payload) {
  final state = _parseCapabilityState(payload['state']);
  if (state == null) return null;
  final reason = _string(payload['reason']);
  final remediation = _string(payload['remediation']);
  if (state != MobileCapabilityState.available &&
      (reason == null ||
          reason.isEmpty ||
          remediation == null ||
          remediation.isEmpty)) {
    return null;
  }
  return MobileCapabilityStatus(
    state: state,
    reason: reason,
    remediation: remediation,
    source: _nonEmptyString(payload['source']),
    revision: _nonEmptyString(payload['revision']),
  );
}

MobileProcessError? _parseError(_Json payload) {
  final code = _string(payload['code']);
  final message = _string(payload['message']);
  final retryable = payload['retryable'];
  if (code == null ||
      message == null ||
      message.isEmpty ||
      retryable is! bool) {
    return null;
  }
  switch (code) {
    case 'process_unavailable':
    case 'process_not_found':
    case 'process_stale':
    case 'process_failed':
      return MobileProcessError(
        code: code,
        message: message,
        retryable: retryable,
      );
    default:
      return null;
  }
}

MobileProcessTruncation? _parseTruncation(_Json payload) {
  final retainedBytes = payload['retainedBytes'];
  final totalBytes = payload['totalBytes'];
  final isTruncated = payload['isTruncated'];
  final digest = payload['digest'];
  if (retainedBytes is! int ||
      totalBytes is! int ||
      retainedBytes < 0 ||
      totalBytes < 0 ||
      retainedBytes > totalBytes ||
      isTruncated is! bool ||
      (digest != null && digest is! String)) {
    return null;
  }
  return MobileProcessTruncation(
    retainedBytes: retainedBytes,
    totalBytes: totalBytes,
    isTruncated: isTruncated,
    digest: digest as String?,
  );
}

List<MobileProcessPort>? _parsePorts(Object? raw) {
  if (raw is! List) return const <MobileProcessPort>[];
  final ports = <MobileProcessPort>[];
  if (raw.length > 32) return null;
  for (final item in raw) {
    final payload = _asJson(item);
    final protocol = payload == null
        ? null
        : _parsePortProtocol(payload['protocol']);
    final port = payload?['port'];
    if (payload == null ||
        protocol == null ||
        port is! int ||
        port < 1 ||
        port > 65535) {
      return null;
    }
    ports.add(MobileProcessPort(port: port, protocol: protocol));
  }
  return List<MobileProcessPort>.unmodifiable(ports);
}

List<MobileProcessAction>? _parseActions(Object? raw) {
  if (raw is! List) return const <MobileProcessAction>[];
  if (raw.length > 3) return null;
  final result = <MobileProcessAction>[];
  final seen = <MobileProcessAction>{};
  for (final item in raw) {
    final action = switch (item) {
      'stop' => MobileProcessAction.stop,
      'restart' => MobileProcessAction.restart,
      'rerun' => MobileProcessAction.rerun,
      _ => null,
    };
    if (action == null || !seen.add(action)) return null;
    result.add(action);
  }
  return List<MobileProcessAction>.unmodifiable(result);
}

MobileProcessStatus? _parseProcessStatus(Object? raw) => switch (raw) {
  'running' => MobileProcessStatus.running,
  'completed' => MobileProcessStatus.completed,
  'failed' => MobileProcessStatus.failed,
  'stopped' => MobileProcessStatus.stopped,
  _ => null,
};

MobileProcessStream? _parseStream(Object? raw) => switch (raw) {
  'stdout' => MobileProcessStream.stdout,
  'stderr' => MobileProcessStream.stderr,
  _ => null,
};

MobileProcessPortProtocol? _parsePortProtocol(Object? raw) => switch (raw) {
  'tcp' => MobileProcessPortProtocol.tcp,
  'udp' => MobileProcessPortProtocol.udp,
  _ => null,
};

MobileCapabilityState? _parseCapabilityState(Object? raw) => switch (raw) {
  'available' => MobileCapabilityState.available,
  'degraded' => MobileCapabilityState.degraded,
  'unavailable' => MobileCapabilityState.unavailable,
  'stale' => MobileCapabilityState.stale,
  _ => null,
};

String? _string(Object? value) => value is String ? value : null;
String? _nonEmptyString(Object? value) =>
    value is String && value.isNotEmpty ? value : null;

DateTime? _dateTime(Object? value) {
  final text = _nonEmptyString(value);
  if (text == null) return null;
  return DateTime.tryParse(text)?.toUtc();
}

DateTime? _optionalDateTime(Object? value) {
  if (value == null) return null;
  return _dateTime(value);
}

_Json? _asJson(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
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
  final parts = <String>[process.status.name];
  if (process.pid != null) parts.add('PID ${process.pid}');
  if (process.stale) parts.add('stale');
  if (!process.available) parts.add('actions unavailable');
  if (process.error != null) parts.add(process.error!.code);
  return parts.join(' · ');
}
