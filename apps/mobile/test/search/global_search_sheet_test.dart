import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/main.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/search/search_hits.dart';
import 'package:pi_mob/src/ui/shell/global_search_sheet.dart';

const _hostId = '11111111-1111-4111-8111-111111111111';
const _sessionA = '22222222-2222-4222-8222-222222222222';
const _sessionB = '33333333-3333-4333-8333-333333333333';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('global search sheet is reachable from the app bar', (
    tester,
  ) async {
    final fixture = await _readyFixture();
    try {
      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      await tester.pump();
      await tester.tap(find.byKey(const Key('open-global-search')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('global-search-input')), findsOneWidget);
      expect(find.byKey(const Key('global-search-footnote')), findsOneWidget);
    } finally {
      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      await fixture.database.close();
    }
  });

  testWidgets(
    'typing in the sheet triggers a debounced search and lists hits',
    (tester) async {
      final fixture = await _readyFixture();
      final socket = fixture.transport.socket!;
      socket.server(
        _sessionSummary(
          _sessionA,
          cursor: '1',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Tax chat',
        ),
      );
      socket.server(
        _sessionSummary(
          _sessionB,
          cursor: '2',
          eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Travel chat',
        ),
      );
      socket.server(
        _event(
          type: 'turn.started',
          streamId: 'session:$_sessionA',
          cursor: '1',
          eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          payload: {'message': 'what is the marginal tax rate'},
        ),
      );
      socket.server(
        _event(
          type: 'turn.started',
          streamId: 'session:$_sessionB',
          cursor: '1',
          eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          payload: {'message': 'compare flight taxes across cities'},
        ),
      );
      try {
        await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
        await tester.pump();
        await tester.tap(find.byKey(const Key('open-global-search')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('global-search-input')),
          'tax',
        );
        await _eventually(
          () => fixture.coordinator.globalSearchController.searchNow('tax'),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('global-search-results')), findsOneWidget);
        expect(
          find.byKey(
            const Key('global-search-hit-cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(
            const Key('global-search-hit-dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
          ),
          findsOneWidget,
        );
      } finally {
        fixture.coordinator.dispose();
        await tester.pumpWidget(const SizedBox.shrink());
        await fixture.database.close();
      }
    },
  );

  testWidgets('tapping a result selects the chat and dismisses the sheet', (
    tester,
  ) async {
    final fixture = await _readyFixture();
    final socket = fixture.transport.socket!;
    socket.server(
      _sessionSummary(
        _sessionA,
        cursor: '1',
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Solo chat',
      ),
    );
    socket.server(
      _event(
        type: 'turn.started',
        streamId: 'session:$_sessionA',
        cursor: '1',
        eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        payload: {'message': 'analyse the alpha data set please'},
      ),
    );
    SearchHit? captured;
    try {
      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      await tester.pump();
      await tester.tap(find.byKey(const Key('open-global-search')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('global-search-input')),
        'alpha',
      );
      await _eventually(
        () => fixture.coordinator.globalSearchController.searchNow('alpha'),
      );
      await tester.pumpAndSettle();
      final tapResult = showGlobalSearch(
        tester.element(find.byType(MaterialApp)),
        fixture.coordinator,
        onResultTap: (hit) => captured = hit,
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('global-search-input')),
        'alpha',
      );
      await _eventually(
        () => fixture.coordinator.globalSearchController.searchNow('alpha'),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(
          const Key('global-search-hit-cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        ),
      );
      await tester.pumpAndSettle();
      expect(fixture.coordinator.selectedSessionId, _sessionA);
      expect(captured?.sessionId, _sessionA);
      expect(find.byKey(const Key('global-search-input')), findsNothing);
      await tapResult;
    } finally {
      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      await fixture.database.close();
    }
  });
}

Future<_Fixture> _readyFixture() async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  const hostId = _hostId;
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
  await _waitFor(
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
  await _waitFor(() => coordinator.isReady && coordinator.historyGateComplete);
  return _Fixture(database, coordinator, transport);
}

Future<void> _waitFor(bool Function() condition, {int attempts = 1000}) async {
  for (var i = 0; i < attempts; i++) {
    if (condition()) return;
    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
  throw TestFailure('Condition was not met');
}

Map<String, Object?> _sessionSummary(
  String sessionId, {
  required String cursor,
  required String eventId,
  String name = 'Saved chat',
}) => _event(
  type: 'session.summary',
  streamId: 'host:$_hostId',
  cursor: cursor,
  eventId: eventId,
  payload: {
    'sessionId': sessionId,
    'name': name,
    'runtimeState': 'idle',
    'queueCount': 0,
  },
);

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
  String? requestId,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'requestId': ?requestId,
  'type': type,
  'sentAt': '2026-07-20T00:00:00.000Z',
  'payload': payload,
};

Future<void> _eventually(
  FutureOr<SearchResults> Function() condition, {
  int attempts = 1000,
}) async {
  for (var i = 0; i < attempts; i++) {
    final value = await condition();
    if (value.hits.isNotEmpty) return;

    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
  throw TestFailure('Condition was not met');
}

final class _Fixture {
  const _Fixture(this.database, this.coordinator, this.transport);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;
  final _ReadyTransport transport;
}

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
