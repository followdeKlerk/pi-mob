import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/git/git.dart';

void main() {
  test('reducer keeps explicit unavailable state and never invents summary', () {
    final state = reduceGit(const GitState(), 'git.unavailable', {
      'workspaceId': 'w', 'reason': 'remote_missing', 'message': 'No remote',
    });
    expect(state.summary, isNull);
    expect(state.unavailable?.reason, 'remote_missing');
  });

  test('detached state and external links are safe', () {
    final state = reduceGit(const GitState(), 'git.summary', {
      'workspaceId': 'w', 'revision': 'r', 'repositoryUrl': 'https://example.test/r', 'repository': 'a/r',
      'detached': true, 'branch': null, 'workingTreeState': 'clean', 'changedCount': 0, 'ahead': 0, 'behind': 0,
      'latestCommit': {'sha': 'abcdef1', 'authoredAt': '2026-01-01T00:00:00Z', 'url': 'https://example.test/r/commit/abcdef1'},
      'ciStatus': {'state': 'unknown'}, 'failedChecks': <Object?>[], 'supportedActions': <Object?>[], 'lastRefreshedAt': '2026-01-01T00:00:00Z',
    });
    expect(state.summary?.detached, isTrue);
    expect(state.summary?.branch, isNull);
    expect(isSafeGitExternalUrl('https://example.test/r'), isTrue);
    expect(isSafeGitExternalUrl('http://example.test/r'), isFalse);
  });
}
