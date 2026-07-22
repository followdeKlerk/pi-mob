import 'dart:convert';
import 'dart:typed_data';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

const _uuidPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const _cursorPattern = r'^(0|[1-9][0-9]*)$';
const _timestampPattern = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$';
final RegExp _uuid = RegExp(_uuidPattern);
final RegExp _cursor = RegExp(_cursorPattern);
final RegExp _timestamp = RegExp(_timestampPattern);
final RegExp _optionalEventType = RegExp(
  r'^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$',
);
final RegExp _streamId = RegExp(
  '^(?:host|session):${_uuidPattern.substring(1, _uuidPattern.length - 1)}\$',
);

class ProtocolValidationException implements FormatException {
  ProtocolValidationException(this.path, this.expected, this.actual);
  final String path;
  final String expected;
  final Object? actual;

  @override
  String get message => '$path: expected $expected, got $actual';

  @override
  int? get offset => null;

  @override
  Object? get source => actual;

  @override
  String toString() => 'ProtocolValidationException($message)';
}

sealed class ProtocolEnvelope {
  ProtocolEnvelope({required this.type, required Map<String, Object?> payload})
    : payload = _immutableJsonObject(payload);
  final String type;
  final Map<String, Object?> payload;
  Map<String, Object?>? _wire;

  Map<String, Object?> toJson() =>
      _wire ??
      _immutableJsonObject(<String, Object?>{'type': type, 'payload': payload});

  factory ProtocolEnvelope.fromJson(Map<String, Object?> json) {
    _requireEnvelope(json);
    final type = _string(json, 'type');
    if (type == 'hello') return ProtocolHello._fromEnvelope(json);
    if (type == 'error') return ProtocolError._fromEnvelope(json);
    // Envelope identity is authoritative when a type is shared by families
    // (for example workspace.file.metadata). Resolve it before consulting the
    // type registries so an event cannot be mistaken for a control request.
    if (json.containsKey('eventId') ||
        json.containsKey('streamId') ||
        json.containsKey('cursor')) {
      return ProtocolEvent._fromEnvelope(json);
    }
    if (json.containsKey('commandId') && _commandTypes.contains(type)) {
      return ProtocolCommand._fromEnvelope(json);
    }
    if (_controlTypes.contains(type)) {
      return ProtocolControl._fromEnvelope(json);
    }
    if (_responseTypes.contains(type)) {
      return ProtocolResponse._fromEnvelope(json);
    }
    if (json.containsKey('commandId')) {
      return ProtocolCommand._fromEnvelope(json);
    }
    return ProtocolResponse._fromEnvelope(json);
  }
}

Object validateProtocolFixture(String kind, Map<String, Object?> json) {
  if (kind == 'pairing') {
    if (json['kind'] != 'pi-mob-host' ||
        json['version'] != 1 ||
        json['protocolMajor'] != 1) {
      throw ProtocolValidationException(
        'pairing',
        'canonical pairing payload',
        json,
      );
    }
    _uuidString(json, 'hostId');
    _string(json, 'displayName');
    final endpoint = _string(json, 'endpoint');
    if (!endpoint.startsWith('https://')) {
      throw ProtocolValidationException('endpoint', 'https URL', endpoint);
    }
    return Map<String, Object?>.unmodifiable(json);
  }
  if (kind == 'attachment' || kind == 'export') {
    _uuidString(json, kind == 'attachment' ? 'attachmentId' : 'exportId');
    final digest = _string(json, 'sha256');
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(digest)) {
      throw ProtocolValidationException('sha256', 'lowercase SHA-256', digest);
    }
    final bytes = _nonNegativeInteger(json, 'bytes');
    if (kind == 'attachment') {
      if (bytes > 10485760) {
        throw ProtocolValidationException('bytes', '<= 10485760', bytes);
      }
      _oneOf(json, 'mimeType', const <String>{'image/jpeg', 'image/png'});
      for (final dimension in const <String>['width', 'height']) {
        if (json[dimension] != null &&
            _nonNegativeInteger(json, dimension) < 1) {
          throw ProtocolValidationException(
            dimension,
            'positive integer',
            json[dimension],
          );
        }
      }
    } else {
      _oneOf(json, 'format', const <String>{'html'});
    }
    if (!_timestamp.hasMatch(_string(json, 'expiresAt'))) {
      throw ProtocolValidationException(
        'expiresAt',
        'UTC RFC3339 timestamp',
        json['expiresAt'],
      );
    }
    return Map<String, Object?>.unmodifiable(json);
  }
  return ProtocolEnvelope.fromJson(json);
}

final class ProtocolHello extends ProtocolEnvelope {
  ProtocolHello._({
    required super.payload,
    required this.installationId,
    required this.requiredCapabilities,
    required this.optionalCapabilities,
  }) : super(type: 'hello');
  final String installationId;
  final List<String> requiredCapabilities;
  final List<String> optionalCapabilities;
  factory ProtocolHello.fromJson(Map<String, Object?> json) {
    final envelope = ProtocolEnvelope.fromJson(json);
    if (envelope is! ProtocolHello) {
      throw ProtocolValidationException('type', 'hello', envelope.type);
    }
    return envelope;
  }
  static ProtocolHello _fromEnvelope(Map<String, Object?> json) {
    _uuidString(json, 'requestId');
    final payload = _object(json, 'payload');
    if (payload['expectedHostId'] != null) {
      _uuidString(payload, 'expectedHostId');
    }
    _string(payload, 'mobileVersion');
    _string(payload, 'platform');
    final required = _strings(payload, 'requiredCapabilities');
    if (required.any((value) => !_supportedCapabilities.contains(value))) {
      throw ProtocolValidationException(
        'payload.requiredCapabilities',
        'supported capability',
        required,
      );
    }
    return _wireEnvelope(
      ProtocolHello._(
        payload: payload,
        installationId: _uuidString(payload, 'installationId'),
        requiredCapabilities: List.unmodifiable(required),
        optionalCapabilities: List.unmodifiable(
          _strings(payload, 'optionalCapabilities'),
        ),
      ),
      json,
    );
  }
}

