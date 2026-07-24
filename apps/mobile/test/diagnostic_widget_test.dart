import 'package:drift/drift.dart' show Value;
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

  testWidgets(
    'diagnostic UI retains offline draft and exposes explicit controls',
    (tester) async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      const hostId = '11111111-1111-4111-8111-111111111111';
      const sessionId = '22222222-2222-4222-8222-222222222222';
      await database.upsertHost(
        HostEntriesCompanion.insert(
          hostId: hostId,
          endpoint: 'https://fixture.test',
          displayName: 'Fixture host',
          generation: '1',
          connectionState: 'offline',
          bridgeVersion: const Value('m5'),
    piVersion: const Value('0.82.0'),
          protocolVersion: const Value('1.0'),
          capabilitiesJson: '[]',
        ),
      );
      await database.upsertSessionState(
        const SessionState(
          sessionId: sessionId,
          hostId: hostId,
          name: 'Saved session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      await database.saveDraft(
        hostId: hostId,
        sessionId: sessionId,
        text: 'Saved offline',
        pendingCommandId: null,
        pendingPayloadJson: null,
        pendingState: null,
        updatedAt: DateTime.utc(2026, 7, 13),
      );
      final coordinator = ConnectionCoordinator(
        transport: _OfflineTransport(),
        database: database,
      );
      await coordinator.initialize(autoConnect: false);

      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(PiMobApp(coordinator: coordinator));
      // Pump twice so the post-frame destination resolver runs and the
      // shell settles on Activity (saved session exists).
      await tester.pump();
      await tester.pump();

      // The product lands directly in the single Chat surface.
      expect(find.byKey(const Key('open-chat-drawer')), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byKey(const Key('composer-card')), findsOneWidget);

      // The draft was preserved end-to-end through the coordinator.
      final draft = tester.widget<TextField>(
        find.byKey(const Key('draft-field')),
      );
      expect(draft.controller!.text, 'Saved offline');
      final send = tester.widget<FilledButton>(
        find.byKey(const Key('send-button')),
      );
      expect(
        send.onPressed,
        isNull,
        reason: 'offline send must remain disabled',
      );
      expect(find.byIcon(Icons.send), findsOneWidget);
      expect(find.byKey(const Key('abort-button')), findsNothing);
      expect(find.byKey(const Key('composer-disabled-reason')), findsNothing);

      await tester.enterText(
        find.byKey(const Key('draft-field')),
        'Changed offline',
      );
      await tester.pump();
      final persisted = await database.draft(hostId, sessionId);
      expect(persisted!.draftText, 'Changed offline');

      // Host diagnostics remain implemented but are absent from primary UI.
      expect(find.byKey(const Key('endpoint-field')), findsNothing);
      expect(find.textContaining('Bridge: m5'), findsNothing);
      expect(find.byKey(const Key('raw-event-list')), findsNothing);

      await tester.tap(find.byKey(const Key('open-chat-drawer')));
      await tester.pumpAndSettle();
      expect(find.text('Saved session'), findsWidgets);
      expect(find.byKey(const Key('drawer-forget-host')), findsOneWidget);

      coordinator.dispose();
      await database.close();
    },
  );

  testWidgets('M6 crash, indeterminate, and truncation states are explicit', (
    tester,
  ) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    const hostId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';
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
        name: 'Broken session',
        runtimeState: 'crash_loop',
        queueCount: 0,
      ),
    );
    await database.saveDraft(
      hostId: hostId,
      sessionId: sessionId,
      text: 'Uncertain prompt',
      pendingCommandId: '33333333-3333-4333-8333-333333333333',
      pendingPayloadJson:
          '{"sessionId":"$sessionId","message":"Uncertain prompt"}',
      pendingState: 'indeterminate',
      updatedAt: DateTime.utc(2026, 7, 13),
    );
    await database.insertEvent(
      eventId: '44444444-4444-4444-8444-444444444444',
      hostId: hostId,
      streamId: 'session:$sessionId',
      cursor: '1',
      type: 'turn.started',
      payloadJson:
          '{"sessionId":"$sessionId","turnId":"turn-1","message":"Inspect output"}',
      occurredAt: DateTime.utc(2026, 7, 13),
    );
    await database.insertEvent(
      eventId: '66666666-6666-4666-8666-666666666666',
      hostId: hostId,
      streamId: 'session:$sessionId',
      cursor: '2',
      type: 'tool.started',
      payloadJson:
          '{"sessionId":"$sessionId","turnId":"turn-1","toolCallId":"55555555-5555-4555-8555-555555555555","toolName":"read","arguments":{"path":"large.log"}}',
      occurredAt: DateTime.utc(2026, 7, 13),
    );
    await database.insertEvent(
      eventId: '77777777-7777-4777-8777-777777777777',
      hostId: hostId,
      streamId: 'session:$sessionId',
      cursor: '3',
      type: 'tool.output',
      payloadJson:
          '{"sessionId":"$sessionId","turnId":"turn-1","toolCallId":"55555555-5555-4555-8555-555555555555","output":"retained output","retainedBytes":5242880,"totalBytes":6291456,"isTruncated":true,"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
      occurredAt: DateTime.utc(2026, 7, 13),
    );
    await database.insertEvent(
      eventId: '88888888-8888-4888-8888-888888888888',
      hostId: hostId,
      streamId: 'session:$sessionId',
      cursor: '4',
      type: 'tool.completed',
      payloadJson:
          '{"sessionId":"$sessionId","turnId":"turn-1","toolCallId":"55555555-5555-4555-8555-555555555555","toolName":"read","result":{"content":"retained output","byteCount":5242880},"retainedBytes":5242880,"totalBytes":6291456,"isTruncated":true,"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
      occurredAt: DateTime.utc(2026, 7, 13),
    );
    final coordinator = ConnectionCoordinator(
      transport: _OfflineTransport(),
      database: database,
    );
    await coordinator.initialize(autoConnect: false);
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(PiMobApp(coordinator: coordinator));
    await tester.pump();

    // The saved-chat drawer keeps the chat available without repeating its
    // runtime state; crash detail remains in the contextual chat surface.
    await tester.tap(find.byKey(const Key('open-chat-drawer')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('saved-chat-22222222-2222-4222-8222-222222222222')),
      findsOneWidget,
    );
    expect(find.textContaining('Repeated crashes'), findsNothing);
    await tester.tap(find.byKey(const Key('close-chat-drawer')));
    await tester.pumpAndSettle();

    // Chat hosts the indeterminate warning and one collapsed truncation badge
    // inside the originating tool card, never a standalone timeline notice.
    expect(find.byKey(const Key('indeterminate-warning')), findsOneWidget);
    expect(
      find.textContaining('will not run again automatically'),
      findsOneWidget,
    );
    expect(find.text('Tool output truncated'), findsNothing);
    expect(find.text('Output truncated'), findsOneWidget);
    expect(
      find.byKey(const Key('tool-output-55555555-5555-4555-8555-555555555555')),
      findsNothing,
    );
    expect(find.byKey(const Key('tool-truncation-details')), findsNothing);
    expect(find.textContaining('SHA-256 cccc'), findsNothing);

    await tester.tap(find.text('read'));
    await tester.pump();
    expect(find.byKey(const Key('tool-truncation-details')), findsOneWidget);
    expect(find.textContaining('5.0 MB'), findsOneWidget);
    expect(find.textContaining('6.0 MB'), findsOneWidget);
    expect(find.textContaining('SHA-256 cccc'), findsOneWidget);
    expect(find.text('retained output'), findsOneWidget);

    coordinator.dispose();
    await database.close();
  });
}

final class _OfflineTransport implements BridgeTransport {
  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw const SocketExceptionForTest();

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}

final class SocketExceptionForTest implements Exception {
  const SocketExceptionForTest();
}
