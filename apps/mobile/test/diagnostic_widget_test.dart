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
          piVersion: const Value('0.80.6'),
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
      expect(find.text('Send (offline)'), findsOneWidget);
      expect(
        tester
            .widget<OutlinedButton>(find.byKey(const Key('abort-button')))
            .onPressed,
        isNull,
      );

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
      expect(find.text('Saved session'), findsOneWidget);
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
      type: 'tool.output',
      payloadJson:
          '{"sessionId":"$sessionId","toolCallId":"55555555-5555-4555-8555-555555555555","retainedBytes":5242880,"totalBytes":6291456,"isTruncated":true,"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
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

    // The saved-chat drawer shows the broken session runtime state.
    await tester.tap(find.byKey(const Key('open-chat-drawer')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Repeated crashes'), findsOneWidget);
    await tester.tap(find.byKey(const Key('close-chat-drawer')));
    await tester.pumpAndSettle();

    // Chat hosts the indeterminate warning, transcript truncation chip, and
    // persistent composer.
    expect(find.byKey(const Key('indeterminate-warning')), findsOneWidget);
    expect(
      find.textContaining('will not run again automatically'),
      findsOneWidget,
    );
    expect(find.text('Tool output truncated'), findsOneWidget);
    expect(
      find.textContaining('5242880 of 6291456 bytes retained'),
      findsOneWidget,
    );
    expect(find.textContaining('SHA-256 cccc'), findsOneWidget);

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