final class ProtocolCommand extends ProtocolEnvelope {
  ProtocolCommand({
    required super.type,
    required super.payload,
    required this.commandId,
  });
  final String commandId;
  static ProtocolCommand _fromEnvelope(Map<String, Object?> json) {
    final type = _string(json, 'type');
    if (!_commandTypes.contains(type)) {
      throw ProtocolValidationException('type', 'known command type', type);
    }
    _uuidString(json, 'requestId');
    _uuidString(json, 'connectionId');
    if (!_leaseFreeCommands.contains(type)) _uuidString(json, 'leaseId');
    final payload = _object(json, 'payload');
    final pageSize = payload['pageSize'];
    if (pageSize is int && pageSize > 100) {
      throw ProtocolValidationException('payload.pageSize', '<= 100', pageSize);
    }
    final queueLength = payload['queueLength'];
    if (queueLength is int && queueLength > 10) {
      throw ProtocolValidationException(
        'payload.queueLength',
        '<= 10',
        queueLength,
      );
    }
    _validateCommandPayload(type, payload);
    return _wireEnvelope(
      ProtocolCommand(
        type: type,
        payload: payload,
        commandId: _uuidString(json, 'commandId'),
      ),
      json,
    );
  }
}

final class ProtocolControl extends ProtocolEnvelope {
  ProtocolControl._({required super.type, required super.payload});
  static ProtocolControl _fromEnvelope(Map<String, Object?> json) {
    final type = _string(json, 'type');
    _uuidString(json, 'requestId');
    _uuidString(json, 'connectionId');
    final payload = _object(json, 'payload');
    if (type == 'subscription.set') {
      final streams = _list(payload, 'streams');
      if (streams.isEmpty) {
        throw ProtocolValidationException(
          'payload.streams',
          'non-empty array',
          streams,
        );
      }
      for (final item in streams) {
        if (item is! Map) {
          throw ProtocolValidationException(
            'payload.streams',
            'stream objects',
            item,
          );
        }
        final stream = Map<String, Object?>.from(item);
        final id = _string(stream, 'streamId');
        if (!_streamId.hasMatch(id)) {
          throw ProtocolValidationException(
            'streamId',
            'host:<uuid> or session:<uuid>',
            id,
          );
        }
        _oneOf(stream, 'detail', const <String>{'full', 'summary'});
        if (stream['afterCursor'] != null) {
          DecimalCursor.parse(_string(stream, 'afterCursor'));
        }
      }
    }
    if (type == 'cursor.ack') {
      final cursors = _object(payload, 'cursors');
      for (final entry in cursors.entries) {
        if (!_streamId.hasMatch(entry.key) || entry.value is! String) {
          throw ProtocolValidationException(
            'payload.cursors',
            'stream cursor map',
            cursors,
          );
        }
        DecimalCursor.parse(entry.value as String);
      }
    }
    if (type == 'controller.renew') _uuidString(payload, 'leaseId');
    if (type == 'session.snapshot.request' || type == 'session.history.page') {
      _uuidString(payload, 'sessionId');
    }
    if (type == 'session.list') {
      _nullableString(payload, 'query');
      _string(payload, 'sort');
      _nullableString(payload, 'pageToken');
      final size = _nonNegativeInteger(payload, 'pageSize');
      if (size < 1 || size > 100) {
        throw ProtocolValidationException('pageSize', '1..100', size);
      }
    }
    if (type == 'session.history.page') {
      _nullableString(payload, 'pageToken');
      final size = _nonNegativeInteger(payload, 'pageSize');
      if (size < 1 || size > 100) {
        throw ProtocolValidationException('pageSize', '1..100', size);
      }
    }
    if (type == 'workspace.search') _stringAllowEmpty(payload, 'query');
    if (type == 'model.list' && payload['sessionId'] != null) {
      _uuidString(payload, 'sessionId');
    }
    if (type == 'command.current') _uuidString(payload, 'commandId');
    return _wireEnvelope(ProtocolControl._(type: type, payload: payload), json);
  }
}

final class ProtocolEvent extends ProtocolEnvelope {
  ProtocolEvent._({
    required super.type,
    required super.payload,
    required this.eventId,
    required this.streamId,
    required this.cursor,
  });
  final String eventId;
  final String streamId;
  final DecimalCursor cursor;
  static ProtocolEvent _fromEnvelope(Map<String, Object?> json) {
    final type = _string(json, 'type');
    final payload = _object(json, 'payload');
    if (!_eventTypes.contains(type) &&
        (payload['optional'] != true || !_optionalEventType.hasMatch(type))) {
      throw ProtocolValidationException(
        'type',
        'known or dotted optional event type',
        type,
      );
    }
    final requiredCapabilities = payload['requiredCapabilities'];
    if (requiredCapabilities != null) {
      final values = _strings(payload, 'requiredCapabilities');
      if (values.any((value) => !_supportedCapabilities.contains(value))) {
        throw ProtocolValidationException(
          'payload.requiredCapabilities',
          'supported capability',
          values,
        );
      }
    }
    final streamId = _string(json, 'streamId');
    if (!_streamId.hasMatch(streamId)) {
      throw ProtocolValidationException(
        'streamId',
        'host:<uuid> or session:<uuid>',
        streamId,
      );
    }
    final ownership = !_eventTypes.contains(type)
        ? null
        : _hostEventTypes.contains(type)
        ? 'host:'
        : _dualStreamEventTypes.contains(type)
        ? null
        : 'session:';
    if (ownership != null && !streamId.startsWith(ownership) ||
        ownership == null &&
            !streamId.startsWith('host:') &&
            !streamId.startsWith('session:')) {
      throw ProtocolValidationException(
        'streamId',
        '${ownership ?? 'host: or session:'} stream',
        streamId,
      );
    }
    _validateEventPayload(type, payload);
    return _wireEnvelope(
      ProtocolEvent._(
        type: type,
        payload: payload,
        eventId: _uuidString(json, 'eventId'),
        streamId: streamId,
        cursor: DecimalCursor.parse(_string(json, 'cursor')),
      ),
      json,
    );
  }
}

final class ProtocolResponse extends ProtocolEnvelope {
  ProtocolResponse._({required super.type, required super.payload});
  static ProtocolResponse _fromEnvelope(Map<String, Object?> json) {
    final type = _string(json, 'type');
    if (!_responseTypes.contains(type)) {
      throw ProtocolValidationException('type', 'known response type', type);
    }
    _uuidString(json, 'requestId');
    if (type == 'command.receipt') _uuidString(json, 'commandId');
    final payload = _object(json, 'payload');
    _validateResponsePayload(type, payload);
    return _wireEnvelope(
      ProtocolResponse._(type: type, payload: payload),
      json,
    );
  }
}

