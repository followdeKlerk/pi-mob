import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const connectionId = '44444444-4444-4444-8444-444444444444';
const leaseId = '55555555-5555-4555-8555-555555555555';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('manual endpoint accepts only a clean HTTPS origin', () {
    expect(
      normalizeHttpsEndpoint('host.example').toString(),
      'https://host.example',
    );
    expect(
      () => normalizeHttpsEndpoint('http://host.example'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://host.example/path'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://host.example?token=x'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://user@host.example'),
      throwsFormatException,
    );
  });

  late AppDatabase database;
  late FakeBridgeTransport transport;
  late ConnectionCoordinator coordinator;

  setUp(() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    transport = FakeBridgeTransport();
    coordinator = ConnectionCoordinator(
      transport: transport,
      database: database,
    );
  });

  tearDown(() async {
    coordinator.dispose();
    await database.close();
  });

  test(
    'hello, mandatory host plus one session, ordered event and cursor ack',
    () async {
      await coordinator.initialize(autoConnect: false);
      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.single;
      expect(socket.sent.single['type'], 'hello');

      socket.server(helloAccepted());
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'subscription.set'),
      );
      var subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId']);

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
          eventId: '66666666-6666-4666-8666-666666666666',
          payload: {
            'sessionId': sessionId,
            'workspaceId': workspaceId,
            'name': 'Fixture session',
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
      subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId', 'session:$sessionId']);
      final streams = (subscription['payload'] as Map)['streams'] as List;
      expect((streams[1] as Map)['detail'], 'full');

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
          type: 'controller.state',
          streamId: 'session:$sessionId',
          cursor: '1',
          eventId: '77777777-7777-4777-8777-777777777777',
          payload: {
            'scope': 'session',
            'sessionId': sessionId,
            'mode': 'controller',
            'leaseId': leaseId,
          },
        ),
      );
      await eventually(() => coordinator.leaseId == leaseId);
      socket.server(
        event(
          type: 'turn.started',
          streamId: 'session:$sessionId',
          cursor: '2',
          eventId: '12121212-1212-4212-8212-121212121212',
          payload: {'sessionId': sessionId},
        ),
      );
      socket.server(
        event(
          type: 'turn.settled',
          streamId: 'session:$sessionId',
          cursor: '3',
          eventId: '13131313-1313-4313-8313-131313131313',
          payload: {'sessionId': sessionId},
        ),
      );
      await eventually(
        () =>
            coordinator
                .streams['session:$sessionId']
                ?.lastContiguousCursor
                .value ==
            '3',
      );
      expect(coordinator.sessions.single.runtimeState, 'idle');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect((await database.allSessions()).single.runtimeState, 'idle');

      await Future<void>.delayed(const Duration(milliseconds: 1100));
      await eventually(
        () => socket.sent.any((message) => message['type'] == 'cursor.ack'),
      );
      final ack = socket.sent.lastWhere(
        (message) => message['type'] == 'cursor.ack',
      );
      expect(
        (ack['payload'] as Map)['cursors'],
        containsPair('session:$sessionId', '3'),
      );
    },
  );

  test('multipart snapshot is assembled and committed atomically', () async {
    await coordinator.initialize(autoConnect: false);
    await coordinator.connect('https://fixture.test');
    final socket = transport.sockets.single;
    socket.server(helloAccepted());
    await eventually(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    );
    socket.server(
      response('subscription.accepted', {
        'streams': [
          {'streamId': 'host:$hostId', 'mode': 'snapshot_required'},
        ],
      }),
    );
    const snapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    socket.server(
      response('stream.snapshot.begin', {
        'snapshotId': snapshotId,
        'streamId': 'host:$hostId',
        'baselineCursor': '7',
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.part', {
        'snapshotId': snapshotId,
        'part': 0,
        'items': [
          {'index': 0, 'json': '{"sessions":['},
        ],
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.part', {
        'snapshotId': snapshotId,
        'part': 1,
        'items': [
          {
            'index': 1,
            'json':
                '{"sessionId":"$sessionId","name":"From snapshot","runtimeState":"idle","queueCount":0}]}',
          },
        ],
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.end', {
        'snapshotId': snapshotId,
        'partCount': 2,
      }, requestId: null),
    );
    socket.server(
      response('stream.sync.complete', {
        'streamId': 'host:$hostId',
        'currentCursor': '7',
        'mode': 'snapshot_required',
      }, requestId: null),
    );

    await eventually(() => coordinator.isReady);
    expect(
      coordinator.streams['host:$hostId']!.lastContiguousCursor.value,
      '7',
    );
    expect(coordinator.sessions.single.name, 'From snapshot');
    final snapshots = await database.snapshotsForHost(hostId);
    expect(snapshots.single.baselineCursor, '7');
    expect(jsonDecode(snapshots.single.payloadJson), [
      {
        'sessions': [
          {
            'sessionId': sessionId,
            'name': 'From snapshot',
            'runtimeState': 'idle',
            'queueCount': 0,
          },
        ],
      },
    ]);
  });

  test(
    'pending exact payload reconciles with command.current and never auto-resends',
    () async {
      await makeReady(coordinator, transport);
      final first = transport.sockets.single;

      await coordinator.updateDraft('Implement exactly once');
      await coordinator.submitPrompt();
      final prompt = first.sent.lastWhere(
        (message) => message['type'] == 'prompt.submit',
      );
      final commandId = prompt['commandId'] as String;
      final exactPayload = Map<String, Object?>.from(prompt['payload'] as Map);
      final stored = await database.draft(hostId, sessionId);
      expect(stored!.pendingCommandId, commandId);
      expect(jsonDecode(stored.pendingPayloadJson!), exactPayload);
      expect(stored.draftText, 'Implement exactly once');

      // A fresh foreground connection must perform a read-only reconciliation.
      await coordinator.connect('https://fixture.test');
      final second = transport.sockets.last;
      socketHandshake(
        second,
        includeSession: true,
        hostCursor: '1',
        sessionCursor: '1',
      );
      await eventually(
        () =>
            second.sent.any((message) => message['type'] == 'command.current'),
      );
      expect(
        second.sent.where((message) => message['type'] == 'prompt.submit'),
        isEmpty,
      );
      final current = second.sent.lastWhere(
        (message) => message['type'] == 'command.current',
      );
      expect((current['payload'] as Map)['commandId'], commandId);

      second.server(
        response('command.current.result', {
          'commandId': commandId,
          'state': 'accepted',
        }),
      );
      await eventually(() => coordinator.pendingCommandId == null);
      expect(coordinator.draft, isEmpty);
      final settled = await database.draft(hostId, sessionId);
      expect(settled!.pendingCommandId, isNull);
      expect(settled.draftText, isEmpty);
    },
  );

  test(
    'process restart restores uncertain command and reconciles without send',
    () async {
      await makeReady(coordinator, transport);
      await coordinator.updateDraft('Survive process death');
      await coordinator.submitPrompt();
      final sent = transport.sockets.single.sent.lastWhere(
        (message) => message['type'] == 'prompt.submit',
      );
      final commandId = sent['commandId'] as String;

      coordinator.dispose();
      transport = FakeBridgeTransport();
      coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      expect(coordinator.draft, 'Survive process death');
      expect(coordinator.pendingCommandId, commandId);

      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.single;
      socketHandshake(
        socket,
        includeSession: true,
        hostCursor: '1',
        sessionCursor: '1',
      );
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'command.current'),
      );
      expect(
        socket.sent.where((message) => message['type'] == 'prompt.submit'),
        isEmpty,
      );
      socket.server(
        response('command.current.result', {
          'commandId': commandId,
          'state': 'accepted',
        }),
      );
      await eventually(() => coordinator.pendingCommandId == null);
      expect(coordinator.draft, isEmpty);
    },
  );

  test(
    'host generation reset quarantines command and keeps draft text',
    () async {
      await makeReady(coordinator, transport);
      await coordinator.updateDraft('Keep across restore');
      await coordinator.submitPrompt();

      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.last;
      socket.server(helloAccepted(generation: '2'));
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'subscription.set'),
      );
      final subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId']);
      final stream =
          ((subscription['payload'] as Map)['streams'] as List).single as Map;
      expect(stream.containsKey('afterCursor'), isFalse);
      expect(coordinator.selectedSessionId, isNull);
      expect(coordinator.pendingCommandId, isNull);
      expect(coordinator.draft, 'Keep across restore');
      expect(coordinator.rawEvents, isEmpty);
      final quarantined = await database.draft(hostId, sessionId);
      expect(quarantined?.draftText, 'Keep across restore');
      expect(quarantined?.pendingCommandId, isNull);
      expect(quarantined?.pendingPayloadJson, isNull);
    },
  );

  test('receipt below accepted preserves pending command and draft', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    await coordinator.updateDraft('Keep me');
    await coordinator.submitPrompt();
    final prompt = socket.sent.lastWhere(
      (message) => message['type'] == 'prompt.submit',
    );

    socket.server(
      response('command.receipt', {
        'state': 'received',
        'duplicate': false,
      }, commandId: prompt['commandId'] as String),
    );
    await eventually(() => coordinator.pendingState == 'received');
    expect(coordinator.pendingCommandId, isNotNull);
    expect(coordinator.draft, 'Keep me');

    socket.server(
      response('command.current.result', {
        'commandId': prompt['commandId'] as String,
        'state': 'indeterminate',
      }),
    );
    await eventually(() => coordinator.pendingState == 'indeterminate');
    expect(coordinator.pendingCommandId, isNotNull);
    expect(coordinator.draft, 'Keep me');

    socket.server(
      response('command.receipt', {
        'state': 'accepted',
        'duplicate': false,
      }, commandId: prompt['commandId'] as String),
    );
    await eventually(() => coordinator.pendingCommandId == null);
    expect(coordinator.draft, isEmpty);
  });
}

