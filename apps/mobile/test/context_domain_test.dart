// R4 — Focused tests for the closed `context_domain.dart` projections and
// their regex anchors. These exist to prevent silent regressions where
// raw-string regexes using `\$` (literal dollar) instead of `$` (end
// anchor) caused valid UUIDs and timestamps to fail validation while
// malformed suffixes slipped through. See docs/PROTOCOL.md §14 and
// Field Guide §2 for the closed payload contract.

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/context/context_domain.dart';

const _sessionId = '11111111-1111-4111-8111-111111111111';
const _iso8601 = '2026-07-12T00:00:00.000Z';

Map<String, Object?> _validSnapshotPayload({
  String sessionId = _sessionId,
  String revision = 'context-r1',
  String source = 'session-bridge',
  String lastRefreshedAt = _iso8601,
  Map<String, Object?>? capability,
  Map<String, Object?>? model,
  List<Object?>? pinnedFiles,
  Map<String, Object?>? tokenUsage,
}) => <String, Object?>{
  'sessionId': sessionId,
  'revision': revision,
  'source': source,
  'stale': false,
  'capability': capability ?? <String, Object?>{'state': 'available'},
  'model': ?model,
  'pinnedFiles': ?pinnedFiles,
  'tokenUsage': ?tokenUsage,
  'lastRefreshedAt': lastRefreshedAt,
};

Map<String, Object?> _validUnavailablePayload({
  String sessionId = _sessionId,
  String state = 'unavailable',
  String reason = 'No vetted context authority',
  String remediation = 'Install a vetted context authority.',
}) => <String, Object?>{
  'sessionId': sessionId,
  'capability': 'contexts.v1',
  'status': <String, Object?>{
    'state': state,
    'reason': reason,
    'remediation': remediation,
  },
};