final class ProtocolError extends ProtocolEnvelope {
  ProtocolError._({required super.payload}) : super(type: 'error');
  static ProtocolError _fromEnvelope(Map<String, Object?> json) {
    _uuidString(json, 'requestId');
    final payload = _object(json, 'payload');
    final code = _string(payload, 'code');
    if (!_errorCodes.contains(code)) {
      throw ProtocolValidationException(
        'payload.code',
        'known error code',
        code,
      );
    }
    _string(payload, 'message');
    _boolean(payload, 'retryable');
    if (payload['recommendedDelayMs'] != null) {
      _nonNegativeInteger(payload, 'recommendedDelayMs');
    }
    _object(payload, 'details');
    return _wireEnvelope(ProtocolError._(payload: payload), json);
  }
}

final class DecimalCursor implements Comparable<DecimalCursor> {
  DecimalCursor._(this.value);
  final String value;
  factory DecimalCursor.parse(String value) {
    if (!_cursor.hasMatch(value)) {
      throw ProtocolValidationException(
        'cursor',
        'canonical decimal string',
        value,
      );
    }
    return DecimalCursor._(value);
  }
  @override
  int compareTo(DecimalCursor other) => value.length == other.value.length
      ? value.compareTo(other.value)
      : value.length.compareTo(other.value.length);
}

final class ProtocolScenarioMachine {
  String _phase = 'initial';
  String? _hostGeneration;
  String? _snapshotId;
  String get phase => _phase;

  void _validateEvidence(String action, Map<String, Object?> message) {
    final rawPayload = message['payload'];
    final payload = rawPayload is Map
        ? Map<String, Object?>.from(rawPayload)
        : <String, Object?>{};
    void requireEvidence(bool condition, String detail) {
      if (!condition) {
        throw StateError('scenario action $action requires $detail');
      }
    }

    if (action == 'hello.accept' || action == 'hello.generation_changed') {
      final generation = payload['hostGeneration'];
      requireEvidence(generation is String, 'decimal hostGeneration');
      if (action == 'hello.generation_changed') {
        requireEvidence(
          _hostGeneration != null &&
              DecimalCursor.parse(
                    generation as String,
                  ).compareTo(DecimalCursor.parse(_hostGeneration!)) >
                  0,
          'increased hostGeneration',
        );
      }
      _hostGeneration = generation as String;
    }
    if (action == 'stream.gap') {
      final expected = payload['expectedCursor'];
      final received = payload['receivedCursor'];
      requireEvidence(
        expected is String &&
            received is String &&
            DecimalCursor.parse(
                  expected,
                ).compareTo(DecimalCursor.parse(received)) <
                0,
        'an increasing cursor gap',
      );
    }
    if (action == 'stream.conflicting_duplicate') {
      requireEvidence(
        payload['conflictingEventId'] is String &&
            payload['conflictingEventId'] != message['eventId'],
        'a different conflicting event ID',
      );
    }
    if (action == 'snapshot.begin') {
      requireEvidence(payload['snapshotId'] is String, 'snapshotId');
      _snapshotId = payload['snapshotId'] as String;
    }
    if (action == 'snapshot.part_one' || action == 'snapshot.part_two') {
      requireEvidence(
        payload['snapshotId'] == _snapshotId &&
            payload['part'] == (action.endsWith('one') ? 0 : 1),
        'the active snapshot and ordered parts',
      );
    }
    if (action == 'snapshot.end') {
      requireEvidence(
        payload['snapshotId'] == _snapshotId && payload['partCount'] == 2,
        'snapshotId and partCount 2',
      );
    }
    if (action == 'snapshot.post_baseline') {
      requireEvidence(
        payload['afterBaseline'] == true,
        'post-baseline evidence',
      );
    }
    if (action == 'command.duplicate' || action == 'command.resend') {
      requireEvidence(payload['duplicate'] == true, 'duplicate receipt');
    }
    if (action == 'command.conflict') {
      requireEvidence(
        payload['code'] == 'idempotency_conflict',
        'idempotency_conflict',
      );
    }
    if (action == 'queue.fill') {
      requireEvidence(
        payload['items'] is List && (payload['items'] as List).length == 10,
        'ten queued items',
      );
    }
    if (action == 'queue.overflow') {
      requireEvidence(payload['code'] == 'queue_full', 'queue_full');
    }
    if (action == 'controller.stale_mutation') {
      requireEvidence(
        payload['code'] == 'stale_controller',
        'stale_controller',
      );
    }
  }

  String apply(String action, [Map<String, Object?>? fixture]) {
    final transition = _scenarioTransitions[action];
    if (transition == null) {
      throw StateError('unknown scenario action: $action');
    }
    if (_phase != transition.$1) {
      throw StateError(
        'scenario action $action requires ${transition.$1}, got $_phase',
      );
    }
    if (fixture != null) {
      final rawMessage = fixture['message'];
      if (rawMessage is! Map) {
        throw StateError('scenario action $action has no protocol evidence');
      }
      final message = Map<String, Object?>.from(rawMessage);
      if ((message['type'] ?? message['kind']) !=
          _scenarioEvidenceTypes[action]) {
        throw StateError(
          'scenario action $action lacks ${_scenarioEvidenceTypes[action]} evidence',
        );
      }
      _validateEvidence(action, message);
    }
    _phase = transition.$2;
    return _phase;
  }
}

