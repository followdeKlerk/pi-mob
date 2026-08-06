import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/session_events/canonical_session_manager.dart';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const connectionId = '44444444-4444-4444-8444-444444444444';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppDatabase database;
  late FakeBridgeTransport transport;
  late ConnectionCoordinator coordinator;
  late Directory canonicalDir;

  setUp(() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    transport = FakeBridgeTransport();
    canonicalDir = Directory.systemTemp.createTempSync('canonical-coord-');
    coordinator = ConnectionCoordinator(
      transport: transport,
      database: database,
      canonicalSessionManager: CanonicalSessionManager(
        baseDirectoryOverride: canonicalDir,
      ),
    );
  });

  tearDown(() async {
    coordinator.dispose();
    await database.close();
    if (canonicalDir.existsSync()) canonicalDir.deleteSync(recursive: true);
  });

  test(
    'canonical capability advertised in hello opens session.events.subscribe for selected session',
    () async {
      await makeReadyCanonical(
        coordinator,
        transport,
        advertiseCanonical: true,
      );
      final socket = transport.sockets.single;
      await coordinator.selectPrimarySession(sessionId);
      // Selecting a session must trigger session.events.subscribe with
      // the persisted last sequence (zero on first connect).
      await eventually(
        () => socket.sent.any(
          (message) => message['type'] == 'session.events.subscribe',
        ),
      );
      final subscribe = socket.sent.firstWhere(
        (message) => message['type'] == 'session.events.subscribe',
      );
      final payload = subscribe['payload'] as Map;
      expect(payload['sessionId'], sessionId);
      expect(payload['afterSequence'], 0);
      // The synchronizer binding is created lazily when the first
      // canonical event arrives; before that the accessor returns
      // `null`. The subscribe itself proves the wire path; later
      // tests exercise the accessor after replay/live arrival.
      expect(coordinator.canonicalTranscriptStateFor(sessionId), isNull);
    },
  );

  test(
    'replay envelope feeds the canonical synchronizer and advances lastAppliedSequence',
    () async {
      await makeReadyCanonical(
        coordinator,
        transport,
        advertiseCanonical: true,
      );
      final socket = transport.sockets.single;
      await coordinator.selectPrimarySession(sessionId);
      await eventually(
        () => socket.sent.any(
          (message) => message['type'] == 'session.events.subscribe',
        ),
      );
      final subscribeRequestId =
          socket.sent.firstWhere(
                (message) => message['type'] == 'session.events.subscribe',
              )['requestId']
              as String;
      socket.server(
        canonicalReplay(
          subscribeRequestId,
          sessionId,
          events: <Map<String, Object?>>[
            turnStartedEvent(
              sequence: 1,
              eventId: '11111111-1111-4111-8111-111111111111',
            ),
            assistantStartedEvent(
              sequence: 2,
              eventId: '22222222-2222-4222-8222-222222222222',
              messageId: 'a-1',
            ),
            assistantCompletedEvent(
              sequence: 3,
              eventId: '33333333-3333-4333-8333-333333333333',
              messageId: 'a-1',
            ),
          ],
        ),
      );
      await eventually(
        () => coordinator.canonicalLastAppliedSequence(sessionId) == 3,
      );
      final state = coordinator.canonicalTranscriptStateFor(sessionId);
      expect(state, isNotNull);
      expect(state!.assistantMessages.keys, contains('a-1'));
      expect(state.assistantMessages['a-1']!.isTerminal, isTrue);
    },
  );

  test(
    'live session.event envelopes stream into the synchronizer after subscribe',
    () async {
      await makeReadyCanonical(
        coordinator,
        transport,
        advertiseCanonical: true,
      );
      final socket = transport.sockets.single;
      await coordinator.selectPrimarySession(sessionId);
      await eventually(
        () => socket.sent.any(
          (message) => message['type'] == 'session.events.subscribe',
        ),
      );
      final subscribeRequestId =
          socket.sent.firstWhere(
                (message) => message['type'] == 'session.events.subscribe',
              )['requestId']
              as String;
      socket.server(
        canonicalReplay(subscribeRequestId, sessionId, events: const []),
      );
      // Live frames received AFTER the replay must advance the
      // projection through the same synchronizer.
      socket.server(
        canonicalLive(
          sessionId,
          sequence: 1,
          type: 'turn.started',
          data: {'turnId': 't-live'},
        ),
      );
      socket.server(
        canonicalLive(
          sessionId,
          sequence: 2,
          type: 'assistant.started',
          data: {'messageId': 'live-1', 'turnId': 't-live'},
        ),
      );
      await eventually(
        () => coordinator.canonicalLastAppliedSequence(sessionId) == 2,
      );
      final state = coordinator.canonicalTranscriptStateFor(sessionId);
      expect(state!.assistantMessages.keys, contains('live-1'));
    },
  );

  test('reconnect resumes from the persisted lastAppliedSequence', () async {
    await makeReadyCanonical(coordinator, transport, advertiseCanonical: true);
    final socket = transport.sockets.single;
    await coordinator.selectPrimarySession(sessionId);
    await eventually(
      () => socket.sent.any(
        (message) => message['type'] == 'session.events.subscribe',
      ),
    );
    final firstRequestId =
        socket.sent.firstWhere(
              (message) => message['type'] == 'session.events.subscribe',
            )['requestId']
            as String;
    socket.server(
      canonicalReplay(
        firstRequestId,
        sessionId,
        events: <Map<String, Object?>>[
          turnStartedEvent(
            sequence: 1,
            eventId: '44444444-4444-4444-8444-444444444444',
          ),
          turnSettledEvent(
            sequence: 2,
            eventId: '55555555-5555-4555-8555-555555555555',
          ),
        ],
      ),
    );
    await eventually(
      () => coordinator.canonicalLastAppliedSequence(sessionId) == 2,
    );
    // The cursor persists across a new session.events.subscribe for the
    // same session — prove it by calling `selectSession` again and
    // asserting the next `afterSequence` reflects the durably applied
    // state of the local cache.
    await coordinator.selectSession(sessionId);
    await eventually(
      () =>
          socket.sent
              .where((message) => message['type'] == 'session.events.subscribe')
              .length >=
          2,
    );
    final subscribes = socket.sent
        .where((message) => message['type'] == 'session.events.subscribe')
        .toList();
    final secondPayload = subscribes.last['payload'] as Map;
    expect(secondPayload['sessionId'], sessionId);
    expect(secondPayload['afterSequence'], 2);
  });

  test('canonical capability absent leaves the manager disabled', () async {
    await makeReadyCanonical(coordinator, transport, advertiseCanonical: false);
    final socket = transport.sockets.single;
    await coordinator.selectPrimarySession(sessionId);
    // No `session.events.subscribe` should ever be sent.
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(
      socket.sent
          .where((message) => message['type'] == 'session.events.subscribe')
          .isEmpty,
      isTrue,
    );
    expect(coordinator.canonicalTranscriptStateFor(sessionId), isNull);
  });
}