Future<void> makeReady(
  ConnectionCoordinator coordinator,
  FakeBridgeTransport transport,
) async {
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.sockets.single;
  socket.server(helloAccepted());
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
      type: 'controller.state',
      streamId: 'session:$sessionId',
      cursor: '1',
      eventId: '99999999-9999-4999-8999-999999999999',
      payload: {
        'scope': 'session',
        'sessionId': sessionId,
        'mode': 'controller',
        'leaseId': leaseId,
      },
    ),
  );
  await eventually(() => coordinator.leaseId == leaseId);
}

void socketHandshake(
  FakeBridgeSocket socket, {
  required bool includeSession,
  required String hostCursor,
  required String sessionCursor,
}) {
  socket.server(helloAccepted());
  unawaited(() async {
    await eventually(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    );
    socket.server(
      response('subscription.accepted', {
        'streams': [
          {'streamId': 'host:$hostId', 'mode': 'current'},
          if (includeSession)
            {'streamId': 'session:$sessionId', 'mode': 'current'},
        ],
      }),
    );
    socket.server(
      response('stream.sync.complete', {
        'streamId': 'host:$hostId',
        'currentCursor': hostCursor,
        'mode': 'current',
      }, requestId: null),
    );
    if (includeSession) {
      socket.server(
        response('stream.sync.complete', {
          'streamId': 'session:$sessionId',
          'currentCursor': sessionCursor,
          'mode': 'current',
        }, requestId: null),
      );
    }
  }());
}