const _scenarioEvidenceTypes = <String, String>{
  'pairing.accept': 'pi-mob-host',
  'pairing.reject_invalid': 'pi-mob-host',
  'hello.accept': 'hello.accepted',
  'hello.generation_changed': 'hello.accepted',
  'stream.apply': 'turn.started',
  'stream.gap': 'turn.started',
  'stream.conflicting_duplicate': 'turn.started',
  'snapshot.begin': 'stream.snapshot.begin',
  'snapshot.part_one': 'stream.snapshot.part',
  'snapshot.part_two': 'stream.snapshot.part',
  'snapshot.end': 'stream.snapshot.end',
  'snapshot.post_baseline': 'session.state',
  'snapshot.sync': 'stream.sync.complete',
  'controller.acquire': 'controller.acquire',
  'controller.disconnect': 'controller.state',
  'controller.reclaim': 'controller.acquire',
  'controller.takeover': 'controller.takeover',
  'controller.expire': 'controller.state',
  'controller.stale_mutation': 'error',
  'command.accept': 'command.state',
  'command.duplicate': 'command.receipt',
  'command.conflict': 'error',
  'command.accept_recoverable': 'command.state',
  'command.restart': 'command.state',
  'command.running': 'command.state',
  'command.crash': 'command.state',
  'command.resend': 'command.receipt',
  'prompt.immediate': 'prompt.submit',
  'prompt.steer': 'prompt.submit',
  'prompt.follow_up': 'prompt.submit',
  'queue.restart': 'queue.snapshot',
  'queue.remove': 'queue.remove',
  'queue.add': 'turn.queued',
  'queue.clear': 'queue.clear',
  'queue.fill': 'queue.snapshot',
  'queue.overflow': 'error',
  'attachment.upload': 'turn.accepted',
  'attachment.retry': 'turn.accepted',
  'attachment.conflict': 'error',
  'attachment.replace': 'turn.accepted',
  'attachment.expire': 'error',
  'attachment.reference': 'error',
  'attachment.malformed': 'error',
  'attachment.oversized': 'error',
  'export.complete': 'command.state',
  'export.expire': 'error',
  'export.delete': 'error',
  'dialog.open': 'extension.dialog',
  'dialog.reconnect': 'extension.dialog',
  'dialog.timeout': 'error',
  'dialog.duplicate_response': 'error',
  'pagination.first': 'session.list.result',
  'pagination.revision_changed': 'session.list.result',
  'failure.oversized_json': 'error',
  'failure.slow_consumer': 'error',
  'failure.host_draining': 'error',
  'failure.pi_mismatch': 'error',
  'failure.database_unavailable': 'error',
  'failure.storage_full': 'error',
  'capability.optional_event': 'future.event',
  'capability.required_unknown': 'future.event',
};

const _scenarioTransitions = <String, (String, String)>{
  'pairing.accept': ('initial', 'paired'),
  'pairing.reject_invalid': ('paired', 'rejected'),
  'hello.accept': ('initial', 'connected'),
  'hello.generation_changed': ('connected', 'snapshot_required'),
  'stream.apply': ('initial', 'contiguous'),
  'stream.gap': ('contiguous', 'paused'),
  'stream.conflicting_duplicate': ('paused', 'snapshot_required'),
  'snapshot.begin': ('initial', 'receiving'),
  'snapshot.part_one': ('receiving', 'part_one'),
  'snapshot.part_two': ('part_one', 'part_two'),
  'snapshot.end': ('part_two', 'snapshot_complete'),
  'snapshot.post_baseline': ('snapshot_complete', 'post_baseline_replayed'),
  'snapshot.sync': ('post_baseline_replayed', 'synced'),
  'controller.acquire': ('initial', 'controlled'),
  'controller.disconnect': ('controlled', 'reclaimable'),
  'controller.reclaim': ('reclaimable', 'controlled'),
  'controller.takeover': ('controlled', 'revoked'),
  'controller.expire': ('revoked', 'expired'),
  'controller.stale_mutation': ('expired', 'stale_controller'),
  'command.accept': ('initial', 'accepted'),
  'command.duplicate': ('accepted', 'duplicate_no_dispatch'),
  'command.conflict': ('duplicate_no_dispatch', 'idempotency_conflict'),
  'command.accept_recoverable': (
    'idempotency_conflict',
    'accepted_undispatched',
  ),
  'command.restart': ('accepted_undispatched', 'dispatch_once'),
  'command.running': ('dispatch_once', 'running'),
  'command.crash': ('running', 'indeterminate'),
  'command.resend': ('indeterminate', 'no_redispatch'),
  'prompt.immediate': ('initial', 'immediate_dispatched'),
  'prompt.steer': ('immediate_dispatched', 'steered'),
  'prompt.follow_up': ('steered', 'queued'),
  'queue.restart': ('queued', 'queue_recovered'),
  'queue.remove': ('queue_recovered', 'removed'),
  'queue.add': ('removed', 'queued_again'),
  'queue.clear': ('queued_again', 'empty'),
  'queue.fill': ('empty', 'full'),
  'queue.overflow': ('full', 'queue_full'),
  'attachment.upload': ('initial', 'stored'),
  'attachment.retry': ('stored', 'deduplicated'),
  'attachment.conflict': ('deduplicated', 'idempotency_conflict'),
  'attachment.replace': ('idempotency_conflict', 'stored_again'),
  'attachment.expire': ('stored_again', 'expired'),
  'attachment.reference': ('expired', 'attachment_unavailable'),
  'attachment.malformed': ('attachment_unavailable', 'malformed_rejected'),
  'attachment.oversized': ('malformed_rejected', 'payload_too_large'),
  'export.complete': ('initial', 'export_ready'),
  'export.expire': ('export_ready', 'export_expired'),
  'export.delete': ('export_expired', 'export_unavailable'),
  'dialog.open': ('export_unavailable', 'dialog_pending'),
  'dialog.reconnect': ('dialog_pending', 'dialog_replayed'),
  'dialog.timeout': ('dialog_replayed', 'dialog_expired'),
  'dialog.duplicate_response': ('dialog_expired', 'invalid_state'),
  'pagination.first': ('invalid_state', 'page_loaded'),
  'pagination.revision_changed': ('page_loaded', 'refresh_required'),
  'failure.oversized_json': ('initial', 'payload_too_large'),
  'failure.slow_consumer': ('payload_too_large', 'slow_consumer'),
  'failure.host_draining': ('slow_consumer', 'host_draining'),
  'failure.pi_mismatch': ('host_draining', 'pi_version_mismatch'),
  'failure.database_unavailable': (
    'pi_version_mismatch',
    'database_unavailable',
  ),
  'failure.storage_full': ('database_unavailable', 'storage_full'),
  'capability.optional_event': ('initial', 'retained_optional'),
  'capability.required_unknown': (
    'retained_optional',
    'unsupported_capability',
  ),
};

