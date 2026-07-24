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

/// Bounded replacement for `pumpAndSettle` — the search sheet hosts a
/// continuously animating `CircularProgressIndicator` that prevents
/// `pumpAndSettle` from ever settling. Pump a fixed budget of frames
/// while the [condition] is false, then return. The caller asserts on
/// the widget state. If [label] is provided it is included in the
/// `TestFailure` raised when the budget is exhausted so a missing
/// affordance never silently passes.
Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() condition, {
  int frames = 30,
  Duration step = const Duration(milliseconds: 16),
  String? label,
}) async {
  for (var i = 0; i < frames; i++) {
    if (condition()) return;
    await tester.pump(step);
  }
  throw TestFailure(
    label == null
        ? 'pumpUntil budget exhausted'
        : 'pumpUntil budget exhausted waiting for $label',
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('global search sheet is reachable from the app bar', (
    tester,
  ) async {
    final fixture = await _readyFixture(tester);
    final socket = fixture.transport.socket!;
    // Seed one authoritative session.summary so the chat app-bar actions
    // (which include `open-global-search`) are rendered. Without a
    // selected session the app bar shows only the empty-shell title.
    socket.server(
      _sessionSummary(
        _sessionA,
        cursor: '1',
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Solo chat',
      ),
    );
    try {
      await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
      // The IconButton sits inside an AppBar whose layout is scheduled
      // after the coordinator's frame-coalesced first build AND after
      // the host-side session summary auto-selects a chat. Pump until
      // the key resolves before tapping so we never miss the click.
      await _pumpUntil(
        tester,
        () => find.byKey(const Key('open-global-search')).evaluate().isNotEmpty,
        label: 'open-global-search after session summary auto-select',
      );
      await tester.tap(find.byKey(const Key('open-global-search')));
      await _pumpUntil(
        tester,
        () =>
            find.byKey(const Key('global-search-input')).evaluate().isNotEmpty,
      );
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
      final fixture = await _readyFixture(tester);
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
          payload: {'message': 'compare flight tax and lodging across cities'},
        ),
      );
      try {
        await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
        await _pumpUntil(
          tester,
          () =>
              find.byKey(const Key('open-global-search')).evaluate().isNotEmpty,
        );
        await tester.tap(find.byKey(const Key('open-global-search')));
        await _pumpUntil(
          tester,
          () => find
              .byKey(const Key('global-search-input'))
              .evaluate()
              .isNotEmpty,
        );
        await tester.enterText(
          find.byKey(const Key('global-search-input')),
          'tax',
        );
        // Poll `searchNow` until BOTH authoritative session events
        // surface as hits. The DB-count gate (e.g. >= 2 rows) is too
        // weak because per-session title rows inflate the count
        // independently of turn events; asserting on the exact hit
        // ID set reveals any real indexing or query bug.
        const expectedHitIds = <String>{
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        };
        await tester.runAsync(() async {
          await _waitForAsync(() async {
            final results = await fixture.coordinator.globalSearchController
                .searchNow('tax');
            final ids = results.hits.map((h) => h.eventId).toSet();
            return expectedHitIds.every(ids.contains);
          });
        });
        await _pumpUntil(
          tester,
          () => find
              .byKey(const Key('global-search-results'))
              .evaluate()
              .isNotEmpty,
        );
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
    final fixture = await _readyFixture(tester);
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
      // Open the sheet ONCE via the public helper, using a context that
      // descends from MaterialApp (Scaffold subtree) so the modal route
      // is anchored correctly. Pass onResultTap here so the hit
      // handler is captured without stacking a second sheet on top of
      // the one already open via the app-bar button.
      final tapResult = showGlobalSearch(
        tester.element(find.byType(Scaffold).first),
        fixture.coordinator,
        onResultTap: (hit) => captured = hit,
      );
      await _pumpUntil(
        tester,
        () =>
            find.byKey(const Key('global-search-input')).evaluate().isNotEmpty,
      );
      // Complete the finite modal route transition before entering
      // real-time async polling. FakeAsync does not advance route animation
      // frames while `runAsync` is active.
      for (var frame = 0; frame < 20; frame++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      await tester.enterText(
        find.byKey(const Key('global-search-input')),
        'alpha',
      );
      // Poll `searchNow` until the authoritative hit ID surfaces. We
      // assert on the exact hit ID set (not a row count) so the gate
      // fails loudly if the indexer skips an authoritative cached
      // event.
      const expectedHitIds = <String>{'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
      await tester.runAsync(() async {
        await _waitForAsync(() async {
          final results = await fixture.coordinator.globalSearchController
              .searchNow('alpha');
          final ids = results.hits.map((h) => h.eventId).toSet();
          return expectedHitIds.every(ids.contains);
        });
      });
      final hitFinder = find.byKey(
        const Key('global-search-hit-cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      );
      await _pumpUntil(
        tester,
        () => hitFinder.evaluate().isNotEmpty,
        label: 'hit key for cccc',
      );
      // Dismiss the test keyboard before scrolling the result into the
      // sheet viewport; otherwise its 270 px inset can leave the tile's
      // center below the 600 px test surface even after ensureVisible.
      tester.testTextInput.hide();
      await tester.pump();
      await tester.scrollUntilVisible(
        hitFinder,
        120,
        scrollable: find.descendant(
          of: find.byKey(const Key('global-search-results')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pump();
      await tester.tap(hitFinder);
      await _pumpUntil(
        tester,
        () => find.byKey(const Key('global-search-input')).evaluate().isEmpty,
        label: 'sheet dismissed after hit tap',
      );
      // `selectSession` is unawaited by the sheet, so the selection
      // races against the close animation. Poll in real time until the
      // coordinator reflects the chosen session AND the captured
      // callback fired.
      await tester.runAsync(() async {
        await _waitForAsync(
          () async =>
              fixture.coordinator.selectedSessionId == _sessionA &&
              captured != null,
        );
      });
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

Future<_Fixture> _readyFixture(WidgetTester tester) async {
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
      'piVersion': '0.82.0',
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
  await tester.runAsync(
    () => _waitFor(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    ),
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
  await tester.runAsync(
    () =>
        _waitFor(() => coordinator.isReady && coordinator.historyGateComplete),
  );
  return _Fixture(database, coordinator, transport);
}

/// Polls [condition] on real wall-clock time. Must be called from within
/// `tester.runAsync(...)` so the real `Future.delayed` advances outside
/// the FakeAsync zone used by `testWidgets`.
Future<void> _waitFor(
  bool Function() condition, {
  Duration step = const Duration(milliseconds: 1),
  Duration timeout = const Duration(seconds: 2),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (condition()) return;
    await Future<void>.delayed(step);
  }
  throw TestFailure('Condition was not met');
}

/// Same polling discipline as [_waitFor] but for asynchronous conditions
/// such as `database.searchEntryCountForHost(...)`. The lambda's returned
/// `FutureOr<bool>` is awaited on every tick; comparison happens after
/// the awaited value resolves. Must be called from within
/// `tester.runAsync(...)` so the real `Future.delayed` advances outside
/// the FakeAsync zone used by `testWidgets`.
Future<void> _waitForAsync(
  FutureOr<bool> Function() condition, {
  Duration step = const Duration(milliseconds: 1),
  Duration timeout = const Duration(seconds: 2),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (await condition()) return;
    await Future<void>.delayed(step);
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
