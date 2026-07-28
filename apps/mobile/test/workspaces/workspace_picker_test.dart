import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/workspaces/workspace_picker.dart';

const _hostId = '11111111-1111-4111-8111-111111111111';
const _sessionId = '22222222-2222-4222-8222-222222222222';
const _connectionId = '44444444-4444-4444-8444-444444444444';
const _workspaceId = '33333333-3333-4333-8333-333333333333';

/// Exact reproduction of the connected-host Android bug.
///
/// Reproduction flow (the bug the user filed from the running Android
/// client against https://nathans-macbook-pro.tail7d5b8e.ts.net:8788):
///
///   1. App pairs successfully — `ConnectionPhase.ready` and the chat
///      session drawer surfaces its "Bridge connected" pill.
///   2. User taps "Choose a folder" to open the workspace picker.
///   3. User types `github` into the "Filter indexed folders" field.
///   4. The picker issues `workspace.search` against the live bridge.
///   5. The bridge rejects `workspace.search` with
///      `unsupported_capability` because the post-rectification runtime
///      only stubs that control (see packages/bridge/src/core/runtime.ts).
///   6. The mobile's `_serverError` handler treats that single
///      per-request rejection as a connection-fatal protocol failure and
///      transitions `phase` from `ready` to `incompatible`.
///   7. On the very next keystroke (or after the 200 ms debounce window)
///      `searchWorkspaces()` re-enters with the new query and the
///      `if (!isReady)` branch fires because `phase != ready`. The picker
///      surfaces the misleading "Offline. Reconnect to search
///      workspaces." message and never re-runs the search.
///
/// This test pins the bug at the picker boundary, where the user
/// actually sees the failure. A passing run guarantees that the
/// connected-host picker surface never reports a single-feature
/// rejection as if the bridge itself were unreachable.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'connected host picker: workspace.search rejection does not poison the '
    'connection or surface the misleading Offline message',
    (tester) async {
      final fixture = await _connectedPickerFixture(tester);

      try {
        await _runConnectedHostScenario(tester, fixture);
      } finally {
        // The coordinator's sync-complete handler installs a periodic
        // ack timer. Cancel it BEFORE the test binding's
        // `_verifyInvariants` runs so the binding does not flag the
        // test as leaking a Timer.
        await fixture.dispose();
      }
    },
  );
}