String canonicalSemanticCommand(ProtocolCommand command) => jsonEncode(
  _canonical(<String, Object?>{
    'payload': command.payload,
    'type': command.type,
  }),
);
String semanticCommandSha256(ProtocolCommand command) =>
    _sha256Hex(utf8.encode(canonicalSemanticCommand(command)));
T _wireEnvelope<T extends ProtocolEnvelope>(
  T envelope,
  Map<String, Object?> wire,
) {
  envelope._wire = _immutableJsonObject(wire);
  return envelope;
}

Map<String, Object?> _immutableJsonObject(Map<String, Object?> value) =>
    Map<String, Object?>.unmodifiable(
      value.map((key, item) => MapEntry(key, _immutableJson(item))),
    );

Object? _immutableJson(Object? value) {
  if (value is Map) {
    return _immutableJsonObject(Map<String, Object?>.from(value));
  }
  if (value is List) {
    return List<Object?>.unmodifiable(value.map(_immutableJson));
  }
  return value;
}

Object? _canonical(Object? value) {
  if (value is String) return _nfc(value);
  if (value is List<Object?>) {
    return value.map(_canonical).toList(growable: false);
  }
  if (value is Map<String, Object?>) {
    final entries =
        value.entries
            .map((entry) => MapEntry(_nfc(entry.key), _canonical(entry.value)))
            .toList()
          ..sort((left, right) => left.key.compareTo(right.key));
    for (var index = 1; index < entries.length; index += 1) {
      if (entries[index - 1].key == entries[index].key) {
        throw ProtocolValidationException(
          'payload',
          'unique NFC-normalized keys',
          entries[index].key,
        );
      }
    }
    return <String, Object?>{
      for (final entry in entries) entry.key: entry.value,
    };
  }
  return value;
}

const _supportedCapabilities = <String>{
  'streams.v1',
  'commands.v1',
  'controller_leases.v1',
  'attachments.v1',
  'extension_dialogs.v1',
  'notifications.v1',
  'files.v1',
  'contexts.v1',
};
const _commandTypes = <String>{
  'controller.acquire',
  'controller.takeover',
  'controller.release',
  'host.display_name.set',
  'workspace.trust.approve',
  'notification.device.register',
  'notification.device.unregister',
  'session.create',
  'session.activate',
  'session.stop',
  'session.rename',
  'session.policy.set',
  'session.delete',
  'session.restore',
  'session.purge',
  'session.fork',
  'session.clone',
  'session.export',
  'prompt.submit',
  'turn.abort',
  'queue.remove',
  'queue.clear',
  'model.set',
  'thinking.set',
  'steering_mode.set',
  'follow_up_mode.set',
  'compaction.start',
  'compaction.auto.set',
  'retry.auto.set',
  'retry.abort',
  'extension.respond',
  'context.pin',
  'context.unpin',
  'context.exclude',
  'context.refresh',
};
const _controlTypes = <String>{
  'subscription.set',
  'cursor.ack',
  'controller.renew',
  'host.snapshot.request',
  'session.snapshot.request',
  'session.list',
  'session.history.page',
  'workspace.list',
  'workspace.search',
  'model.list',
  'command.current',
  'workspace.tree.page',
  'workspace.file.search',
  'workspace.file.content.search',
  'workspace.file.metadata',
  'workspace.file.read',
  'context.snapshot.request',
};
const _leaseFreeCommands = <String>{
  'controller.acquire',
  'controller.takeover',
  'controller.release',
  'session.create',
  'session.delete',
};
const _responseTypes = <String>{
  'hello.accepted',
  'subscription.accepted',
  'stream.sync.complete',
  'stream.snapshot.begin',
  'stream.snapshot.part',
  'stream.snapshot.end',
  'command.receipt',
  'command.current.result',
  'controller.renew.result',
  'session.list.result',
  'session.history.page.result',
  'workspace.list.result',
  'workspace.search.result',
  'model.list.result',
  'workspace.tree.page.result',
  'workspace.file.search.result',
  'workspace.file.content.search.result',
  'workspace.file.metadata.result',
  'workspace.file.read.result',
  'context.snapshot.result',
};
const _eventTypes = <String>{
  'host.state',
  'host.degraded',
  'host.draining',
  'host.capacity',
  'host.backup_state',
  'host.compatibility',
  'session.summary',
  'session.removed',
  'workspace.summary',
  'workspace.trust_state',
  'notification.capability',
  'command.state',
  'error.event',
  'session.state',
  'session.metadata',
  'session.policy',
  'session.tree',
  'controller.state',
  'turn.accepted',
  'turn.queued',
  'turn.started',
  'turn.waiting_for_input',
  'turn.retrying',
  'turn.compacting',
  'turn.settled',
  'turn.aborted',
  'turn.failed',
  'turn.indeterminate',
  'assistant.started',
  'assistant.delta',
  'assistant.completed',
  'reasoning.started',
  'reasoning.delta',
  'reasoning.completed',
  'tool.started',
  'tool.output',
  'tool.completed',
  'tool.failed',
  'tool.cancelled',
  'queue.snapshot',
  'model.state',
  'context.state',
  'retry.state',
  'compaction.state',
  'extension.dialog',
  'extension.notify',
  'extension.status',
  'extension.widget',
  'extension.title',
  'extension.editor_prefill',
  'recipe.activity',
  'recipe.unavailable',
  'plan.snapshot',
  'plan.unavailable',
  'workspace.tree.snapshot',
  'workspace.file.metadata',
  'workspace.file.stale',
  'workspace.file.unavailable',
  'context.snapshot',
  'context.unavailable',
};
const _hostEventTypes = <String>{
  'host.state',
  'host.degraded',
  'host.draining',
  'host.capacity',
  'host.backup_state',
  'host.compatibility',
  'session.summary',
  'session.removed',
  'workspace.summary',
  'workspace.trust_state',
  'notification.capability',
  'workspace.tree.snapshot',
  'workspace.file.metadata',
  'workspace.file.stale',
  'workspace.file.unavailable',
};
const _dualStreamEventTypes = <String>{'command.state', 'error.event'};
const _errorCodes = <String>{
  'invalid_message',
  'unsupported_protocol',
  'unsupported_capability',
  'host_identity_mismatch',
  'stale_connection',
  'host_draining',
  'host_not_ready',
  'host_capacity',
  'stream_not_found',
  'cursor_invalid',
  'snapshot_failed',
  'session_not_found',
  'session_deleted',
  'session_incompatible',
  'session_repair_required',
  'workspace_not_found',
  'workspace_not_allowed',
  'workspace_unavailable',
  'workspace_trust_required',
  'controller_required',
  'controller_conflict',
  'stale_controller',
  'command_not_found',
  'idempotency_conflict',
  'queue_full',
  'queue_item_not_found',
  'invalid_state',
  'attachment_unavailable',
  'export_unavailable',
  'payload_too_large',
  'rate_limited',
  'slow_consumer',
  'pi_unavailable',
  'pi_version_mismatch',
  'provider_interrupted',
  'permission_denied',
  'crash_loop',
  'database_unavailable',
  'storage_full',
  'migration_required',
  'internal_error',
  'recipe_unavailable',
  'plan_unavailable',
  'stale_plan_target',
  'path_not_found',
  'path_outside_workspace',
  'path_binary',
  'path_oversize',
  'file_stale',
  'file_unavailable',
  'context_pin_failed',
  'context_unavailable',
};
String _nfc(String value) => unorm.nfc(value);
void _requireEnvelope(Map<String, Object?> json) {
  final protocol = _object(json, 'protocol');
  if (protocol['major'] != 1 ||
      protocol['minor'] is! int ||
      (protocol['minor'] as int) < 0) {
    throw ProtocolValidationException(
      'protocol',
      '{major: 1, minor: integer}',
      protocol,
    );
  }
  _uuidString(json, 'messageId');
  if (!_timestamp.hasMatch(_string(json, 'sentAt'))) {
    throw ProtocolValidationException(
      'sentAt',
      'UTC RFC3339 timestamp',
      json['sentAt'],
    );
  }
  _object(json, 'payload');
}