Map<String, Object?> helloAccepted({
  String generation = '1',
  bool advertiseCanonical = false,
}) => response('hello.accepted', {
  'connectionId': connectionId,
  'hostId': hostId,
  'hostGeneration': generation,
  'hostDisplayName': 'Fixture host',
  'bridgeVersion': 'm5',
  'piVersion': '0.82.0',
  'serverTime': '2026-07-13T00:00:00.000Z',
  'capabilities': <String>[
    'streams.v1',
    'commands.v1',
    'controller_leases.v1',
    if (advertiseCanonical) 'session_events.v2',
  ],
  'limits': {
    'maxJsonBytes': 1048576,
    'maxAttachmentBytes': 10485760,
    'maxAttachmentsPerPrompt': 4,
    'maxPromptAttachmentBytes': 26214400,
    'maxQueuedFollowUps': 10,
    'maxSessionPageSize': 100,
    'maxBackgroundSessionSubscriptions': 5,
  },
});

Map<String, Object?> response(
  String type,
  Map<String, Object?> payload, {
  String? requestId,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  if (requestId != null) 'requestId': requestId,
  'type': type,
  'sentAt': DateTime.utc(2026, 7, 13).toIso8601String(),
  'payload': payload,
};

Map<String, Object?> event({
  required String type,
  required String streamId,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'type': type,
  'sentAt': DateTime.utc(2026, 7, 13).toIso8601String(),
  'payload': payload,
  'eventId': eventId,
  'streamId': streamId,
  'cursor': cursor,
};

Map<String, Object?> canonicalReplay(
  String requestId,
  String targetSessionId, {
  required List<Map<String, Object?>> events,
}) => response('session.events.replay.result', <String, Object?>{
  'sessionId': targetSessionId,
  'events': events,
  'latestSequence': events.isEmpty ? 0 : events.last['sequence'] as int,
  'complete': true,
}, requestId: requestId);

Map<String, Object?> canonicalLive(
  String targetSessionId, {
  required int sequence,
  required String type,
  String? eventId,
  Map<String, Object?>? data,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'type': 'session.event',
  'sentAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
  'payload': <String, Object?>{
    'eventId':
        eventId ??
        '11111111-1111-4111-8111-${sequence.toString().padLeft(12, '0')}',
    'sessionId': targetSessionId,
    'sequence': sequence,
    'eventType': type,
    'occurredAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
    'data': data ?? const <String, Object?>{},
  },
};

Map<String, Object?> turnStartedEvent({
  required int sequence,
  required String eventId,
  String? turnId,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': 'turn.started',
  'occurredAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
  'data': {'turnId': turnId ?? 't-1'},
};

Map<String, Object?> turnSettledEvent({
  required int sequence,
  required String eventId,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': 'turn.settled',
  'occurredAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
  'data': {'turnId': 't-1'},
};

Map<String, Object?> assistantStartedEvent({
  required int sequence,
  required String eventId,
  required String messageId,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': 'assistant.started',
  'occurredAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
  'data': {'turnId': 't-1', 'messageId': messageId},
};

Map<String, Object?> assistantCompletedEvent({
  required int sequence,
  required String eventId,
  required String messageId,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': 'assistant.message.completed',
  'occurredAt': DateTime.utc(2026, 7, 13, 0, 0, sequence).toIso8601String(),
  'data': {'turnId': 't-1', 'messageId': messageId},
};

Future<void> makeReadyCanonical(
  ConnectionCoordinator coordinator,
  FakeBridgeTransport transport, {
  required bool advertiseCanonical,
}) async {
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.sockets.single;
  socket.server(helloAccepted(advertiseCanonical: advertiseCanonical));
  await eventually(
    () => socket.sent.any((message) => message['type'] == 'subscription.set'),
  );
  socket.server(
    response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$hostId', 'mode': 'current'},
      ],
    }),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'host:$hostId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await eventually(() => coordinator.isReady);
  socket.server(
    event(
      type: 'session.summary',
      streamId: 'host:$hostId',
      cursor: '1',
      eventId: '88888888-8888-4888-8888-888888888888',
      payload: {
        'sessionId': sessionId,
        'workspaceId': workspaceId,
        'name': 'Fixture',
        'runtimeState': 'idle',
        'queueCount': 0,
      },
    ),
  );
  await eventually(
    () =>
        socket.sent
            .where((message) => message['type'] == 'subscription.set')
            .length >=
        2,
  );
  socket.server(
    response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$hostId', 'mode': 'current'},
        {'streamId': 'session:$sessionId', 'mode': 'current'},
      ],
    }),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'host:$hostId',
      'currentCursor': '1',
      'mode': 'current',
    }, requestId: null),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'session:$sessionId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await eventually(() => coordinator.isReady);
  socket.server(
    event(
      type: 'session.state',
      streamId: 'session:$sessionId',
      cursor: '1',
      eventId: '99999999-9999-4999-8999-999999999999',
      payload: {
        'sessionId': sessionId,
        'runtimeState': 'idle',
        'attentionState': 'none',
        'lastActivityAt': '2026-07-13T00:00:00.000Z',
      },
    ),
  );
}

Future<void> eventually(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 3),
}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) {
      throw TestFailure('Condition was not met');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class FakeBridgeTransport implements BridgeTransport {
  final List<FakeBridgeSocket> sockets = [];
  Uri? lastProbed;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async {
    lastProbed = endpoint;
    return const EndpointProbe(
      statusCode: 200,
      ready: true,
      body: {'status': 'ready'},
    );
  }

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    final socket = FakeBridgeSocket();
    sockets.add(socket);
    return socket;
  }
}

final class FakeBridgeSocket implements BridgeSocket {
  final StreamController<String> _controller = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _controller.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) =>
      _controller.add(jsonEncode(message));

  @override
  Future<void> close([int? code, String? reason]) => _controller.close();
}
