import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/controls.dart';

const _commands = <SupportedCommandData>[
  SupportedCommandData(
    id: 's1',
    title: 'Investigate',
    category: SupportedCommandCategory.skill,
    description: 'Investigate a bug',
    invocation: '/investigate',
  ),
  SupportedCommandData(
    id: 't1',
    title: 'Standup',
    category: SupportedCommandCategory.template,
    description: 'Daily standup template',
    invocation: '/standup',
  ),
  SupportedCommandData(
    id: 'e1',
    title: 'pi-mob QR',
    category: SupportedCommandCategory.extension,
    description: 'Show QR for pairing',
    invocation: '/pi-mob',
  ),
  SupportedCommandData(
    id: 'disabled',
    title: 'TUI only',
    category: SupportedCommandCategory.skill,
    description: 'Not supported in RPC mode',
    invocation: '/tui-only',
    enabled: false,
    disabledReason: 'TUI-only command excluded from mobile palette',
  ),
];

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('groups by category and invokes selected command', (
    tester,
  ) async {
    SupportedCommandData? invoked;
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 400,
          height: 600,
          child: SupportedCommandList(
            commands: _commands,
            onInvoke: (c) => invoked = c,
          ),
        ),
      ),
    );
    expect(find.text('Skills'), findsOneWidget);
    expect(find.text('Templates'), findsOneWidget);
    expect(find.text('Extensions'), findsOneWidget);
    expect(find.text('Investigate'), findsOneWidget);
    expect(find.text('TUI only'), findsOneWidget);

    await tester.tap(find.byKey(ValueKey('command-e1')));
    expect(invoked, isNotNull);
    expect(invoked!.id, 'e1');
  });

  testWidgets('search filters across title, description, invocation', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 400,
          height: 600,
          child: SupportedCommandList(commands: _commands, onInvoke: (_) {}),
        ),
      ),
    );
    await tester.enterText(find.byKey(const Key('command-search')), 'standup');
    await tester.pump();
    expect(find.text('Standup'), findsOneWidget);
    expect(find.text('Investigate'), findsNothing);
    expect(find.byKey(const Key('command-empty')), findsNothing);
  });

  testWidgets('disabled command is shown with reason and not invokable', (
    tester,
  ) async {
    SupportedCommandData? invoked;
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 400,
          height: 600,
          child: SupportedCommandList(
            commands: _commands,
            onInvoke: (c) => invoked = c,
          ),
        ),
      ),
    );
    expect(
      find.text('TUI-only command excluded from mobile palette'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(ValueKey('command-disabled')));
    expect(invoked, isNull);
  });

  testWidgets('renders at 200% text scale without overflow', (tester) async {
    await tester.pumpWidget(
      _wrap(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: SizedBox(
            width: 320,
            height: 800,
            child: SupportedCommandList(commands: _commands, onInvoke: (_) {}),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty search result shows empty state copy', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 400,
          height: 600,
          child: SupportedCommandList(commands: _commands, onInvoke: (_) {}),
        ),
      ),
    );
    await tester.enterText(find.byKey(const Key('command-search')), 'nope');
    await tester.pump();
    expect(find.byKey(const Key('command-empty')), findsOneWidget);
    expect(find.text('No commands match the current search.'), findsOneWidget);
  });
}
