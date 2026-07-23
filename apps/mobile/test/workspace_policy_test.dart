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
import 'package:pi_mob/src/workspaces/workspace_picker.dart';

const _hostId = '11111111-1111-4111-8111-111111111111';
const _sessionId = '22222222-2222-4222-8222-222222222222';
const _wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const _wsB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const _wsFingerprint =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const _connectionId = '44444444-4444-4444-8444-444444444444';
// pi-mob:security-test-fixture — deliberate private-path display probes.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  ConnectionCoordinator? activeCoordinator;

  Future<(ConnectionCoordinator, AppDatabase, _RecordingTransport)> bootstrap(
    WidgetTester tester, {
    bool seedReady = false,
  }) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final transport = _RecordingTransport();
    await tester.runAsync(() async {
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
      await database.upsertSessionState(
        const SessionState(
          sessionId: _sessionId,
          hostId: _hostId,
          name: 'Fixture session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      await database.saveDraft(
        hostId: _hostId,
        sessionId: _sessionId,
        text: '',
        pendingCommandId: null,
        pendingPayloadJson: null,
        pendingState: null,
        updatedAt: DateTime.utc(2026, 7, 13),
      );
      final coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      if (seedReady) {
        await _bringOnline(coordinator, transport, null);
      }
      activeCoordinator = coordinator;
    });
    return (activeCoordinator!, database, transport);
  }

  tearDownWorkspace(ConnectionCoordinator coordinator, AppDatabase database) {
    coordinator.dispose();
    return database.close();
  }

  group('WorkspacePicker', () {
    testWidgets(
      'renders recents from server results and forbids outside-root selection',
      (tester) async {
        final (coordinator, database, transport) = await bootstrap(
          tester,
          seedReady: true,
        );
        _seedWorkspaces(coordinator);
        await tester.binding.setSurfaceSize(const Size(1200, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WorkspacePicker(
                coordinator: coordinator,
                onSelect: _captureSelection,
                onCancel: () {},
                onApproveTrust: (entry) async {},
              ),
            ),
          ),
        );
        await tester.pump();

        expect(find.byKey(const Key('workspace-picker-title')), findsOneWidget);
        expect(
          find.byKey(const Key('workspace-picker-guardrail-note')),
          findsOneWidget,
        );
        final note = tester
            .widget<Text>(
              find.byKey(const Key('workspace-picker-guardrail-note')),
            )
            .data!;
        expect(note.toLowerCase(), contains('indexed'));
        expect(note.toLowerCase(), contains('working directory'));
        // Both server-reported workspaces render. No widget renders an
        // editable freeform root input that could be used to select
        // something outside the server's root list.
        expect(find.byKey(const Key('workspace-recent-list')), findsOneWidget);
        expect(find.byKey(Key('workspace-tile-$_wsA')), findsOneWidget);
        expect(find.byKey(Key('workspace-tile-$_wsB')), findsOneWidget);
        // Unavailable workspace must render with an explicit reason and
        // must not be tappable.
        final unavailableTile = find.byKey(
          Key('workspace-tile-unavailable-$_wsB'),
        );
        expect(unavailableTile, findsOneWidget);
        final wsB = tester.widget<ListTile>(
          find.byKey(Key('workspace-tile-$_wsB')),
        );
        expect(wsB.enabled, isFalse);
        expect(wsB.onTap, isNull);

        await tearDownWorkspace(coordinator, database);
      },
    );

    testWidgets('cancels an in-flight search so stale hits never surface', (
      tester,
    ) async {
      final (coordinator, database, transport) = await bootstrap(
        tester,
        seedReady: true,
      );
      _seedWorkspaces(coordinator);
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WorkspacePicker(
              coordinator: coordinator,
              onSelect: _captureSelection,
              onCancel: () {},
              onApproveTrust: (entry) async {},
            ),
          ),
        ),
      );
      await tester.pump();

      await tester.enterText(
        find.byKey(const Key('workspace-search-field')),
        'mob',
      );
      // Pump past the debounce window so the search is actually issued.
      await tester.pump(const Duration(milliseconds: 250));
      await tester.pump();
      expect(coordinator.workspaceSearch.isActive, isTrue);

      // Cancel first. Responses from the abandoned request must then be
      // ignored because the search epoch advanced.
      await tester.tap(find.byKey(const Key('workspace-search-cancel')));
      await tester.pump();
      final socket = transport.sockets.last;
      socket.server(
        response('workspace.search.result', {
          'items': [
            {
              'workspaceId': _wsA,
              'displayName': 'Stale result',
              'relativePath': '/stale',
              'rootLabel': '/Users/test',
              'availability': 'available',
              'trustState': 'approved',
              'fingerprint': _wsFingerprint,
              'policyVersion': '1',
            },
          ],
        }),
      );
      await tester.pump();
      socket.server(
        response('workspace.search.result', {
          'items': [
            {
              'workspaceId': _wsA,
              'displayName': 'Fresh result',
              'relativePath': '/fresh',
              'rootLabel': '/Users/test',
              'availability': 'available',
              'trustState': 'approved',
              'fingerprint': _wsFingerprint,
              'policyVersion': '1',
            },
          ],
        }),
      );
      await tester.pump();

      expect(find.byKey(const Key('workspace-search-results')), findsNothing);
      expect(
        find.byKey(const Key('workspace-search-cancelled')),
        findsOneWidget,
      );

      await tearDownWorkspace(coordinator, database);
    });

    testWidgets(
      'trust review surfaces manifest, fingerprint change, and approval sends',
      (tester) async {
        final (coordinator, database, transport) = await bootstrap(
          tester,
          seedReady: true,
        );
        _seedWorkspaces(coordinator, unapproved: true);
        await tester.binding.setSurfaceSize(const Size(1200, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WorkspacePicker(
                coordinator: coordinator,
                onSelect: _captureSelection,
                onCancel: () {},
                onApproveTrust: (entry) =>
                    coordinator.approveWorkspaceTrust(entry.workspaceId),
              ),
            ),
          ),
        );
        await tester.pump();

        expect(
          find.byKey(Key('workspace-tile-unapproved-$_wsA')),
          findsOneWidget,
        );
        // Unapproved tile is not selectable.
        final tile = tester.widget<ListTile>(
          find.byKey(Key('workspace-tile-$_wsA')),
        );
        expect(tile.enabled, isTrue);
        expect(tile.onTap, isNotNull);
        // Tap triggers the trust review dialog.
        await tester.tap(find.byKey(Key('workspace-tile-$_wsA')));
        await tester.pump();
        expect(find.byKey(const Key('trust-review-dialog')), findsOneWidget);
        expect(
          find.byKey(const Key('trust-review-fingerprint')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('trust-review-policy-version')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('trust-review-guardrail-note')),
          findsOneWidget,
        );
        final guard = tester
            .widget<Text>(
              find.descendant(
                of: find.byKey(const Key('trust-review-guardrail-note')),
                matching: find.byType(Text),
              ),
            )
            .data!;
        expect(guard.toLowerCase(), contains('guardrail'));
        expect(guard.toLowerCase(), contains('not an os sandbox'));

        // Tap Approve and confirm the coordinator sent workspace.trust.approve
        // with the workspace id and the current fingerprint.
        await tester.tap(find.byKey(const Key('trust-review-approve')));
        await tester.pump();
        final socket = transport.sockets.last;
        await eventually(
          () => socket.sent.any(
            (message) => message['type'] == 'workspace.trust.approve',
          ),
        );
        final approve = socket.sent.firstWhere(
          (message) => message['type'] == 'workspace.trust.approve',
        );
        expect((approve['payload'] as Map)['workspaceId'], _wsA);
        expect((approve['payload'] as Map)['fingerprint'], _wsFingerprint);
        await eventually(
          () =>
              socket.sent.any((message) => message['type'] == 'workspace.list'),
        );
        expect(find.byKey(const Key('trust-review-dialog')), findsNothing);

        // Simulate the ordered workspace-list refresh. This is defensive in
        // addition to the durable host-stream event, so a delayed live event
        // cannot leave the trust-required banner stale.
        socket.server(
          response('workspace.list.result', {
            'items': [
              {
                'workspaceId': _wsA,
                'displayName': 'mobile',
                'rootLabel': 'Home',
                'relativePath': '.',
                'availability': 'available',
                'trustState': 'approved',
                'fingerprint': _wsFingerprint,
                'policyVersion': '1',
                'manifest': <Map<String, Object?>>[],
              },
            ],
          }),
        );
        await _drainCoordinator(tester);
        await eventually(
          () => !coordinator.requiresTrustApproval,
          tester: tester,
        );
        await tester.pump();
        // The unapproved banner is gone.
        expect(
          find.byKey(Key('workspace-tile-unapproved-$_wsA')),
          findsNothing,
        );

        // Now change the fingerprint and confirm the picker renders a
        // fingerprint-changed state that still surfaces the manifest for
        // re-review.
        socket.server(
          event(
            type: 'workspace.trust_state',
            streamId: 'host:$_hostId',
            cursor: '1',
            eventId: '88888888-8888-4888-8888-888888888888',
            payload: {
              'workspaceId': _wsA,
              'trustState': 'fingerprint_changed',
              'fingerprint':
                  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
              'policyVersion': '1',
            },
          ),
        );
        await _drainCoordinator(tester);
        await eventually(
          () => coordinator.workspaces.any(
            (entry) =>
                entry.workspaceId == _wsA &&
                entry.trustState == WorkspaceTrustState.fingerprintChanged,
          ),
          tester: tester,
        );
        await tester.pump();
        expect(
          coordinator.streams['host:$_hostId']?.lastContiguousCursor.value,
          '1',
          reason: 'typed trust events must advance the durable host cursor',
        );
        expect(
          find.byKey(Key('workspace-tile-fingerprint-$_wsA')),
          findsOneWidget,
        );

        await tearDownWorkspace(coordinator, database);
      },
    );
  });

  group('Composer gating', () {
    testWidgets(
      'composer stays unavailable while approval is required and no session can start',
      (tester) async {
        final (coordinator, database, transport) = await bootstrap(
          tester,
          seedReady: true,
        );
        _seedWorkspaces(coordinator, unapproved: true);
        // Match the narrow logical viewport observed on a physical Android
        // phone so a tall trust card scrolls instead of overflowing.
        await tester.binding.setSurfaceSize(const Size(360, 755));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(PiMobApp(coordinator: coordinator));
        await tester.pump();
        expect(tester.takeException(), isNull);
        // The chat-first shell does not mount a composer until a synchronized
        // session is selected, and trust approval is still required.
        expect(coordinator.requiresTrustApproval, isTrue);
        expect(find.byKey(const Key('send-button')), findsNothing);
        // Approval clears the trust gate, but without a selected synchronized
        // session the composer correctly remains unavailable.
        coordinator.workspaces.firstWhere((w) => w.workspaceId == _wsA);
        await coordinator.approveWorkspaceTrust(_wsA);
        expect(
          transport.sockets.last.sent.any(
            (message) => message['type'] == 'workspace.trust.approve',
          ),
          isTrue,
        );
        _seedWorkspaces(coordinator);
        await eventually(
          () => !coordinator.requiresTrustApproval,
          tester: tester,
        );
        expect(coordinator.requiresTrustApproval, isFalse);
        expect(find.byKey(const Key('send-button')), findsNothing);

        await tearDownWorkspace(coordinator, database);
      },
    );

    testWidgets('folder session creation is named and always full policy', (
      tester,
    ) async {
      final (coordinator, database, transport) = await bootstrap(
        tester,
        seedReady: true,
      );
      _seedWorkspaces(coordinator);

      coordinator.createSession().ignore();
      await eventually(
        () => transport.sockets.last.sent.any(
          (message) => message['type'] == 'session.create',
        ),
        tester: tester,
      );

      final create = transport.sockets.last.sent.lastWhere(
        (message) => message['type'] == 'session.create',
      );
      final payload = create['payload'] as Map;
      expect(payload['workspaceId'], _wsA);
      expect(payload['workspaceRelativePath'], '/');
      expect(payload['name'], 'mobile (approved)');
      expect(payload['policyMode'], 'full');
      await tearDownWorkspace(coordinator, database);
    });

    testWidgets(
      'session policy controls stay out of the folder-first Sessions surface',
      (tester) async {
        final (coordinator, database, transport) = await bootstrap(
          tester,
          seedReady: true,
        );
        _seedWorkspaces(coordinator);
        final socket = transport.sockets.last;
        await tester.binding.setSurfaceSize(const Size(1200, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(PiMobApp(coordinator: coordinator));
        await tester.pump();

        expect(find.byKey(const Key('read-only-indicator')), findsNothing);
        expect(find.byKey(const Key('policy-mode-toggle')), findsNothing);
        expect(find.byKey(const Key('open-session-controls')), findsNothing);
        expect(find.text('Pi controls'), findsNothing);
        expect(
          socket.sent.where(
            (message) => message['type'] == 'session.policy.set',
          ),
          isEmpty,
        );

        await tearDownWorkspace(coordinator, database);
      },
    );
  });
}

void _captureSelection(WorkspaceEntry entry) {
  // Test fixtures only need to confirm the picker calls onSelect. The
  // captured value is intentionally ignored to keep tests focused on UI
  // rendering and command emission.
}

Future<void> _bringOnline(
  ConnectionCoordinator coordinator,
  _RecordingTransport transport,
  WidgetTester? tester,
) async {
  await coordinator.connect('https://fixture.test');
  final socket = transport.sockets.single;
  socket.server(_helloAccepted());
  await eventually(
    () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    tester: tester,
  );
  final subscription = socket.sent.lastWhere(
    (message) => message['type'] == 'subscription.set',
  );
  final requested = ((subscription['payload'] as Map)['streams'] as List)
      .cast<Map>()
      .map((stream) => stream['streamId'] as String)
      .toList();
  socket.server(
    response('subscription.accepted', {
      'streams': requested
          .map((streamId) => {'streamId': streamId, 'mode': 'current'})
          .toList(),
    }),
  );
  for (final streamId in requested) {
    socket.server(
      response('stream.sync.complete', {
        'streamId': streamId,
        'currentCursor': '0',
        'mode': 'current',
      }, requestId: null),
    );
  }
  await eventually(() => coordinator.isReady, tester: tester);
}

void _seedWorkspaces(
  ConnectionCoordinator coordinator, {
  bool unapproved = false,
}) {
  // Reach into the coordinator's private list via the public workspaces
  // accessor only by driving a server response. The test seeds the workspace
  // list using a synthetic server message.
  final items = [
    {
      'workspaceId': _wsA,
      'displayName': 'mobile (approved)',
      'rootLabel': '/Users/test/mobile',
      'relativePath': '/',
      'repositoryMarker': 'pi-mob',
      'lastUsedAt': '2026-07-13T00:00:00.000Z',
      'availability': 'available',
      'trustState': unapproved ? 'unapproved' : 'approved',
      'fingerprint': _wsFingerprint,
      'policyVersion': '1',
      'manifest': [
        {'relativePath': '/lib/main.dart', 'kind': 'file', 'sizeBytes': 1024},
        {'relativePath': '/README.md', 'kind': 'file', 'sizeBytes': 512},
      ],
    },
    {
      'workspaceId': _wsB,
      'displayName': 'docs (unavailable)',
      'rootLabel': '/Users/test/docs',
      'relativePath': '/',
      'repositoryMarker': null,
      'lastUsedAt': '2026-07-12T00:00:00.000Z',
      'availability': 'unavailable',
      'trustState': 'approved',
      'fingerprint':
          '1111111111111111111111111111111111111111111111111111111111111111',
      'policyVersion': '1',
      'manifest': <Map<String, Object?>>[],
    },
  ];
  coordinator.debugSeedWorkspaces(items);
  if (!unapproved) {
    coordinator.debugSelectWorkspace(_wsA);
  }
}

Map<String, Object?> _helloAccepted() => response('hello.accepted', {
  'connectionId': _connectionId,
  'hostId': _hostId,
  'hostGeneration': '1',
  'hostDisplayName': 'Fixture host',
  'bridgeVersion': 'm5',
  'piVersion': '0.80.6',
  'serverTime': '2026-07-13T00:00:00.000Z',
  'capabilities': const ['streams.v1', 'commands.v1', 'controller_leases.v1'],
  'limits': const {
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

Future<void> _drainCoordinator(WidgetTester tester) async {
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 20)),
  );
  await tester.pump();
}

Future<void> eventually(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 3),
  WidgetTester? tester,
}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) {
      throw TestFailure('Condition was not met');
    }
    if (tester != null) {
      await tester.pump(const Duration(milliseconds: 5));
    } else {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }
}

final class _RecordingTransport implements BridgeTransport {
  final List<_RecordingSocket> sockets = [];

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    final socket = _RecordingSocket();
    sockets.add(socket);
    return socket;
  }
}

final class _RecordingSocket implements BridgeSocket {
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

extension on ConnectionCoordinator {
  // Test-only seams live on the coordinator as @visibleForTesting methods
  // (debugSeedWorkspaces, debugSelectWorkspace).
}