List<String> streamIds(Map<String, Object?> subscription) =>
    ((subscription['payload'] as Map)['streams'] as List)
        .map((item) => (item as Map)['streamId'] as String)
        .toList();

Map<String, Object?> helloAccepted({String generation = '1'}) =>
    response('hello.accepted', {
      'connectionId': connectionId,
      'hostId': hostId,
      'hostGeneration': generation,
      'hostDisplayName': 'Fixture host',
      'bridgeVersion': 'm5',
      'piVersion': '0.80.6',
      'serverTime': '2026-07-13T00:00:00.000Z',
      'capabilities': ['streams.v1', 'commands.v1', 'controller_leases.v1'],
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

Map<String, Object?> event({
  required String type,
  required String streamId,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  ...response(type, payload, requestId: null),
  'eventId': eventId,
  'streamId': streamId,
  'cursor': cursor,
};

Map<String, Object?> response(
  String type,
  Map<String, Object?> payload, {
  String? requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  String? commandId,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'requestId': ?requestId,
  'commandId': ?commandId,
  'type': type,
  'sentAt': DateTime.utc(2026, 7, 13).toIso8601String(),
  'payload': payload,
};

Future<void> eventually(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 3),
}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) throw TestFailure('Condition was not met');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class FakeBridgeTransport implements BridgeTransport {
  final List<FakeBridgeSocket> sockets = [];

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

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
