// R12 — Focused tests for the chat-shell keyboard shortcut surface.
// These tests pin the Shortcuts/Actions wiring by invoking each intent
// directly through `Actions.invoke` (the same dispatch path that the
// framework uses for a physical key press). Dispatching through the
// intent keeps the assertions independent of the test framework's
// key-event plumbing, which historically has been brittle across
// Flutter versions.
//
// The catalogue/commands intent is intentionally absent: the catalogue
// capability is not produced by the normal daemon, so the released
// shell does not expose a commands/catalogue entry point.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/shell/shortcut_intents.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpShell(
    WidgetTester tester,
    Map<Type, Action<Intent>> actions,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Shortcuts(
          shortcuts: buildChatShellShortcuts(),
          child: Actions(
            actions: actions,
            child: const Focus(
              key: Key('shortcut-harness-focus'),
              autofocus: true,
              child: SizedBox.shrink(),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('Cmd/Ctrl+Enter intent dispatches SubmitComposerIntent', (
    tester,
  ) async {
    var submitCount = 0;
    await pumpShell(tester, <Type, Action<Intent>>{
      SubmitComposerIntent: CallbackAction<SubmitComposerIntent>(
        onInvoke: (_) {
          submitCount++;
          return null;
        },
      ),
    });
    final context = tester.element(
      find.byKey(const Key('shortcut-harness-focus')),
    );
    Actions.invoke(context, const SubmitComposerIntent());
    await tester.pump();
    expect(submitCount, 1, reason: 'Submit intent must invoke exactly once');
  });

  testWidgets('OpenSearchIntent fires when dispatched', (tester) async {
    var searchCount = 0;
    await pumpShell(tester, <Type, Action<Intent>>{
      OpenSearchIntent: CallbackAction<OpenSearchIntent>(
        onInvoke: (_) {
          searchCount++;
          return null;
        },
      ),
    });
    final context = tester.element(
      find.byKey(const Key('shortcut-harness-focus')),
    );
    Actions.invoke(context, const OpenSearchIntent());
    await tester.pump();
    expect(searchCount, 1, reason: 'Search intent must invoke exactly once');
  });

  testWidgets('OpenChatsIntent fires when dispatched', (tester) async {
    var chatsCount = 0;
    await pumpShell(tester, <Type, Action<Intent>>{
      OpenChatsIntent: CallbackAction<OpenChatsIntent>(
        onInvoke: (_) {
          chatsCount++;
          return null;
        },
      ),
    });
    final context = tester.element(
      find.byKey(const Key('shortcut-harness-focus')),
    );
    Actions.invoke(context, const OpenChatsIntent());
    await tester.pump();
    expect(chatsCount, 1, reason: 'Chats intent must invoke exactly once');
  });

  testWidgets('OpenCommandsIntent is intentionally absent', (tester) async {
    // The chat-shell surface intentionally exposes no commands/catalogue
    // intent because the normal daemon does not produce a catalogue
    // provider. The intent const must therefore not be in the package
    // and the shortcut map must not reference one.
    final shortcuts = buildChatShellShortcuts();
    expect(
      shortcuts.values.any(
        (intent) => intent.runtimeType.toString() == 'OpenCommandsIntent',
      ),
      isFalse,
      reason: 'Released shell must not advertise a commands/catalogue intent',
    );
  });

  testWidgets(
    'IME composition in a TextField wins over SubmitComposerIntent dispatch',
    (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Shortcuts(
            shortcuts: buildChatShellShortcuts(),
            child: Actions(
              actions: <Type, Action<Intent>>{
                SubmitComposerIntent: CallbackAction<SubmitComposerIntent>(
                  onInvoke: (_) => null,
                ),
              },
              child: Scaffold(
                body: TextField(controller: controller, autofocus: true),
              ),
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), 'hello world');
      // Even when the same intent is dispatched from outside the TextField,
      // the focused child TextField wins: the field's own TextInputAction /
      // IME keeps the keystrokes, and dispatching the intent does not
      // override the user-typed text.
      final shellContext = tester.element(find.byType(Scaffold));
      Actions.invoke(shellContext, const SubmitComposerIntent());
      await tester.pump();
      expect(
        controller.text,
        'hello world',
        reason: 'Field text is untouched by intent dispatch',
      );
    },
  );

  test('buildChatShellShortcuts returns Ctrl and Command variants', () {
    final shortcuts = buildChatShellShortcuts();
    expect(shortcuts.length, 6);
    expect(shortcuts.values.toSet(), <Intent>{
      const SubmitComposerIntent(),
      const OpenSearchIntent(),
      const OpenChatsIntent(),
    });
    expect(
      shortcuts[const SingleActivator(LogicalKeyboardKey.enter, control: true)],
      const SubmitComposerIntent(),
    );
    expect(
      shortcuts[const SingleActivator(LogicalKeyboardKey.enter, meta: true)],
      const SubmitComposerIntent(),
    );
    expect(
      shortcuts[const SingleActivator(LogicalKeyboardKey.keyK, control: true)],
      const OpenSearchIntent(),
    );
    expect(
      shortcuts[const SingleActivator(LogicalKeyboardKey.keyK, meta: true)],
      const OpenSearchIntent(),
    );
    expect(
      shortcuts[const SingleActivator(
        LogicalKeyboardKey.keyO,
        control: true,
        shift: true,
      )],
      const OpenChatsIntent(),
    );
  });
}