void _validateCommandPayload(String type, Map<String, Object?> payload) {
  if (type == 'controller.acquire' ||
      type == 'controller.takeover' ||
      type == 'controller.release') {
    final scope = _oneOf(payload, 'scope', const <String>{'host', 'session'});
    if (scope == 'session') _uuidString(payload, 'sessionId');
    return;
  }
  if (type == 'host.display_name.set') {
    _string(payload, 'displayName');
    return;
  }
  if (type == 'workspace.trust.approve') {
    _uuidString(payload, 'workspaceId');
    _string(payload, 'fingerprint');
    return;
  }
  if (type == 'notification.device.register') {
    _uuidString(payload, 'deviceId');
    _string(payload, 'platform');
    _string(payload, 'token');
    return;
  }
  if (type == 'notification.device.unregister') {
    _uuidString(payload, 'deviceId');
    return;
  }
  if (type == 'session.create') {
    _uuidString(payload, 'workspaceId');
    _oneOf(payload, 'policyMode', const <String>{'full', 'read_only'});
    if (payload['workspaceRelativePath'] != null) {
      _stringAllowEmpty(payload, 'workspaceRelativePath');
    }
    if (payload['name'] != null) _stringAllowEmpty(payload, 'name');
    if (payload['modelIntent'] != null) {
      _stringAllowEmpty(payload, 'modelIntent');
    }
    return;
  }
  _uuidString(payload, 'sessionId');
  if (type == 'session.rename') _string(payload, 'name');
  if (type == 'session.policy.set') {
    _oneOf(payload, 'policyMode', const <String>{'full', 'read_only'});
  }
  if (type == 'session.fork') _string(payload, 'entryId');
  if (type == 'session.export') {
    _oneOf(payload, 'format', const <String>{'html'});
  }
  if (type == 'prompt.submit') {
    _oneOf(payload, 'deliveryMode', const <String>{
      'immediate',
      'steer',
      'follow_up',
    });
    _stringAllowEmpty(payload, 'message');
    final attachments = _list(payload, 'attachmentIds');
    if (attachments.length > 4) {
      throw ProtocolValidationException(
        'payload.attachmentIds',
        '<= 4 items',
        attachments.length,
      );
    }
    for (final attachment in attachments) {
      if (attachment is! String || !_uuid.hasMatch(attachment)) {
        throw ProtocolValidationException(
          'payload.attachmentIds',
          'lowercase UUIDs',
          attachment,
        );
      }
    }
    if (payload['planTarget'] != null) {
      final target = _object(payload, 'planTarget');
      for (final field in const <String>['planId', 'stepId', 'revision']) {
        _boundedString(target, field, 128);
      }
    }
  }
  if (type == 'queue.remove') _uuidString(payload, 'queueItemId');
  if (type == 'model.set') _string(payload, 'modelId');
  if (type == 'thinking.set') _string(payload, 'level');
  if (const <String>{
    'steering_mode.set',
    'follow_up_mode.set',
    'compaction.auto.set',
    'retry.auto.set',
  }.contains(type)) {
    _boolean(payload, 'enabled');
  }
  if (type == 'extension.respond') {
    _uuidString(payload, 'dialogId');
    _object(payload, 'response');
  }
}

