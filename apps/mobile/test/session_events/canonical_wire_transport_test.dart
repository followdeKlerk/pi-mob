import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/canonical_wire_transport.dart';

Map<String, Object?> _wireEvent({
  required String sessionId,
  required String eventId,
  required int sequence,
  required String eventType,
  String occurredAt = '2026-08-14T12:00:00.000Z',
  Map<String, Object?>? data,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': eventType,
  'occurredAt': occurredAt,
  'data': data ?? <String, Object?>{'turnId': 't1'},
};

Map<String, Object?> _liveFrame({
  required String sessionId,
  required String eventId,
  required int sequence,
  required String eventType,
  String occurredAt = '2026-08-14T12:00:00.000Z',
  Map<String, Object?>? data,
}) => <String, Object?>{
  'type': 'session.event',
  'protocol': <String, Object?>{'major': 1, 'minor': 0},
  'messageId': '00000000-0000-4000-8000-000000000001',
  'sentAt': occurredAt,
  'payload': _wireEvent(
    sessionId: sessionId,
    eventId: eventId,
    sequence: sequence,
    eventType: eventType,
    occurredAt: occurredAt,
    data: data,
  ),
};

Map<String, Object?> _replayEnvelope({
  required String sessionId,
  required List<Map<String, Object?>> events,
  required int latestSequence,
  required bool complete,
  String requestId = '00000000-0000-4000-8000-0000000000aa',
}) => <String, Object?>{
  'type': 'session.events.replay.result',
  'protocol': <String, Object?>{'major': 1, 'minor': 0},
  'messageId': requestId,
  'requestId': requestId,
  'sentAt': '2026-08-14T12:00:00.000Z',
  'payload': <String, Object?>{
    'sessionId': sessionId,
    'events': events,
    'latestSequence': latestSequence,
    'complete': complete,
  },
};

void main() {
  group('decodeWireEvent', () {
    test('decodes a well-formed session.event envelope', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 1,
        eventType: 'turn.started',
        data: <String, Object?>{'turnId': 't1'},
      );
      final event = decodeWireEvent(wire, wireSessionId: 's1');
      expect(event.sessionId, 's1');
      expect(event.eventId, '00000000-0000-4000-8000-000000000001');
      expect(event.sequence, 1);
      expect(event.type, CanonicalEventType.turnStarted);
      expect(event.payload['turnId'], 't1');
      expect(event.occurredAt.isUtc, isTrue);
    });

    test('infers wireSessionId from payload when not supplied', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 1,
        eventType: 'turn.started',
      );
      final event = decodeWireEvent(wire);
      expect(event.sessionId, 's1');
    });

    test('rejects wrong message type', () {
      final wire = <String, Object?>{
        'type': 'something.else',
        'payload': <String, Object?>{},
      };
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.missingField,
          ),
        ),
      );
    });

    test('rejects non-UUID eventId', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: 'not-a-uuid',
        sequence: 1,
        eventType: 'turn.started',
      );
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.invalidUuid,
          ),
        ),
      );
    });

    test('rejects non-positive sequence', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 0,
        eventType: 'turn.started',
      );
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.outOfRange,
          ),
        ),
      );
    });

    test('rejects unknown eventType', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 1,
        eventType: 'pi.rpc.event',
      );
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.unknownEventType,
          ),
        ),
      );
    });

    test('rejects non-ISO occurredAt', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 1,
        eventType: 'turn.started',
        occurredAt: 'not-a-timestamp',
      );
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.invalidTimestamp,
          ),
        ),
      );
    });

    test('rejects sessionId mismatch with wireSessionId', () {
      final wire = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000001',
        sequence: 1,
        eventType: 'turn.started',
      );
      expect(
        () => decodeWireEvent(wire, wireSessionId: 's2'),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.wrongSession,
          ),
        ),
      );
    });

    test('rejects non-object data payload', () {
      final wire = <String, Object?>{
        'type': 'session.event',
        'payload': <String, Object?>{
          'eventId': '00000000-0000-4000-8000-000000000001',
          'sessionId': 's1',
          'sequence': 1,
          'eventType': 'turn.started',
          'occurredAt': '2026-08-14T12:00:00.000Z',
          'data': 'not-an-object',
        },
      };
      expect(
        () => decodeWireEvent(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.wrongType,
          ),
        ),
      );
    });
  });

  group('decodeReplayResult', () {
    test('decodes a complete replay page into ordered canonical events', () {
      final events = <Map<String, Object?>>[
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        ),
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000002',
          sequence: 2,
          eventType: 'turn.settled',
        ),
      ];
      final wire = _replayEnvelope(
        sessionId: 's1',
        events: events,
        latestSequence: 2,
        complete: true,
      );
      final result = decodeReplayResult(wire);
      expect(result.sessionId, 's1');
      expect(result.latestSequence, 2);
      expect(result.complete, isTrue);
      expect(result.events, hasLength(2));
      expect(result.events.first.type, CanonicalEventType.turnStarted);
      expect(result.events.last.type, CanonicalEventType.turnSettled);
      expect(result.events.map((e) => e.sequence).toList(), <int>[1, 2]);
    });

    test('flags internal gap even when complete is true', () {
      final events = <Map<String, Object?>>[
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        ),
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000003',
          sequence: 3,
          eventType: 'turn.settled',
        ),
      ];
      final wire = _replayEnvelope(
        sessionId: 's1',
        events: events,
        latestSequence: 3,
        complete: true,
      );
      final result = decodeReplayResult(wire);
      expect(result.complete, isFalse);
      expect(result.events, hasLength(2));
    });

    test('flags duplicate sequence even when complete is true', () {
      final events = <Map<String, Object?>>[
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        ),
        _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000002',
          sequence: 1,
          eventType: 'turn.settled',
        ),
      ];
      final wire = _replayEnvelope(
        sessionId: 's1',
        events: events,
        latestSequence: 1,
        complete: true,
      );
      final result = decodeReplayResult(wire);
      expect(result.complete, isFalse);
    });

    test('respects the schema page cap', () {
      final events = List.generate(kCanonicalReplayPageCap + 1, (index) {
        return _wireEvent(
          sessionId: 's1',
          eventId:
              '00000000-0000-4000-8000-${index.toRadixString(16).padLeft(12, '0')}',
          sequence: index + 1,
          eventType: 'turn.started',
        );
      });
      final wire = _replayEnvelope(
        sessionId: 's1',
        events: events,
        latestSequence: events.length,
        complete: false,
      );
      expect(
        () => decodeReplayResult(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.pageTooLarge,
          ),
        ),
      );
    });

    test('rejects per-element sessionId mismatch', () {
      final events = <Map<String, Object?>>[
        _wireEvent(
          sessionId: 's2',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        ),
      ];
      final wire = _replayEnvelope(
        sessionId: 's1',
        events: events,
        latestSequence: 1,
        complete: true,
      );
      expect(
        () => decodeReplayResult(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.wrongSession,
          ),
        ),
      );
    });

    test('rejects wrong message type', () {
      final wire = <String, Object?>{
        'type': 'something.else',
        'payload': <String, Object?>{},
      };
      expect(
        () => decodeReplayResult(wire),
        throwsA(
          isA<CanonicalWireError>().having(
            (e) => e.code,
            'code',
            CanonicalWireErrorCode.missingField,
          ),
        ),
      );
    });
  });

  group('event type wire name mapping', () {
    test('every canonical event type maps to a stable wire name', () {
      for (final type in CanonicalEventType.values) {
        if (type == CanonicalEventType.ignored) continue;
        final wireName = switch (type) {
          CanonicalEventType.turnStarted => 'turn.started',
          CanonicalEventType.turnWaitingForInput => 'turn.waiting_for_input',
          CanonicalEventType.turnSettled => 'turn.settled',
          CanonicalEventType.turnAborted => 'turn.aborted',
          CanonicalEventType.turnFailed => 'turn.failed',
          CanonicalEventType.turnCancelled => 'turn.cancelled',
          CanonicalEventType.assistantStarted => 'assistant.started',
          CanonicalEventType.assistantContentReplaced =>
            'assistant.content.replaced',
          CanonicalEventType.assistantMessageCompleted =>
            'assistant.message.completed',
          CanonicalEventType.toolCallStarted => 'tool.started',
          CanonicalEventType.toolProgressReplaced => 'tool.progress.replaced',
          CanonicalEventType.toolCallCompleted => 'tool.completed',
          CanonicalEventType.toolCallFailed => 'tool.failed',
          CanonicalEventType.userMessageCreated => 'user.message.created',
          CanonicalEventType.ignored => '__ignored__',
        };
        expect(
          decodeWireEvent(
            _liveFrame(
              sessionId: 's1',
              eventId: '00000000-0000-4000-8000-000000000099',
              sequence: 1,
              eventType: wireName,
            ),
          ).type,
          type,
          reason: 'wire literal $wireName must round-trip to $type',
        );
      }
    });
  });
}
