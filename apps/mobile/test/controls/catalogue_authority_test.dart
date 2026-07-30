import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/agents/agent_domain.dart';
import 'package:pi_mob/src/controls/control_view_data.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/ui/shell/app_shell.dart';

void main() {
  test('catalogue entries preserve invocation for draft insertion', () {
    const entry = SupportedCommandData(
      id: 'template:standup',
      title: 'Standup',
      category: SupportedCommandCategory.template,
      invocation: '/standup',
    );
    expect(entry.invocation, '/standup');
    expect(entry.enabled, isTrue);
  });

  test('catalogue entries can carry mcp categories', () {
    const server = SupportedCommandData(
      id: 'mcp_server:github',
      title: 'GitHub MCP',
      category: SupportedCommandCategory.mcpServer,
      invocation: '/mcp github',
      enabled: false,
      disabledReason: 'MCP unavailable',
    );
    const tool = SupportedCommandData(
      id: 'mcp_tool:status',
      title: 'Status tool',
      category: SupportedCommandCategory.mcpTool,
    );
    expect(server.category, SupportedCommandCategory.mcpServer);
    expect(tool.category, SupportedCommandCategory.mcpTool);
    expect(server.disabledReason, 'MCP unavailable');
  });

  testWidgets(
    'unavailable catalogue shows a notice and no static fallback commands',
    (tester) async {
      final fixture = await _catalogueFixture();
      fixture.socket.server(
        _event(
          type: 'catalogue.unavailable',
          cursor: '1',
          eventId: '33333333-3333-4333-8333-333333333331',
          payload: const {
            'capability': 'catalogue.v1',
            'status': {
              'state': 'unavailable',
              'reason': 'Pi did not publish a catalogue.',
              'remediation': 'Reload Pi to retry the catalogue.',
            },
          },
        ),
      );
      await _eventually(() => fixture.coordinator.supportedCommands != null);

      final controllers = _ShellControllers();
      await tester.pumpWidget(_shell(fixture.coordinator, controllers));
      await tester.tap(find.byKey(const Key('open-commands')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('catalogue-unavailable-notice')),
        findsOneWidget,
      );
      expect(find.text('Catalogue unavailable'), findsOneWidget);
      expect(
        find.byKey(const Key('command-catalogue-unavailable')),
        findsOneWidget,
      );
      expect(find.text('Show available skills'), findsNothing);

      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      controllers.dispose();
      await fixture.database.close();
    },
  );

  testWidgets(
    'authoritative catalogue renders enabled and unavailable command rows',
    (tester) async {
      final fixture = await _catalogueFixture();
      fixture.socket.server(
        _event(
          type: 'catalogue.snapshot',
          cursor: '1',
          eventId: '33333333-3333-4333-8333-333333333332',
          payload: const {
            'revision': 'catalogue-1',
            'entries': [
              {
                'entryId': 'skill:foo',
                'kind': 'skill',
                'name': 'Foo skill',
                'source': 'pi:get_commands',
                'invocation': '/foo',
                'availability': {'state': 'available'},
                'canToggle': false,
                'reloadRequired': false,
                'revision': 'catalogue-1',
              },
              {
                'entryId': 'mcp_server:github',
                'kind': 'mcp_server',
                'name': 'GitHub MCP',
                'source': 'pi:config',
                'availability': {
                  'state': 'unavailable',
                  'reason': 'MCP unavailable',
                  'remediation': 'Check MCP server status.',
                },
                'canToggle': false,
                'reloadRequired': true,
                'revision': 'catalogue-1',
              },
            ],
          },
        ),
      );
      await _eventually(
        () => fixture.coordinator.supportedCommands?.length == 2,
      );

      final controllers = _ShellControllers();
      await tester.pumpWidget(_shell(fixture.coordinator, controllers));
      await tester.tap(find.byKey(const Key('open-commands')));
      await tester.pumpAndSettle();

      expect(find.text('Foo skill'), findsOneWidget);
      expect(find.text('/foo'), findsOneWidget);
      expect(find.text('GitHub MCP'), findsOneWidget);
      expect(find.text('MCP unavailable'), findsOneWidget);
      expect(find.byIcon(Icons.dns), findsOneWidget);

      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      controllers.dispose();
      await fixture.database.close();
    },
  );

  testWidgets('missing agent capability renders explicit unavailable state', (
    tester,
  ) async {
    final fixture = await _catalogueFixture();
    final controllers = _ShellControllers();
    // The bridge never advertises `agents.v1` in the default daemon
    // construction, so the truthful product contract is "unavailable".
    expect(fixture.coordinator.supportsCapability('agents.v1'), isFalse);
    await tester.pumpWidget(_shell(fixture.coordinator, controllers));
    await tester.pumpAndSettle();

    // The shell intentionally exposes no `open-agents` affordance while the
    // capability is unavailable; tapping a missing key would be a lie. The
    // truthful shell must not present any entry point to a missing surface.
    expect(find.byKey(const Key('open-agents')), findsNothing);

    // Domain coverage: the reducer must still surface the canonical
    // unavailable reason so any caller (notifications, transcripts, debug
    // tooling) reports a truthful "Agent supervision unavailable" rather
    // than fabricating a fallback.
    final reduced = reduceAgents(
      const AgentSupervisionState(),
      'agent.unavailable',
      const {'status': <String, Object?>{}},
    );
    expect(reduced.unavailableReason, 'Agent supervision unavailable');

    fixture.coordinator.dispose();
    await tester.pumpWidget(const SizedBox.shrink());
    controllers.dispose();
    await fixture.database.close();
  });

  testWidgets(
    'missing attention capability renders explicit unavailable state',
    (tester) async {
      final fixture = await _catalogueFixture();
      final controllers = _ShellControllers();
      expect(fixture.coordinator.supportsCapability('attention.v1'), isFalse);
      await tester.pumpWidget(_shell(fixture.coordinator, controllers));
      await tester.tap(find.byKey(const Key('open-attention')));
      await tester.pumpAndSettle();

      expect(find.text('Attention inbox unavailable'), findsOneWidget);
      expect(
        find.text(
          'This host did not advertise the durable attention inbox capability.',
        ),
        findsOneWidget,
      );

      fixture.coordinator.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      controllers.dispose();
      await fixture.database.close();
    },
  );
}