void _validateEventPayload(String type, Map<String, Object?> payload) {
  if (payload['sessionId'] != null) _uuidString(payload, 'sessionId');
  if (type == 'session.summary') {
    _uuidString(payload, 'sessionId');
    _string(payload, 'runtimeState');
    // Early M11 bridges emitted partial lifecycle summaries before the final
    // schema-complete row. Accept those durable historical events while new
    // bridges always publish queueCount; the projection defaults it safely.
    if (payload['queueCount'] != null) {
      _nonNegativeInteger(payload, 'queueCount');
    }
  }
  if (type == 'controller.state') {
    final scope = _oneOf(payload, 'scope', const <String>{'host', 'session'});
    if (scope == 'session') _uuidString(payload, 'sessionId');
    _string(payload, 'mode');
    if (payload['leaseId'] != null) _uuidString(payload, 'leaseId');
    if (payload['installationId'] != null) {
      _uuidString(payload, 'installationId');
    }
    for (final timestamp in const <String>['expiresAt', 'reclaimableUntil']) {
      if (payload[timestamp] != null &&
          !_timestamp.hasMatch(_string(payload, timestamp))) {
        throw ProtocolValidationException(
          timestamp,
          'UTC RFC3339 timestamp',
          payload[timestamp],
        );
      }
    }
  }
  if (type == 'command.state') {
    _uuidString(payload, 'commandId');
    _oneOf(payload, 'commandType', _commandTypes);
    _string(payload, 'state');
    if (!payload.containsKey('errorCode')) {
      throw ProtocolValidationException(
        'errorCode',
        'stable error code or null',
        null,
      );
    }
    if (payload['errorCode'] != null) {
      _oneOf(payload, 'errorCode', _errorCodes);
    }
  }
  if (type == 'tool.output') {
    _string(payload, 'toolCallId');
    _nonNegativeInteger(payload, 'retainedBytes');
    _nonNegativeInteger(payload, 'totalBytes');
    _boolean(payload, 'isTruncated');
    if (payload['digest'] != null) _string(payload, 'digest');
  }
  if (type == 'extension.dialog') {
    _uuidString(payload, 'dialogId');
    _oneOf(payload, 'method', const <String>{
      'select',
      'confirm',
      'input',
      'editor',
    });
    if (!_timestamp.hasMatch(_string(payload, 'expiresAt'))) {
      throw ProtocolValidationException(
        'payload.expiresAt',
        'UTC RFC3339 timestamp',
        payload['expiresAt'],
      );
    }
  }
  if (type == 'queue.snapshot') {
    final items = _list(payload, 'items');
    if (items.length > 10) {
      throw ProtocolValidationException(
        'payload.items',
        '<= 10 items',
        items.length,
      );
    }
  }
  if (type == 'recipe.activity') {
    final kind = _oneOf(payload, 'kind', const <String>{'thinking', 'tool'});
    _uuidString(payload, 'sessionId');
    for (final field in const <String>['turnId', 'activityId', 'title']) {
      _boundedString(payload, field, 128);
    }
    _nonNegativeInteger(payload, 'ordinal');
    _oneOf(payload, 'status', const <String>{
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    });
    _object(payload, 'timing');
    final allowed = <String>{
      'kind',
      'sessionId',
      'turnId',
      'activityId',
      'ordinal',
      'status',
      'timing',
      'title',
      'truncation',
      if (kind == 'thinking') 'providerSummary',
      if (kind == 'tool') ...<String>{
        'toolName',
        'arguments',
        'output',
        'errorInfo',
      },
    };
    final unexpected = payload.keys.where((key) => !allowed.contains(key));
    if (unexpected.isNotEmpty) {
      throw ProtocolValidationException(
        'payload.${unexpected.first}',
        'declared recipe activity field',
        payload[unexpected.first],
      );
    }
    if (kind == 'tool') {
      for (final field in const <String>['toolName', 'arguments', 'output']) {
        _boundedString(payload, field, field == 'toolName' ? 128 : 240);
      }
      if (payload.containsKey('providerSummary')) {
        throw ProtocolValidationException(
          'payload.providerSummary',
          'absent for tool activity',
          payload['providerSummary'],
        );
      }
    }
  }
  if (type == 'plan.snapshot') {
    for (final field in const <String>[
      'planId',
      'revision',
      'turnId',
      'source',
    ]) {
      _boundedString(payload, field, 128);
    }
    _uuidString(payload, 'sessionId');
    _boolean(payload, 'stale');
    _object(payload, 'capability');
    final steps = _list(payload, 'steps');
    if (steps.length > 64) {
      throw ProtocolValidationException(
        'payload.steps',
        '<= 64 items',
        steps.length,
      );
    }
    for (final item in steps) {
      if (item is! Map) {
        throw ProtocolValidationException(
          'payload.steps',
          'step objects',
          item,
        );
      }
      final step = Map<String, Object?>.from(item);
      _boundedString(step, 'stepId', 128);
      _boundedString(step, 'title', 128);
      _oneOf(step, 'status', const <String>{
        'pending',
        'running',
        'completed',
        'blocked',
        'skipped',
      });
    }
  }
  if (type == 'workspace.file.metadata') {
    _uuidString(payload, 'workspaceId');
    _object(payload, 'file');
  }
  if (type == 'context.snapshot') {
    _uuidString(payload, 'sessionId');
  }
}

void _validateResponsePayload(String type, Map<String, Object?> payload) {
  if (type == 'hello.accepted') {
    _uuidString(payload, 'connectionId');
    _uuidString(payload, 'hostId');
    DecimalCursor.parse(_string(payload, 'hostGeneration'));
    _string(payload, 'hostDisplayName');
    _string(payload, 'bridgeVersion');
    _string(payload, 'piVersion');
    if (!_timestamp.hasMatch(_string(payload, 'serverTime'))) {
      throw ProtocolValidationException(
        'serverTime',
        'UTC RFC3339 timestamp',
        payload['serverTime'],
      );
    }
    _strings(payload, 'capabilities');
    final limits = _object(payload, 'limits');
    for (final key in const <String>[
      'maxJsonBytes',
      'maxAttachmentBytes',
      'maxAttachmentsPerPrompt',
      'maxPromptAttachmentBytes',
      'maxQueuedFollowUps',
      'maxSessionPageSize',
      'maxBackgroundSessionSubscriptions',
    ]) {
      _nonNegativeInteger(limits, key);
    }
  }
  if (type == 'subscription.accepted') {
    for (final item in _list(payload, 'streams')) {
      if (item is! Map) {
        throw ProtocolValidationException('streams', 'stream objects', item);
      }
      final stream = Map<String, Object?>.from(item);
      _validateStreamId(stream, 'streamId');
      _oneOf(stream, 'mode', const <String>{
        'replay',
        'current',
        'snapshot_required',
      });
    }
  }
  if (type == 'stream.sync.complete') {
    _validateStreamId(payload, 'streamId');
    DecimalCursor.parse(_string(payload, 'currentCursor'));
    _oneOf(payload, 'mode', const <String>{
      'replay',
      'current',
      'snapshot_required',
    });
  }
  if (type == 'stream.snapshot.begin') {
    _uuidString(payload, 'snapshotId');
    _validateStreamId(payload, 'streamId');
    DecimalCursor.parse(_string(payload, 'baselineCursor'));
  }
  if (type == 'stream.snapshot.part') {
    _uuidString(payload, 'snapshotId');
    _nonNegativeInteger(payload, 'part');
    _list(payload, 'items');
  }
  if (type == 'stream.snapshot.end') {
    _uuidString(payload, 'snapshotId');
    final count = _nonNegativeInteger(payload, 'partCount');
    if (count < 1) {
      throw ProtocolValidationException('payload.partCount', '>= 1', count);
    }
  }
  if (type == 'command.receipt') {
    _string(payload, 'state');
    _boolean(payload, 'duplicate');
  }
  if (type == 'command.current.result') {
    _uuidString(payload, 'commandId');
    _string(payload, 'state');
  }
  if (const <String>{
    'session.list.result',
    'session.history.page.result',
    'workspace.list.result',
    'workspace.search.result',
    'model.list.result',
  }.contains(type)) {
    _list(payload, 'items');
  }
  if (type == 'session.list.result') _string(payload, 'snapshotRevision');
  if (const <String>{
        'session.list.result',
        'session.history.page.result',
      }.contains(type) &&
      payload['nextPageToken'] != null) {
    _string(payload, 'nextPageToken');
  }
}

