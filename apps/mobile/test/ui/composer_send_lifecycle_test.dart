import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/domain/prompt_send_lifecycle.dart';
import 'package:pi_mob/src/ui/shell/composer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('failed send stays visible near composer and preserves draft', (
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
        name: 'Fixture session',
        runtimeState: 'idle',
        queueCount: 0,
      ),
    );
    await database.saveDraft(
      hostId: hostId,
      sessionId: sessionId,
      text: 'Keep this message',
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      updatedAt: DateTime.utc(2026, 7, 20),
    );
    final coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
    await coordinator.initialize(autoConnect: false);

    coordinator.selectedSessionId = sessionId;
    final result = await coordinator.submitPromptWithRecovery();
    expect(result.phase, PromptSendPhase.failed);
    expect(coordinator.draft, 'Keep this message');

    final draftController = TextEditingController(text: coordinator.draft);
    addTearDown(() async {
      draftController.dispose();
      coordinator.dispose();
      await database.close();
    });
    await tester.binding.setSurfaceSize(const Size(800, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Composer(
              coordinator: coordinator,
              draftController: draftController,
              onOpenDialog: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('prompt-send-failed')), findsOneWidget);
    expect(find.text('Message not sent'), findsOneWidget);
    expect(find.text('Bridge is not ready.'), findsOneWidget);
    expect(find.text('Reconnect'), findsOneWidget);
    expect(find.text('Keep this message'), findsOneWidget);
    expect(find.textContaining('11111111'), findsNothing);

    await tester.enterText(find.byKey(const Key('draft-field')), '/model');
    await tester.pump(const Duration(milliseconds: 50));
    expect(coordinator.draft, '/model');
    expect(find.byKey(const Key('slash-command-list')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('slash-command-results')),
        matching: find.text('/model'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('slash-command-results')),
        matching: find.textContaining(
          'Change the model using Pi command syntax',
        ),
      ),
      findsOneWidget,
    );
  });
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw StateError('offline transport');

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}
