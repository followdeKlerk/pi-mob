import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/main.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('shell exposes one Chat surface without destination tabs', (
    tester,
  ) async {
    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();

    expect(find.text('Saved chat'), findsOneWidget);
    expect(find.byKey(const Key('open-chat-drawer')), findsOneWidget);
    expect(find.byKey(const Key('open-transcript-search')), findsOneWidget);
    expect(find.byKey(const Key('open-chat-controls')), findsNothing);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byKey(const Key('shell-sessions')), findsNothing);
    expect(find.byKey(const Key('shell-activity')), findsNothing);
    expect(find.byKey(const Key('shell-host')), findsNothing);
    expect(find.byKey(const Key('host-destination-scroll')), findsNothing);
    expect(find.byKey(const Key('composer-card')), findsOneWidget);
  });

  testWidgets('hamburger opens saved chats without repeating host identity', (
    tester,
  ) async {
    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();
    await tester.tap(find.byKey(const Key('open-chat-drawer')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('chat-session-drawer')), findsOneWidget);
    expect(find.byKey(const Key('saved-chat-list')), findsOneWidget);
    expect(find.text('Saved chat'), findsWidgets);
    expect(find.textContaining('Fixture host'), findsNothing);
    expect(find.byKey(const Key('new-chat-button')), findsOneWidget);
    expect(find.byKey(const Key('change-chat-folder')), findsNothing);
    expect(find.text('Choose folder'), findsNothing);
    expect(
      find.byKey(
        const Key('chat-actions-22222222-2222-4222-8222-222222222222'),
      ),
      findsOneWidget,
    );
    // M16-02: the saved-chat row shows a status pill.
    expect(
      find.byKey(const Key('chat-pill-22222222-2222-4222-8222-222222222222')),
      findsOneWidget,
    );
  });

  _m16Affordances();

  testWidgets('New chat still begins with required workspace selection', (
    tester,
  ) async {
    final fixture = await _readyFixture();
    try {
      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      await tester.pump();
      await tester.tap(find.byKey(const Key('activity-empty-go-sessions')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-chat-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('workspace-picker-title')), findsOneWidget);
      expect(find.byKey(const Key('new-chat-agent-picker')), findsNothing);
      expect(find.byKey(const Key('change-chat-folder')), findsNothing);
    } finally {
      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      await fixture.database.close();
    }
  });

  testWidgets('empty model catalogue creates a chat with the Pi default agent', (
    tester,
  ) async {
    final fixture = await _readyFixture();
    const workspaceId = '55555555-5555-4555-8555-555555555555';
    const newSessionId = '66666666-6666-4666-8666-666666666666';
    fixture.coordinator.debugSeedWorkspaces(const [
      {
        'workspaceId': workspaceId,
        'displayName': 'mobile',
        'rootLabel': '/Users/test',
        'relativePath': 'mobile',
        'availability': 'available',
        'trustState': 'approved',
        'fingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'policyVersion': '1',
        'manifest': <Map<String, Object?>>[],
      },
    ]);
    final socket = fixture.transport!.socket!;

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();
    await tester.tap(find.byKey(const Key('activity-empty-go-sessions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('new-chat-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('workspace-tile-$workspaceId')));
    await _pumpUntil(
      tester,
      () => socket.sent.any((message) => message['type'] == 'model.list'),
    );

    final modelRequest = socket.sent.lastWhere(
      (message) => message['type'] == 'model.list',
    );
    socket.server(
      _response('model.list.result', const {
        'items': <Object?>[],
      }, requestId: modelRequest['requestId'] as String),
    );
    await _pumpUntil(
      tester,
      () => socket.sent.any((message) => message['type'] == 'session.create'),
    );
    final create = socket.sent.lastWhere(
      (message) => message['type'] == 'session.create',
    );
    final createPayload = create['payload'] as Map<String, Object?>;
    expect(createPayload.containsKey('modelId'), isFalse);
    expect(createPayload.containsKey('provider'), isFalse);

    socket.server(
      _event(
        type: 'session.summary',
        streamId: 'host:11111111-1111-4111-8111-111111111111',
        cursor: '1',
        eventId: '77777777-7777-4777-8777-777777777777',
        payload: {
          'sessionId': newSessionId,
          'workspaceId': workspaceId,
          'name': 'mobile',
          'runtimeState': 'idle',
          'queueCount': 0,
          'change': 'added',
          'createdByCommandId': create['commandId'],
        },
      ),
    );
    await _pumpUntil(
      tester,
      () => fixture.coordinator.selectedSessionId == newSessionId,
    );
    expect(
      fixture.coordinator.sessionCreation.phase,
      SessionCreationPhase.created,
    );
    fixture.coordinator.dispose();
    await tester.pumpWidget(const SizedBox.shrink());
    await fixture.database.close();
  });

  testWidgets('empty Chat opens the same saved-chat drawer', (tester) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();

    expect(find.byKey(const Key('activity-empty-state')), findsOneWidget);
    expect(find.text('Open chats'), findsOneWidget);
    await tester.tap(find.byKey(const Key('activity-empty-go-sessions')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('chat-session-drawer')), findsOneWidget);
    expect(find.text('No saved chats yet'), findsOneWidget);
  });
}