void _boundedString(Map<String, Object?> object, String key, int maximum) {
  final value = _string(object, key);
  if (value.length > maximum) {
    throw ProtocolValidationException(key, '<= $maximum characters', value);
  }
}

String _string(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! String || value.isEmpty) {
    throw ProtocolValidationException(key, 'non-empty string', value);
  }
  return value;
}

void _nullableString(Map<String, Object?> object, String key) {
  final value = object[key];
  if (!object.containsKey(key) || (value != null && value is! String)) {
    throw ProtocolValidationException(key, 'string or null', value);
  }
}

String _stringAllowEmpty(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! String) throw ProtocolValidationException(key, 'string', value);
  return value;
}

String _uuidString(Map<String, Object?> object, String key) {
  final value = _string(object, key);
  if (!_uuid.hasMatch(value)) {
    throw ProtocolValidationException(key, 'lowercase UUID', value);
  }
  return value;
}

String _validateStreamId(Map<String, Object?> object, String key) {
  final value = _string(object, key);
  if (!_streamId.hasMatch(value)) {
    throw ProtocolValidationException(
      key,
      'host:<uuid> or session:<uuid>',
      value,
    );
  }
  return value;
}

Map<String, Object?> _object(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! Map) throw ProtocolValidationException(key, 'object', value);
  return Map<String, Object?>.from(value);
}

List<String> _strings(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! List || value.any((item) => item is! String)) {
    throw ProtocolValidationException(key, 'array of strings', value);
  }
  return List<String>.from(value);
}

List<Object?> _list(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! List) throw ProtocolValidationException(key, 'array', value);
  return List<Object?>.from(value);
}

bool _boolean(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! bool) throw ProtocolValidationException(key, 'boolean', value);
  return value;
}

int _nonNegativeInteger(Map<String, Object?> object, String key) {
  final value = object[key];
  if (value is! int || value < 0) {
    throw ProtocolValidationException(key, 'non-negative integer', value);
  }
  return value;
}

String _oneOf(Map<String, Object?> object, String key, Set<String> allowed) {
  final value = _string(object, key);
  if (!allowed.contains(value)) {
    throw ProtocolValidationException(key, allowed.join(' or '), value);
  }
  return value;
}

String _sha256Hex(List<int> source) {
  final bytes = <int>[...source, 0x80];
  while (bytes.length % 64 != 56) {
    bytes.add(0);
  }
  final bitLength = source.length * 8;
  for (var shift = 56; shift >= 0; shift -= 8) {
    bytes.add((bitLength >> shift) & 0xff);
  }
  var a = 0x6a09e667,
      b = 0xbb67ae85,
      c = 0x3c6ef372,
      d = 0xa54ff53a,
      e = 0x510e527f,
      f = 0x9b05688c,
      g = 0x1f83d9ab,
      h = 0x5be0cd19;
  for (var offset = 0; offset < bytes.length; offset += 64) {
    final words = Uint32List(64);
    for (var i = 0; i < 16; i += 1) {
      words[i] =
          (bytes[offset + i * 4] << 24) |
          (bytes[offset + i * 4 + 1] << 16) |
          (bytes[offset + i * 4 + 2] << 8) |
          bytes[offset + i * 4 + 3];
    }
    for (var i = 16; i < 64; i += 1) {
      final s0 =
          _rr(words[i - 15], 7) ^ _rr(words[i - 15], 18) ^ (words[i - 15] >> 3);
      final s1 =
          _rr(words[i - 2], 17) ^ _rr(words[i - 2], 19) ^ (words[i - 2] >> 10);
      words[i] = _u32(s0 + s1 + words[i - 7] + words[i - 16]);
    }
    var aa = a, bb = b, cc = c, dd = d, ee = e, ff = f, gg = g, hh = h;
    for (var i = 0; i < 64; i += 1) {
      final t1 = _u32(
        hh +
            (_rr(ee, 6) ^ _rr(ee, 11) ^ _rr(ee, 25)) +
            ((ee & ff) ^ (~ee & gg)) +
            _sha256K[i] +
            words[i],
      );
      final t2 = _u32(
        (_rr(aa, 2) ^ _rr(aa, 13) ^ _rr(aa, 22)) +
            ((aa & bb) ^ (aa & cc) ^ (bb & cc)),
      );
      hh = gg;
      gg = ff;
      ff = ee;
      ee = _u32(dd + t1);
      dd = cc;
      cc = bb;
      bb = aa;
      aa = _u32(t1 + t2);
    }
    a = _u32(a + aa);
    b = _u32(b + bb);
    c = _u32(c + cc);
    d = _u32(d + dd);
    e = _u32(e + ee);
    f = _u32(f + ff);
    g = _u32(g + gg);
    h = _u32(h + hh);
  }
  return [
    a,
    b,
    c,
    d,
    e,
    f,
    g,
    h,
  ].map((word) => word.toRadixString(16).padLeft(8, '0')).join();
}

int _u32(int value) => value & 0xffffffff;
int _rr(int value, int bits) => _u32(value >> bits | value << (32 - bits));
const _sha256K = <int>[
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
];