void main() {
  group('ContextSnapshotData.tryParse', () {
    test('accepts a canonical snapshot payload', () {
      final snapshot = ContextSnapshotData.tryParse(_validSnapshotPayload());
      expect(snapshot, isNotNull);
      expect(snapshot!.sessionId, _sessionId);
      expect(snapshot.revision, 'context-r1');
      expect(snapshot.source, 'session-bridge');
      expect(snapshot.stale, isFalse);
      expect(snapshot.lastRefreshedAt, _iso8601);
    });

    test('accepts the optional model, pinnedFiles, tokenUsage fields', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(
          model: <String, Object?>{
            'provider': 'anthropic',
            'modelId': 'claude-3',
          },
          pinnedFiles: <Object?>[
            <String, Object?>{
              'path': 'README.md',
              'pinnedAt': _iso8601,
              'revision': 'file-r1',
            },
          ],
          tokenUsage: <String, Object?>{
            'inputTokens': '100',
            'outputTokens': '42',
          },
        ),
      );
      expect(snapshot, isNotNull);
      expect(snapshot!.model?.provider, 'anthropic');
      expect(snapshot.model?.modelId, 'claude-3');
      expect(snapshot.pinnedFiles, hasLength(1));
      expect(snapshot.pinnedFiles!.first.path, 'README.md');
      expect(snapshot.tokenUsage?.inputTokens, '100');
      expect(snapshot.tokenUsage?.outputTokens, '42');
    });

    test('rejects a sessionId that has a trailing suffix', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(sessionId: '$_sessionId-extra'),
      );
      expect(snapshot, isNull);
    });

    test('rejects a non-UUID sessionId', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(sessionId: 'not-a-uuid'),
      );
      expect(snapshot, isNull);
    });

    test('rejects a lastRefreshedAt that has a trailing suffix', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(lastRefreshedAt: '$_iso8601-extra'),
      );
      expect(snapshot, isNull);
    });

    test('rejects a lastRefreshedAt with malformed timezone text', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(
          lastRefreshedAt: '2026-07-12T00:00:00.000+00:00-extra',
        ),
      );
      expect(snapshot, isNull);
    });

    test('rejects a non-available capability', () {
      final snapshot = ContextSnapshotData.tryParse(
        _validSnapshotPayload(
          capability: <String, Object?>{
            'state': 'unavailable',
            'reason': 'No authority installed',
            'remediation': 'Install a vetted authority.',
          },
        ),
      );
      expect(snapshot, isNull);
    });

    test('rejects empty revision and source', () {
      expect(
        ContextSnapshotData.tryParse(_validSnapshotPayload(revision: '')),
        isNull,
      );
      expect(
        ContextSnapshotData.tryParse(_validSnapshotPayload(source: '')),
        isNull,
      );
    });
  });

  group('ContextUnavailableData.tryParse', () {
    test('accepts a canonical unavailable payload', () {
      final unavailable = ContextUnavailableData.tryParse(
        _validUnavailablePayload(),
      );
      expect(unavailable, isNotNull);
      expect(unavailable!.sessionId, _sessionId);
      expect(unavailable.reason, 'unavailable');
      expect(unavailable.message, 'No vetted context authority');
      expect(unavailable.remediation, contains('vetted context authority'));
    });

    test('rejects a sessionId that has a trailing suffix', () {
      final unavailable = ContextUnavailableData.tryParse(
        _validUnavailablePayload(sessionId: '$_sessionId-extra'),
      );
      expect(unavailable, isNull);
    });

    test('rejects a non-contexts.v1 capability literal', () {
      final unavailable = ContextUnavailableData.tryParse(<String, Object?>{
        'sessionId': _sessionId,
        'capability': 'something.v1',
        'status': <String, Object?>{
          'state': 'unavailable',
          'reason': 'No vetted context authority',
          'remediation': 'Install a vetted authority.',
        },
      });
      expect(unavailable, isNull);
    });

    test('rejects an unavailable payload missing the remediation', () {
      final unavailable = ContextUnavailableData.tryParse(<String, Object?>{
        'sessionId': _sessionId,
        'capability': 'contexts.v1',
        'status': <String, Object?>{
          'state': 'unavailable',
          'reason': 'No vetted context authority',
        },
      });
      expect(unavailable, isNull);
    });

    test('rejects an unavailable payload missing the reason', () {
      final unavailable = ContextUnavailableData.tryParse(<String, Object?>{
        'sessionId': _sessionId,
        'capability': 'contexts.v1',
        'status': <String, Object?>{
          'state': 'unavailable',
          'remediation': 'Install a vetted authority.',
        },
      });
      expect(unavailable, isNull);
    });

    test(
      'rejects a state outside the closed unavailable/stale/degraded set',
      () {
        final unavailable = ContextUnavailableData.tryParse(
          _validUnavailablePayload(state: 'available'),
        );
        expect(unavailable, isNull);
      },
    );
  });

  group('reduceContext', () {
    test('applies a snapshot and clears refreshing', () {
      final next = reduceContext(
        const ContextState(refreshing: true),
        'context.snapshot.result',
        _validSnapshotPayload(),
      );
      expect(next.snapshot, isNotNull);
      expect(next.unavailable, isNull);
      expect(next.refreshing, isFalse);
      expect(next.lastRequestRevision, 'context-r1');
    });

    test('applies a context.unavailable event and clears snapshot', () {
      final next = reduceContext(
        const ContextState(),
        'context.unavailable',
        _validUnavailablePayload(),
      );
      expect(next.unavailable, isNotNull);
      expect(next.snapshot, isNull);
      expect(next.refreshing, isFalse);
    });

    test('reduces a malformed snapshot to invalid_payload unavailable', () {
      final next = reduceContext(
        const ContextState(),
        'context.snapshot.result',
        <String, Object?>{},
      );
      expect(next.snapshot, isNull);
      expect(next.unavailable, isNotNull);
      expect(next.unavailable!.reason, 'invalid_payload');
    });

    test('reduces a malformed context.unavailable to invalid_payload', () {
      final next = reduceContext(
        const ContextState(),
        'context.unavailable',
        <String, Object?>{},
      );
      expect(next.snapshot, isNull);
      expect(next.unavailable, isNotNull);
      expect(next.unavailable!.reason, 'invalid_payload');
    });

    test('sets refreshing on context.snapshot.request', () {
      final next = reduceContext(
        const ContextState(),
        'context.snapshot.request',
        <String, Object?>{'sessionId': _sessionId, 'requestId': 'r'},
      );
      expect(next.refreshing, isTrue);
    });
  });

  group('ContextMutationTarget', () {
    test('serializes a file target without ranges or revision', () {
      final target = ContextMutationTarget.file(path: 'src/main.dart');
      expect(
        target.toJson(),
        equals(<String, Object?>{'kind': 'file', 'path': 'src/main.dart'}),
      );
    });

    test('serializes a file target with revision only', () {
      final target = ContextMutationTarget.file(
        path: 'src/main.dart',
        revision: 'src-r1',
      );
      expect(
        target.toJson(),
        equals(<String, Object?>{
          'kind': 'file',
          'path': 'src/main.dart',
          'revision': 'src-r1',
        }),
      );
    });

    test('serializes a source target', () {
      final target = ContextMutationTarget.source(sourceId: 'cmd-out-7');
      expect(
        target.toJson(),
        equals(<String, Object?>{'kind': 'source', 'sourceId': 'cmd-out-7'}),
      );
    });

    test('serializes an all target', () {
      expect(
        ContextMutationTarget.all().toJson(),
        equals(<String, Object?>{'kind': 'all'}),
      );
    });
  });
}
