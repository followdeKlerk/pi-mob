import 'dart:io';
import 'dart:ui' as ui;

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/pairing/pairing_screen.dart';
import 'package:pi_mob/src/transcript/domain/transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_items.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/reasoning_block.dart';
import 'package:pi_mob/src/transcript/widgets/tool_card.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_status.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_view.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/final_answer_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/reasoning_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/tool_call_view_data.dart';
import 'package:pi_mob/src/ui/shell/activity_destination.dart';
import 'package:pi_mob/src/ui/shell/app_shell.dart';
import 'package:pi_mob/src/ui/shell/composer.dart';
import 'package:pi_mob/src/ui/theme/pi_theme.dart';

const _sessionId = '22222222-2222-4222-8222-222222222222';
const _tool = ToolCallViewData(
  toolCallId: 'preview-read',
  toolName: 'read',
  arguments: {'path': 'notes.txt'},
  result: {'content': 'A little space for a big idea.', 'byteCount': 30},
  status: TranscriptToolStatus.completed,
);
const _reasoning = ReasoningViewData(
  reasoningId: 'preview-thinking',
  phase: ReasoningPhase.completed,
  summary: 'I’ll check the notes and put together a short plan.',
);

TranscriptDocument _document() => TranscriptDocument(
  streamId: 'preview',
  diagnostics: const [],
  lastSettledTurnId: null,
  turns: [
    const UserTurn(
      turnId: 'question',
      commandId: 'preview-command',
      deliveryMode: 'immediate',
      status: UserTurnStatus.settled,
      message: 'Help me turn these notes into something great.',
    ),
    AssistantTurn(
      turnId: 'answer',
      assistantStepId: 'step',
      status: AssistantTurnStatus.completed,
      items: [
        ReasoningItem(
          itemId: 'thinking',
          assistantStepId: 'step',
          viewData: _reasoning,
        ),
        ToolItem(itemId: 'read', assistantStepId: 'step', viewData: _tool),
        FinalAnswerItem(
          itemId: 'answer',
          assistantStepId: 'step',
          viewData: const FinalAnswerViewData(
            answerId: 'answer',
            markdown:
                '## A small start. A clear direction.\n\nYour notes have a strong idea at their heart. Let’s give it room to grow.\n\n- Pick one thing you want to improve.\n- Make the first step small enough to try today.\n- Keep what works and build from there.',
          ),
        ),
      ],
    ),
  ],
);

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  bool dark = false,
  bool reduced = false,
  double scale = 1,
  Size size = const Size(390, 844),
  double keyboard = 0,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: dark ? piDarkTheme() : piLightTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          disableAnimations: reduced,
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: RepaintBoundary(
          key: const Key('redesign-preview'),
          child: child!,
        ),
      ),
      home: home,
    ),
  );
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