Future<void> _runConnectedHostScenario(
  WidgetTester tester,
  _PickerFixture fixture,
) async {
  // 1) The drawer / picker should reflect the healthy connection
  //    exactly as the user reported.
  expect(fixture.coordinator.isReady, isTrue);
  expect(fixture.coordinator.phase, ConnectionPhase.ready);

  // 2) Open the picker. The picker is mounted inside the real
  //    `WorkspacePicker` widget so we exercise the production
  //    surface — not a coordinator-only test stub.
  await tester.pumpWidget(_pickerApp(fixture.coordinator));
  expect(find.byKey(const Key('workspace-search-field')), findsOneWidget);

  // 3) Drive the exact bug scenario: issue a real `workspace.search`
  //    against the live bridge. We bypass the TextField onChanged ->
  //    200 ms debounce path because that debounce timer schedules a
  //    Dart Timer, which the picker state cancels and reschedules on
  //    every keystroke and which is not the locus of the bug. The
  //    data flow that matters is
  //    `searchWorkspaces` → `_sendControl('workspace.search', …)` →
  //    bridge reply → `_serverError`, and that is exactly what this
  //    call drives.
  await tester.runAsync(() async {
    await fixture.coordinator.searchWorkspaces('github');
    await _waitFor(
      () => fixture.socket.sent.any(
        (message) => message['type'] == 'workspace.search',
      ),
      label: 'workspace.search control request reaches the wire',
    );
    final searchRequest = fixture.socket.sent.firstWhere(
      (message) => message['type'] == 'workspace.search',
    );
    final requestId = (searchRequest['requestId'] as String?) ?? '';
    fixture.socket.server(
      _errorResponse(
        code: 'unsupported_capability',
        message: 'workspace search is not available on this host',
        requestId: requestId,
      ),
    );
  });

  // 4) Wait for the mobile to surface the error and stop in the
  //    `error` phase. The bug currently leaves the picker spinning
  //    because `_serverError` does not correlate the error response
  //    back to the in-flight workspace search.
  await tester.runAsync(() async {
    await _waitFor(
      () =>
          fixture.coordinator.workspaceSearch.phase ==
          WorkspaceSearchPhase.error,
      label: 'workspace search transitions to error with a message',
    );
  });

  // 5) The bridge is healthy — phase must still be `ready` after a
  //    per-request rejection of one optional control.
  expect(
    fixture.coordinator.phase,
    ConnectionPhase.ready,
    reason:
        'A single `unsupported_capability` rejection must not demote the '
        'overall connection to incompatible. That transition is reserved '
        'for protocol-fatal failures at the handshake boundary.',
  );
  expect(fixture.coordinator.isReady, isTrue);

  // 6) The error surfaced to the picker MUST come from the bridge,
  //    not from the misleading `Offline. Reconnect to search
  //    workspaces.` string the current code path emits when `isReady`
  //    flips to false after the phase downgrade.
  final searchState = fixture.coordinator.workspaceSearch;
  expect(searchState.phase, WorkspaceSearchPhase.error);
  expect(searchState.error, isNotNull);
  expect(
    searchState.error,
    isNot(contains('Offline')),
    reason:
        'Picker must never surface the generic "Offline. Reconnect to '
        'search workspaces." string when the bridge is healthy and only '
        'a single optional control was rejected.',
  );
  expect(
    searchState.error,
    contains('workspace search is not available on this host'),
  );

  // 7) The picker must render that bridge-side message verbatim,
  //    proving the user sees a truthful explanation of the rejection
  //    instead of a misleading connectivity warning. The coordinator's
  //    frame-coalesced `_notify()` schedules `notifyListeners()` on a
  //    post-frame callback; pump a few frames so the picker's
  //    ChangeNotifier listener runs and the error text lands in the
  //    widget tree.
  for (var frame = 0; frame < 5; frame++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
  expect(find.byKey(const Key('workspace-search-error')), findsOneWidget);
  expect(
    find.textContaining('workspace search is not available on this host'),
    findsOneWidget,
  );
  expect(find.text('Offline. Reconnect to search workspaces.'), findsNothing);

  // 8) A follow-up search must still flow because the connection was
  //    never demoted. If the bug were present the next call would
  //    short-circuit on `if (!isReady)` and never emit a wire request
  //    — the exact symptom the user filed from the running Android
  //    client.
  final firstRequestCount = fixture.socket.sent
      .where((message) => message['type'] == 'workspace.search')
      .length;
  await tester.runAsync(() async {
    await fixture.coordinator.searchWorkspaces('githu');
    await _waitFor(
      () =>
          fixture.socket.sent
              .where((message) => message['type'] == 'workspace.search')
              .length >
          firstRequestCount,
      label: 'follow-up workspace.search request reaches the wire',
    );
  });
}

Future<_PickerFixture> _connectedPickerFixture(WidgetTester tester) async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: _hostId,
      endpoint: 'https://fixture.test',
      displayName: 'Fixture host',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  final transport = _PickerTransport();
  final coordinator = ConnectionCoordinator(
    transport: transport,
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.socket!;
  socket.server(_helloAcceptedResponse());
  await tester.runAsync(() async {
    await _waitFor(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
      label: 'subscription.set request reaches the wire',
    );
  });
  socket.server(_subscriptionAcceptedResponse());
  socket.server(
    _response('stream.sync.complete', <String, Object?>{
      'streamId': 'host:$_hostId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  socket.server(
    _response('stream.sync.complete', <String, Object?>{
      'streamId': 'session:$_sessionId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await tester.runAsync(() async {
    await _waitFor(
      () => coordinator.isReady && coordinator.historyGateComplete,
      label: 'coordinator reaches ready + historyGateComplete',
    );
  });
  // Seed a single workspace so the picker renders the recent list.
  coordinator.debugSeedWorkspaces(<Map<String, Object?>>[
    <String, Object?>{
      'workspaceId': _workspaceId,
      'displayName': 'Home folder',
      'rootLabel': 'home',
      'relativePath': '.',
      'availability': 'available',
      'fingerprint': 'fixture-fingerprint',
      'policyVersion': 'fixture-policy',
      'manifest': <Map<String, Object?>>[],
    },
  ]);
  return _PickerFixture(database, coordinator, transport, socket);
}

Widget _pickerApp(ConnectionCoordinator coordinator) => MaterialApp(
  home: Scaffold(
    body: SizedBox(
      width: 420,
      height: 760,
      child: WorkspacePicker(
        coordinator: coordinator,
        onSelect: (_) {},
        onCancel: () {},
      ),
    ),
  ),
);

Future<void> _waitFor(
  bool Function() condition, {
  Duration step = const Duration(milliseconds: 5),
  Duration timeout = const Duration(seconds: 5),
  required String label,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (condition()) return;
    await Future<void>.delayed(step);
  }
  throw TestFailure('Condition was not met: $label');
}

Map<String, Object?> _helloAcceptedResponse() =>
    _response('hello.accepted', <String, Object?>{
      'connectionId': _connectionId,
      'hostId': _hostId,
      'hostGeneration': '1',
      'hostDisplayName': 'Fixture host',
      'bridgeVersion': 'test',
      'piVersion': '0.82.0',
      'serverTime': '2026-07-28T00:00:00.000Z',
      'capabilities': <String>[
        'streams.v1',
        'commands.v1',
        'controller_leases.v1',
      ],
      'limits': <String, Object?>{
        'maxJsonBytes': 1048576,
        'maxAttachmentBytes': 10485760,
        'maxAttachmentsPerPrompt': 4,
        'maxPromptAttachmentBytes': 26214400,
        'maxQueuedFollowUps': 10,
        'maxSessionPageSize': 100,
        'maxBackgroundSessionSubscriptions': 5,
      },
    });

Map<String, Object?> _subscriptionAcceptedResponse() =>
    _response('subscription.accepted', <String, Object?>{
      'streams': <Map<String, Object?>>[
        <String, Object?>{'streamId': 'host:$_hostId', 'mode': 'current'},
        <String, Object?>{'streamId': 'session:$_sessionId', 'mode': 'current'},
      ],
    });

Map<String, Object?> _response(
  String type,
  Map<String, Object?> payload, {
  String? requestId,
}) {
  return <String, Object?>{
    'protocol': const <String, Object?>{'major': 1, 'minor': 0},
    'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'requestId': ?requestId,
    'type': type,
    'sentAt': '2026-07-28T00:00:00.000Z',
    'payload': payload,
  };
}

Map<String, Object?> _errorResponse({
  required String code,
  required String message,
  required String requestId,
}) => _response('error', <String, Object?>{
  'code': code,
  'message': message,
  'retryable': false,
  'details': <String, Object?>{},
}, requestId: requestId);

final class _PickerFixture {
  _PickerFixture(this.database, this.coordinator, this.transport, this.socket);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;
  final _PickerTransport transport;
  final _PickerSocket socket;

  Future<void> dispose() async {
    coordinator.dispose();
    await database.close();
  }
}

final class _PickerTransport implements BridgeTransport {
  _PickerSocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: <String, Object?>{'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async => socket = _PickerSocket();
}

final class _PickerSocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = <Map<String, Object?>>[];

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) =>
      _messages.add(jsonEncode(message));

  @override
  Future<void> close([int? code, String? reason]) => _messages.close();
}
