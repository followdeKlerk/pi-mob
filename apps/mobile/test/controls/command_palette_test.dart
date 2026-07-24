import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/command_palette.dart';
import 'package:pi_mob/src/domain/command_catalogue.dart';

const _catalogue = CommandCatalogue(
  entries: [
    CommandCatalogueEntry(
      id: 'skill:review',
      title: 'Review code',
      category: CommandCatalogueCategory.skill,
      description: 'Inspect a change list',
      invocation: '/review',
    ),
    CommandCatalogueEntry(
      id: 'template:standup',
      title: 'Standup',
      category: CommandCatalogueCategory.template,
      description: 'Daily standup template',
      invocation: '/standup',
    ),
    CommandCatalogueEntry(
      id: 'extension:deploy',
      title: 'Deploy',
      category: CommandCatalogueCategory.extension,
      description: 'Ship the current build',
      invocation: '/deploy',
      available: false,
      unavailableReason: 'Extension unavailable on this host.',
      reloadRequired: true,
    ),
  ],
  unavailableReason: 'Tools and MCP availability were not reported by Pi.',
  reloadRequired: true,
);

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  test('catalogue search and grouping are immutable and ordered', () {
    final grouped = _catalogue.grouped();
    expect(grouped.map((item) => item.label).toList(), [
      'Skills',
      'Templates',
      'Extensions',
    ]);
    expect(_catalogue.search('stand').single.title, 'Standup');
    expect(_catalogue.entries.length, 3);
  });

  testWidgets('palette groups entries and exposes copy and insert callbacks', (
    tester,
  ) async {
    CommandCatalogueEntry? copied;
    CommandCatalogueEntry? inserted;
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 420,
          height: 720,
          child: CommandPalette(
            catalogue: _catalogue,
            onCopy: (entry) => copied = entry,
            onInsert: (entry) => inserted = entry,
          ),
        ),
      ),
    );

    expect(find.text('Skills'), findsOneWidget);
    expect(
      find.textContaining(
        'Reload Pi to refresh commands, tools, and MCP availability.',
      ),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('command-copy-skill:review')));
    await tester.pump();
    expect(copied?.invocation, '/review');

    await tester.tap(find.byKey(const ValueKey('command-insert-skill:review')));
    await tester.pump();
    expect(inserted?.invocation, '/review');

    await tester.scrollUntilVisible(
      find.text('Extensions'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Templates', skipOffstage: false), findsOneWidget);
    expect(find.text('Extensions'), findsOneWidget);
  });

  testWidgets('search filters results and unavailable entries stay explicit', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 420,
          height: 720,
          child: CommandPalette(
            catalogue: _catalogue,
            onCopy: (_) {},
            onInsert: (_) {},
          ),
        ),
      ),
    );

    await tester.enterText(
      find.byKey(const Key('command-palette-search')),
      'standup',
    );
    await tester.pump();
    expect(find.text('Standup'), findsOneWidget);
    expect(find.text('Review code'), findsNothing);

    await tester.enterText(
      find.byKey(const Key('command-palette-search')),
      'deploy',
    );
    await tester.pump();
    expect(find.text('Extension unavailable on this host.'), findsOneWidget);
    expect(find.text('Insert after reload'), findsOneWidget);
  });

  testWidgets('renders at 200 percent text scale without overflow', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: SizedBox(
            width: 320,
            height: 900,
            child: CommandPalette(
              catalogue: _catalogue,
              onCopy: (_) {},
              onInsert: (_) {},
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