Future<_Fixture> _fixture({bool withSession = false}) async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  const hostId = '11111111-1111-4111-8111-111111111111';
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: hostId,
      endpoint: 'https://fixture.test',
      displayName: 'Fixture host',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  if (withSession) {
    await database.upsertSessionState(
      const SessionState(
        sessionId: '22222222-2222-4222-8222-222222222222',
        hostId: hostId,
        name: 'Saved chat',
        runtimeState: 'idle',
        queueCount: 0,
      ),
    );
  }
  final coordinator = ConnectionCoordinator(
    transport: _OfflineTransport(),
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  return _Fixture(database, coordinator);
}

final class _Fixture {
  const _Fixture(this.database, this.coordinator, [this.transport]);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;
  final _ReadyTransport? transport;

  Future<void> dispose() async {
    coordinator.dispose();
    await database.close();
  }
}

Future<_Fixture> _readyFixture() async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  const hostId = '11111111-1111-4111-8111-111111111111';
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: hostId,
      endpoint: 'https://fixture.test',
      displayName: 'Fixture host',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  final transport = _ReadyTransport();
  final coordinator = ConnectionCoordinator(
    transport: transport,
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.socket!;
  socket.server(
    _response('hello.accepted', {
      'connectionId': '44444444-4444-4444-8444-444444444444',
      'hostId': hostId,
      'hostGeneration': '1',
      'hostDisplayName': 'Fixture host',
      'bridgeVersion': 'test',
      'piVersion': '0.80.6',
      'serverTime': '2026-07-20T00:00:00.000Z',
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
    }),
  );
  await _eventually(
    () => socket.sent.any((message) => message['type'] == 'subscription.set'),
  );
  socket.server(
    _response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$hostId', 'mode': 'current'},
      ],
    }),
  );
  socket.server(
    _response('stream.sync.complete', {
      'streamId': 'host:$hostId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await _eventually(
    () => coordinator.isReady && coordinator.historyGateComplete,
  );
  return _Fixture(database, coordinator, transport);
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await tester.pump(const Duration(milliseconds: 10));
  }
  throw TestFailure('Widget condition was not met');
}

Future<void> _eventually(bool Function() condition) async {
  for (var attempt = 0; attempt < 1000; attempt++) {
    if (condition()) return;
    await Future<void>.microtask(() {});
  }
  throw TestFailure('Condition was not met');
}

Map<String, Object?> _event({
  required String type,
  required String streamId,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  ..._response(type, payload, requestId: null),
  'eventId': eventId,
  'streamId': streamId,
  'cursor': cursor,
};

Map<String, Object?> _response(
  String type,
  Map<String, Object?> payload, {
  String? requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'requestId': ?requestId,
  'type': type,
  'sentAt': '2026-07-20T00:00:00.000Z',
  'payload': payload,
};

final class _ReadyTransport implements BridgeTransport {
  _ReadySocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    return socket = _ReadySocket();
  }
}

final class _ReadySocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) {
    _messages.add(jsonEncode(message));
  }

  @override
  Future<void> close([int? code, String? reason]) => _messages.close();
}

final class _OfflineTransport implements BridgeTransport {
  @override
  Future<BridgeSocket> connect(Uri endpoint) => throw const _Offline();

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}

final class _Offline implements Exception {
  const _Offline();
}

void _m16Affordances() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'app bar shows a SessionStatePill for the selected chat runtime',
    (tester) async {
      final fixture = await _fixture(withSession: true);
      addTearDown(fixture.dispose);

      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      await tester.pump();

      expect(find.byKey(const Key('app-bar-state-pill')), findsOneWidget);
      expect(find.byKey(const Key('app-bar-role')), findsOneWidget);
    },
  );

  testWidgets('app bar exposes a discoverable commands affordance', (
    tester,
  ) async {
    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();

    expect(find.byKey(const Key('open-commands')), findsOneWidget);
  });

  testWidgets(
    'tapping the commands affordance opens a bottom sheet with the palette',
    (tester) async {
      final fixture = await _fixture(withSession: true);
      addTearDown(fixture.dispose);

      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      await tester.pump();

      await tester.tap(find.byKey(const Key('open-commands')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('command-search')), findsOneWidget);
      expect(find.text('Show available skills'), findsOneWidget);
      expect(find.text('Connection status'), findsOneWidget);
    },
  );

  testWidgets('commands sheet renders at 200% text scale without overflow', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(360, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
        child: PiMobApp(coordinator: fixture.coordinator),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('open-commands')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('command-search')), findsOneWidget);
  });
}
