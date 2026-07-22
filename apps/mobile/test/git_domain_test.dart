import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/git/git.dart';

void main() {
  Map<String, Object?> validSummary({
    List<Object?>? supportedActions,
    List<Object?>? failedChecks,
    Object? pullRequest,
  }) => {
    'workspaceId': 'git-workspace',
    'revision': 'git-r1',
    'repositoryUrl': 'https://example.test/pi-mob',
    'repository': 'pi-mob/pi-mob',
    'detached': false,
    'branch': 'feature/git-ci',
    'workingTreeState': 'dirty',
    'changedCount': 2,
    'ahead': 1,
    'behind': 0,
    'latestCommit': {
      'sha': 'abcdef1234567890abcdef1234567890abcdef12',
      'message': 'Add Git summary',
      'author': 'Pi Mob',
      'authoredAt': '2026-01-01T00:00:00.000Z',
      'url':
          'https://example.test/pi-mob/commit/abcdef1234567890abcdef1234567890abcdef12',
    },
    'pullRequest':
        pullRequest ??
        {
          'number': 42,
          'title': 'Add Git summary',
          'url': 'https://example.test/pi-mob/pull/42',
        },
    'ciStatus': {'state': 'failure'},
    'failedChecks':
        failedChecks ??
        [
          {
            'name': 'protocol-schema',
            'status': 'failure',
            'summary': 'schema failed',
            'logSummary': 'details',
            'url': 'https://example.test/pi-mob/checks/1',
          },
        ],
    'supportedActions':
        supportedActions ?? ['refresh', 'commit_through_pi', 'open_external'],
    'capability': 'git-ci.v1',
    'lastRefreshedAt': '2026-01-02T00:00:00.000Z',
  };

  test(
    'parses valid summary payloads with commit, PR, checks, and action gating',
    () {
      final state = reduceGit(const GitState(), 'git.summary', validSummary());
      expect(state.unavailable, isNull);
      expect(state.summary, isNotNull);
      expect(state.summary?.pullRequest?.number, 42);
      expect(state.summary?.failedChecks.single.logSummary, 'details');
      expect(state.summary?.canCommit, isTrue);
      expect(state.summary?.canPush, isFalse);
    },
  );

  test('detached summaries require null branch and remain usable', () {
    final state = reduceGit(const GitState(), 'git.summary', {
      ...validSummary(),
      'detached': true,
      'branch': null,
      'ahead': 0,
      'behind': 0,
      'failedChecks': <Object?>[],
      'supportedActions': <Object?>['refresh'],
    });
    expect(state.summary?.detached, isTrue);
    expect(state.summary?.branch, isNull);
  });

  test('malformed summary payloads never fabricate empty summaries', () {
    final state = reduceGit(const GitState(), 'git.summary', {
      ...validSummary(),
      'repositoryUrl': 'http://example.test/pi-mob',
      'failedChecks': List<Object?>.filled(21, {
        'name': 'x',
        'status': 'failure',
      }),
    });
    expect(state.summary, isNull);
    expect(state.unavailable?.reason, 'invalid_payload');
  });

  test(
    'duplicate or unsupported actions reject the payload instead of widening capabilities',
    () {
      final duplicate = reduceGit(
        const GitState(),
        'git.summary',
        validSummary(supportedActions: ['refresh', 'refresh']),
      );
      expect(duplicate.summary, isNull);
      final unsupported = reduceGit(
        const GitState(),
        'git.summary',
        validSummary(supportedActions: ['refresh', 'checkout']),
      );
      expect(unsupported.summary, isNull);
    },
  );

  test('git unavailable events read nested capability status exactly', () {
    final state = reduceGit(const GitState(), 'git.unavailable', {
      'workspaceId': 'git-workspace',
      'capability': 'git-ci.v1',
      'status': {
        'state': 'unavailable',
        'reason': 'Git provider is unavailable',
        'remediation': 'Retry later',
      },
    });
    expect(state.summary, isNull);
    expect(state.unavailable?.message, 'Git provider is unavailable');
    expect(state.unavailable?.remediation, 'Retry later');
  });

  test('strict HTTPS validation matches the Git external surface', () {
    expect(isSafeGitExternalUrl('https://example.test/pi-mob'), isTrue);
    expect(
      isSafeGitExternalUrl('https://user:pass@example.test/pi-mob'),
      isFalse,
    );
    expect(isSafeGitExternalUrl('http://example.test/pi-mob'), isFalse);
    expect(isSafeGitExternalUrl('https://example.test/pi mob'), isFalse);
  });
}