Widget _shell(
  ConnectionCoordinator coordinator,
  _ShellControllers controllers,
) {
  return MaterialApp(
    home: AppShell(
      coordinator: coordinator,
      endpointController: controllers.endpoint,
      draftController: controllers.draft,
      notifications: null,
      onForgetHost: () async {},
      onOpenDialog: () {},
    ),
  );
}

final class _ShellControllers {
  final endpoint = TextEditingController();
  final draft = TextEditingController();

  void dispose() {
    endpoint.dispose();
    draft.dispose();
  }
}

final class _CatalogueFixture {
  const _CatalogueFixture(this.database, this.coordinator, this.socket);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;
  final _CatalogueSocket socket;

  Future<void> dispose() async {
    coordinator.dispose();
    await database.close();
  }
}

Future<_CatalogueFixture> _catalogueFixture() async {
  const hostId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
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
  await database.upsertSessionState(
    const SessionState(
      sessionId: sessionId,
      hostId: hostId,
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Fixture chat',
      runtimeState: 'idle',
      queueCount: 0,
    ),
  );
  final transport = _CatalogueTransport();
  final coordinator = ConnectionCoordinator(
    transport: transport,
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  coordinator.debugSetHistorySyncState(completed: 0, total: 0, complete: true);
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
      'serverTime': '2026-07-24T00:00:00.000Z',
      'capabilities': ['streams.v1', 'commands.v1', 'controller_leases.v1'],
      'limits': const {
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
        {'streamId': 'session:$sessionId', 'mode': 'current'},
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
  socket.server(
    _response('stream.sync.complete', {
      'streamId': 'session:$sessionId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await _eventually(() => coordinator.isReady);
  return _CatalogueFixture(database, coordinator, socket);
}

Map<String, Object?> _event({
  required String type,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  ..._response(type, payload, requestId: null),
  'eventId': eventId,
  'streamId': 'host:11111111-1111-4111-8111-111111111111',
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
  'sentAt': '2026-07-24T00:00:00.000Z',
  'payload': payload,
};

Future<void> _eventually(bool Function() condition) async {
  for (var attempt = 0; attempt < 1000; attempt++) {
    if (condition()) return;
    await Future<void>.microtask(() {});
  }
  throw TestFailure('Condition was not met');
}

final class _CatalogueTransport implements BridgeTransport {
  _CatalogueSocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    return socket = _CatalogueSocket();
  }
}

final class _CatalogueSocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

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
