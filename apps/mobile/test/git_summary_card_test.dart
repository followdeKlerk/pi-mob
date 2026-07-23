import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/git/git.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

GitState buildState({
  List<String> actions = const [
    'refresh',
    'commit_through_pi',
    'open_external',
  ],
}) {
  return GitState(
    summary: GitSummaryData(
      workspaceId: 'git-workspace',
      revision: 'git-r1',
      repositoryUrl: 'https://example.test/pi-mob',
      repository: 'pi-mob/pi-mob',
      detached: false,
      branch: 'feature/git-ci',
      workingTreeState: 'dirty',
      changedCount: 2,
      ahead: 1,
      behind: 0,
      latestCommit: const GitCommitData(
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        message: 'Add Git summary',
        author: 'Pi Mob',
        authoredAt: '2026-01-01T00:00:00.000Z',
        url:
            'https://example.test/pi-mob/commit/abcdef1234567890abcdef1234567890abcdef12',
      ),
      pullRequest: const GitPullRequestData(
        number: 42,
        title: 'Add Git summary',
        url: 'https://example.test/pi-mob/pull/42',
      ),
      ciState: 'failure',
      failedChecks: const [
        GitCheckData(
          name: 'protocol-schema',
          status: 'failure',
          summary: 'schema failed',
          logSummary: 'details',
          url: 'https://example.test/pi-mob/checks/1',
        ),
      ],
      supportedActions: actions,
      lastRefreshedAt: '2026-01-02T00:00:00.000Z',
    ),
  );
}

void main() {
  testWidgets(
    'renders latest commit, pull request, failed checks, and safe links',
    (tester) async {
      final opened = <String>[];
      await tester.pumpWidget(
        _wrap(
          GitSummaryCard(
            state: buildState(),
            callbacks: GitCallbacks(
              onOpenExternal: opened.add,
              onRefresh: () {},
            ),
          ),
        ),
      );

      expect(find.text('Latest commit'), findsOneWidget);
      expect(find.text('Pull request'), findsOneWidget);
      expect(find.text('Failed checks'), findsOneWidget);
      expect(find.text('Add Git summary'), findsOneWidget);
      expect(find.text('#42 Add Git summary'), findsOneWidget);
      expect(find.text('schema failed'), findsOneWidget);
      expect(find.text('details'), findsOneWidget);

      await tester.tap(find.text('Open repository'));
      await tester.tap(find.text('Open pull request'));
      await tester.tap(find.text('Open commit'));
      await tester.tap(find.text('Open check'));

      expect(opened, [
        'https://example.test/pi-mob',
        'https://example.test/pi-mob/pull/42',
        'https://example.test/pi-mob/commit/abcdef1234567890abcdef1234567890abcdef12',
        'https://example.test/pi-mob/checks/1',
      ]);
    },
  );

  testWidgets('gates commit and push buttons strictly from supportedActions', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        GitSummaryCard(
          state: buildState(actions: const ['refresh', 'push_through_pi']),
          callbacks: const GitCallbacks(
            onCommitConfirmed: null,
            onPushConfirmed: null,
          ),
        ),
      ),
    );

    expect(find.text('Commit through Pi'), findsNothing);
    expect(find.text('Push through Pi'), findsNothing);

    await tester.pumpWidget(
      _wrap(
        GitSummaryCard(
          state: buildState(actions: const ['refresh', 'push_through_pi']),
          callbacks: GitCallbacks(onPushConfirmed: () {}),
        ),
      ),
    );

    expect(find.text('Commit through Pi'), findsNothing);
    expect(find.text('Push through Pi'), findsOneWidget);
  });

  testWidgets('shows remediation on unavailable payloads', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const GitSummaryCard(
          state: GitState(
            unavailable: GitUnavailableData(
              workspaceId: 'git-workspace',
              reason: 'unavailable',
              message: 'Git provider is unavailable',
              remediation: 'Retry later',
            ),
          ),
        ),
      ),
    );

    expect(find.text('Git unavailable'), findsOneWidget);
    expect(find.text('Git provider is unavailable'), findsOneWidget);
    expect(find.text('Retry later'), findsOneWidget);
  });
}