// Optional artifact capture: REDESIGN_SCREENSHOTS=/absolute/directory flutter test ...
// Uses SDK fonts rather than shipping a new font dependency or golden baselines.
Future<void> _capture(WidgetTester tester, String name) async {
  final directory = Platform.environment['REDESIGN_SCREENSHOTS'];
  if (directory == null) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const Key('redesign-preview')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(directory).create(recursive: true);
    await File(
      '$directory/$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<ConnectionCoordinator> _coordinator(WidgetTester tester) async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  const host = '11111111-1111-4111-8111-111111111111';
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: host,
      endpoint: 'https://fixture.test',
      displayName: 'Preview host',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  for (var i = 0; i < 3; i++) {
    await database.upsertSessionState(
      SessionState(
        sessionId: i == 0 ? _sessionId : 'preview-$i',
        hostId: host,
        name: [
          'A little room to grow',
          'Weekend experiments',
          'A fresh perspective',
        ][i],
        runtimeState: 'idle',
        queueCount: 0,
        lastActivityAt: DateTime(2026, 1, 12),
      ),
    );
  }
  final coordinator = ConnectionCoordinator(
    transport: const _OfflineTransport(),
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  coordinator.selectedSessionId = _sessionId;
  coordinator.phase = ConnectionPhase.disconnected;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    coordinator.dispose();
    await database.close();
  });
  return coordinator;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final sdk = Platform.environment['FLUTTER_ROOT'];
    if (Platform.environment['REDESIGN_SCREENSHOTS'] == null || sdk == null) {
      return;
    }
    final loader = FontLoader('Roboto');
    for (final weight in ['Regular', 'Bold']) {
      loader.addFont(
        File(
          '$sdk/bin/cache/artifacts/material_fonts/Roboto-$weight.ttf',
        ).readAsBytes().then(ByteData.sublistView),
      );
    }
    await loader.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(
        File(
          '$sdk/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        ).readAsBytes().then(ByteData.sublistView),
      );
    await icons.load();
  });

  for (final dark in [false, true]) {
    testWidgets('pairing and chat render in ${dark ? 'dark' : 'light'} theme', (
      tester,
    ) async {
      await _pump(
        tester,
        PairingScreen(onPair: (_) async {}, onForgetHost: () async {}),
        dark: dark,
      );
      await _capture(tester, 'pairing-${dark ? 'dark' : 'light'}');
      final coordinator = (await tester.runAsync(() => _coordinator(tester)))!;
      final draft = TextEditingController();
      addTearDown(draft.dispose);
      await _pump(
        tester,
        Scaffold(
          appBar: AppBar(
            title: const Text('A little room to grow'),
            leading: const Icon(Icons.space_dashboard_outlined),
          ),
          body: Column(
            children: [
              Expanded(child: TranscriptView(document: _document())),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Composer(
                  coordinator: coordinator,
                  draftController: draft,
                  onOpenDialog: () {},
                ),
              ),
            ],
          ),
        ),
        dark: dark,
      );
      expect(find.text('read'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      await _capture(tester, 'chat-${dark ? 'dark' : 'light'}');
    });
  }

  testWidgets('pairing reflows at 320dp / 200% and remains submittable', (
    tester,
  ) async {
    var paired = false;
    await _pump(
      tester,
      PairingScreen(
        onPair: (_) async => paired = true,
        onForgetHost: () async {},
      ),
      size: const Size(320, 700),
      scale: 2,
      reduced: true,
    );
    for (final entry in {
      'manual-endpoint-field': 'https://host.tailnet.ts.net:8788',
      'pairing-passcode-field': '123456',
    }.entries) {
      await tester.scrollUntilVisible(
        find.byKey(Key(entry.key)),
        180,
        scrollable: find
            .descendant(
              of: find.byKey(const Key('pairing-form')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.enterText(find.byKey(Key(entry.key)), entry.value);
    }
    await tester.scrollUntilVisible(
      find.byKey(const Key('pairing-submit')),
      180,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('pairing-form')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    expect(
      tester.getSize(find.byKey(const Key('pairing-submit'))).height,
      greaterThanOrEqualTo(48),
    );
    await tester.tap(find.byKey(const Key('pairing-submit')));
    await tester.pumpAndSettle();
    expect(paired, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'tool and reasoning disclosures are 48dp, reflow and respect reduced motion',
    (tester) async {
      for (final reduced in [false, true]) {
        await _pump(tester, Scaffold(body: ToolCard.forViewData(_tool)));
        final compactHeader = find
            .descendant(
              of: find.byType(ToolCard),
              matching: find.byType(InkWell),
            )
            .first;
        expect(tester.getSize(compactHeader).height, greaterThanOrEqualTo(48));
        await _pump(
          tester,
          Scaffold(
            body: ListView(
              children: [
                ToolCard.forViewData(_tool, key: ValueKey('tool-$reduced')),
                ReasoningBlock.forViewData(
                  _reasoning,
                  key: ValueKey('reasoning-$reduced'),
                ),
              ],
            ),
          ),
          size: const Size(320, 700),
          scale: 2,
          reduced: reduced,
        );
        final header = find
            .descendant(
              of: find.byType(ToolCard),
              matching: find.byType(InkWell),
            )
            .first;
        expect(tester.getSize(header).height, greaterThanOrEqualTo(48));
        expect(
          tester.getSize(find.byKey(const Key('reasoning-header'))).height,
          greaterThanOrEqualTo(48),
        );
        await tester.tap(header);
        await tester.pump();
        expect(find.text('Arguments'), findsOneWidget);
        final rotation = tester.widget<AnimatedRotation>(
          find.descendant(
            of: find.byType(ToolCard),
            matching: find.byType(AnimatedRotation),
          ),
        );
        expect(rotation.duration, reduced ? Duration.zero : PiDuration.short);
        expect(rotation.turns, .5);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(const Key('reasoning-header')));
        await tester.tap(find.byKey(const Key('reasoning-header')));
        await tester.pumpAndSettle();
        expect(find.text(_reasoning.summary), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    },
  );

  testWidgets(
    'shell drawer, empty state and keyboard composer stay usable at 320dp / 200%',
    (tester) async {
      final coordinator = (await tester.runAsync(() => _coordinator(tester)))!;
      final draft = TextEditingController();
      final endpoint = TextEditingController();
      addTearDown(draft.dispose);
      addTearDown(endpoint.dispose);
      final shell = AppShell(
        coordinator: coordinator,
        endpointController: endpoint,
        draftController: draft,
        notifications: null,
        onForgetHost: () async {},
        onOpenDialog: () {},
      );
      await _pump(
        tester,
        shell,
        size: const Size(320, 700),
        scale: 2,
        reduced: true,
      );
      await tester.tap(find.byKey(const Key('open-chat-drawer')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.byKey(const Key('saved-chat-$_sessionId')),
        120,
        scrollable: find
            .descendant(
              of: find.byKey(const Key('saved-chat-list')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.byKey(const Key('saved-chat-$_sessionId')), findsOneWidget);
      await _capture(tester, 'drawer-large-text');
      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(tester, shell, reduced: true);
      await tester.tap(find.byKey(const Key('open-chat-drawer')));
      await tester.pumpAndSettle();
      await _capture(tester, 'drawer-light');
      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(
        tester,
        Scaffold(
          body: ActivityDestination(
            coordinator: coordinator,
            draftController: draft,
            onOpenDialog: () {},
            onGoToSessions: () {},
          ),
        ),
        size: const Size(320, 700),
        scale: 2,
        reduced: true,
        keyboard: 300,
      );
      await tester.enterText(
        find.byKey(const Key('draft-field')),
        'Keep this idea',
      );
      await tester.pumpAndSettle();
      expect(coordinator.draft, 'Keep this idea');
      await coordinator.submitPromptWithRecovery();
      await tester.pumpAndSettle();
      expect(find.text('Message not sent'), findsOneWidget);
      expect(coordinator.draft, 'Keep this idea');
      await tester.ensureVisible(find.byKey(const Key('send-button')));
      await tester.pumpAndSettle();
      expect(
        tester.getSize(find.byKey(const Key('send-button'))).shortestSide,
        greaterThanOrEqualTo(48),
      );
      expect(tester.takeException(), isNull);
      coordinator.selectedSessionId = null;
      await _pump(
        tester,
        Scaffold(
          body: ActivityDestination(
            coordinator: coordinator,
            draftController: draft,
            onOpenDialog: () {},
            onGoToSessions: () {},
          ),
        ),
        reduced: true,
      );
      expect(find.text('No active session'), findsOneWidget);
      await _capture(tester, 'empty-light');
    },
  );
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();
  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw StateError('offline fixture');
  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}
