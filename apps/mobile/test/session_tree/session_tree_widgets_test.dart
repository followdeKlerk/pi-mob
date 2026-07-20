import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_tree/session_tree.dart';

Widget app(Widget child, {double scale = 1}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(scale)),
    child: Scaffold(body: SizedBox(width: 420, height: 780, child: child)),
  ),
);

void main() {
  testWidgets('tree shows fork preview and clone has distinct confirmation', (
    tester,
  ) async {
    final node = SessionTreeNodeData(
      entryId: 'entry',
      kind: SessionTreeEntryKind.userPrompt,
      preview: 'Selected user prompt',
      depth: 0,
      isForkEligible: true,
    );
    await tester.pumpWidget(
      app(
        SessionTreeView(
          data: SessionTreeViewData(sessionName: 'Branch', roots: [node]),
          callbacks: const SessionTreeCallbacks(onFork: null),
        ),
      ),
    );
    expect(find.text('Clone branch'), findsOneWidget);
    expect(find.text('Selected user prompt'), findsOneWidget);
  });

  testWidgets('lifecycle panel exposes seven-day restore and repair', (
    tester,
  ) async {
    final data = SessionLifecycleViewData(
      identity: const SessionIdentityViewData(
        sessionId: 's',
        fallbackName: 'Session s',
        workspaceLabel: 'Workspace',
      ),
      isDeleted: true,
      purgeDateLabel: '21 July 2026',
      canRestore: true,
      deleteFailedMessage: 'Session files could not be moved. Repair required.',
    );
    await tester.pumpWidget(
      app(
        SessionLifecyclePanel(
          data: data,
          callbacks: const SessionLifecycleCallbacks(),
        ),
        scale: 2,
      ),
    );
    expect(find.textContaining('21 July 2026'), findsWidgets);
    expect(find.textContaining('Repair'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('permanent delete requires typed DELETE', (tester) async {
    var purged = false;
    final data = SessionLifecycleViewData(
      identity: const SessionIdentityViewData(
        sessionId: 's',
        customName: 'Disposable',
        fallbackName: 'Session s',
        workspaceLabel: 'Workspace',
      ),
      isDeleted: true,
      purgeDateLabel: '21 July 2026',
      canRestore: true,
    );
    await tester.pumpWidget(
      app(
        SessionLifecyclePanel(
          data: data,
          callbacks: SessionLifecycleCallbacks(
            onPermanentDelete: () => purged = true,
          ),
        ),
      ),
    );
    final permanent = find.byKey(const Key('session-permanent-delete'));
    expect(permanent, findsOneWidget);
    await tester.tap(permanent);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('session-purge-dialog')), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('session-purge-confirm')))
          .onPressed,
      isNull,
    );
    await tester.enterText(
      find.byKey(const Key('session-purge-confirmation-field')),
      'DELETE',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('session-purge-confirm')));
    await tester.pumpAndSettle();
    expect(purged, isTrue);
  });
}
