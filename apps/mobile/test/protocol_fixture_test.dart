import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/protocol_fixture.dart';
import 'test_asset_loader.dart';

const Object _omittedLabel = Object();

Map<String, Object?> _promptSubmitWithPlanTarget(
  Map<String, Object?>? planTarget,
) => <String, Object?>{
  'protocol': const <String, Object?>{'major': 1, 'minor': 0},
  'messageId': '11111111-1111-4111-8111-111111111111',
  'requestId': '22222222-2222-4222-8222-222222222222',
  'connectionId': '33333333-3333-4333-8333-333333333333',
  'commandId': '44444444-4444-4444-8444-444444444444',
  'leaseId': '55555555-5555-4555-8555-555555555555',
  'type': 'prompt.submit',
  'sentAt': '2026-07-15T04:20:00.000Z',
  'payload': <String, Object?>{
    'sessionId': '66666666-6666-4666-8666-666666666666',
    'deliveryMode': 'steer',
    'message': 'Update the plan',
    'attachmentIds': const <String>[],
    'planTarget': planTarget,
  },
};

Map<String, Object?> _recipeEvent(String type, Map<String, Object?> payload) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'eventId': '22222222-2222-4222-8222-222222222222',
      'streamId': 'session:33333333-3333-4333-8333-333333333333',
      'cursor': '1',
      'type': type,
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': payload,
    };

Map<String, Object?> _recipeActivity(String kind) => <String, Object?>{
  'kind': kind,
  'sessionId': '33333333-3333-4333-8333-333333333333',
  'turnId': 'turn-1',
  'activityId': 'activity-1',
  'ordinal': 0,
  'status': 'running',
  'timing': <String, Object?>{'startedAt': '2026-07-15T04:20:00.000Z'},
  'title': 'Working',
  if (kind == 'tool') ...<String, Object?>{
    'toolName': 'read',
    'arguments': '{}',
    'output': 'ok',
  },
};

Map<String, Object?> _contextUnpin(Map<String, Object?> target) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'requestId': '22222222-2222-4222-8222-222222222222',
      'connectionId': '33333333-3333-4333-8333-333333333333',
      'commandId': '44444444-4444-4444-8444-444444444444',
      'leaseId': '55555555-5555-4555-8555-555555555555',
      'type': 'context.unpin',
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': <String, Object?>{
        'sessionId': '66666666-6666-4666-8666-666666666666',
        'expectedRevision': 'context-r1',
        'target': target,
      },
    };

Map<String, Object?> _workspaceControl(String type, String path) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-1111-111111111111',
      'requestId': '22222222-2222-4222-2222-222222222222',
      'connectionId': '33333333-3333-4333-3333-333333333333',
      'type': type,
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': <String, Object?>{
        'workspaceId': '44444444-4444-4444-4444-444444444444',
        'path': path,
      },
    };

Map<String, Object?> _workspaceTreePage(Map<String, Object?> node) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'requestId': '22222222-2222-4222-8222-222222222222',
      'type': 'workspace.tree.page.result',
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r1',
        'items': <Object?>[node],
      },
    };

Map<String, Object?> _workspaceTreeSnapshot(Object? change) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'eventId': '22222222-2222-4222-8222-222222222222',
      'streamId': 'host:33333333-3333-4333-8333-333333333333',
      'cursor': '1',
      'type': 'workspace.tree.snapshot',
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r2',
        'changeSet': <Object?>[change],
        'capability': 'files.v1',
        'status': <String, Object?>{
          'state': 'available',
          'source': 'workspace-index',
          'revision': 'tree-r2',
          'lastRefreshedAt': '2026-07-15T04:20:00.000Z',
        },
      },
    };

void main() {
  test('workspace path validation is shared across all R3 controls', () {
    const controls = <String>[
      'workspace.tree.page',
      'workspace.file.search',
      'workspace.file.content.search',
      'workspace.file.metadata',
      'workspace.file.read',
    ];
    final invalidPaths = <String>[
      '.',
      '..',
      './src',
      '../secrets',
      'foo/./bar',
      'foo/../bar',
      '/etc/passwd',
      r'foo\bar',
      'foo//bar',
      'foo\u0000bar',
      'x' * 1025,
    ];

    for (final type in controls) {
      expect(
        ProtocolEnvelope.fromJson(_workspaceControl(type, '.git/config')),
        isA<ProtocolControl>(),
      );
      for (final path in invalidPaths) {
        expect(
          () => ProtocolEnvelope.fromJson(_workspaceControl(type, path)),
          throwsA(isA<ProtocolValidationException>()),
          reason: '$type: ${jsonEncode(path)}',
        );
      }
    }
  });

  test(
    'workspace tree FileNode depth boundaries and closed shape match TS',
    () {
      Map<String, Object?> node(Object? depth) => <String, Object?>{
        'path': 'src/index.ts',
        'kind': 'file',
        'depth': depth,
        'size': 26214400,
      };

      for (final depth in const <int>[0, 16]) {
        expect(
          validateProtocolFixture('response', _workspaceTreePage(node(depth))),
          isA<ProtocolResponse>(),
          reason: 'depth $depth',
        );
      }
      for (final depth in <Object?>[-1, 17, 1.5, '16', true, null]) {
        expect(
          () => validateProtocolFixture(
            'response',
            _workspaceTreePage(node(depth)),
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: 'depth $depth',
        );
      }
      for (final invalid in <Map<String, Object?>>[
        <String, Object?>{'path': 'src/index.ts', 'kind': 'file'},
        <String, Object?>{'path': '../index.ts', 'kind': 'file', 'depth': 0},
        <String, Object?>{'path': 'src', 'kind': 'folder', 'depth': 0},
        <String, Object?>{
          'path': 'src/index.ts',
          'kind': 'file',
          'depth': 0,
          'private': true,
        },
        <String, Object?>{
          'path': 'src/index.ts',
          'kind': 'file',
          'depth': 0,
          'size': 26214401,
        },
      ]) {
        expect(
          () =>
              validateProtocolFixture('response', _workspaceTreePage(invalid)),
          throwsA(isA<ProtocolValidationException>()),
          reason: invalid.toString(),
        );
      }
    },
  );

  test('workspace tree snapshot changeSet items are closed paths', () {
    expect(
      validateProtocolFixture('event', _workspaceTreeSnapshot('.git/config')),
      isA<ProtocolEvent>(),
    );
    for (final change in <Object?>[
      '../private',
      '/absolute',
      <String, Object?>{'path': 'src/index.ts'},
      null,
    ]) {
      expect(
        () => validateProtocolFixture('event', _workspaceTreeSnapshot(change)),
        throwsA(isA<ProtocolValidationException>()),
        reason: change.toString(),
      );
    }
  });

  test('context target kind is required and must match its shape', () {
    for (final target in <Map<String, Object?>>[
      <String, Object?>{'path': 'src/index.ts'},
      <String, Object?>{'kind': null, 'path': 'src/index.ts'},
      <String, Object?>{'kind': 'source', 'path': 'src/index.ts'},
    ]) {
      expect(
        () => validateProtocolFixture('command', _contextUnpin(target)),
        throwsA(isA<ProtocolValidationException>()),
        reason: target.toString(),
      );
    }
    expect(
      validateProtocolFixture(
        'command',
        _contextUnpin(<String, Object?>{
          'kind': 'file',
          'path': 'src/index.ts',
        }),
      ),
      isA<ProtocolCommand>(),
    );
  });

  test('context file range label is optional but strictly bounded', () {
    Map<String, Object?> target([Object? label = _omittedLabel]) =>
        <String, Object?>{
          'kind': 'file',
          'path': 'src/index.ts',
          'ranges': <Object?>[
            <String, Object?>{
              'startLine': 1,
              'endLine': 1,
              if (!identical(label, _omittedLabel)) 'label': label,
            },
          ],
        };

    expect(
      validateProtocolFixture('command', _contextUnpin(target())),
      isA<ProtocolCommand>(),
    );
    expect(
      validateProtocolFixture('command', _contextUnpin(target('selection'))),
      isA<ProtocolCommand>(),
    );
    for (final label in <Object?>[null, 1, '', 'x' * 65]) {
      expect(
        () => validateProtocolFixture('command', _contextUnpin(target(label))),
        throwsA(isA<ProtocolValidationException>()),
        reason: 'label: $label',
      );
    }
  });

  test('shared corpus fixture labels match Dart validation', () async {
    final manifestRaw = await TestAssetLoader.loadString(
      'packages/protocol-fixtures/corpus/fixtures-manifest.json',
    );
    final manifest = List<Map<String, Object?>>.from(
      jsonDecode(manifestRaw) as List,
    );
    expect(manifest.length, greaterThan(100));
    for (final entry in manifest) {
      final raw = await TestAssetLoader.loadString(
        'packages/protocol-fixtures/corpus/${entry['file']}',
      );
      final fixture = Map<String, Object?>.from(jsonDecode(raw) as Map);
      final message = Map<String, Object?>.from(fixture['message'] as Map);
      if (fixture['valid'] == true) {
        final decoded = validateProtocolFixture(
          entry['kind'] as String,
          message,
        );
        expect(decoded, isNotNull, reason: entry['file'] as String?);
        if (decoded is ProtocolEnvelope) {
          expect(
            jsonDecode(jsonEncode(decoded.toJson())),
            message,
            reason: 'round-trip ${entry['file']}',
          );
        }
      } else {
        expect(
          () => validateProtocolFixture(entry['kind'] as String, message),
          throwsA(isA<ProtocolValidationException>()),
          reason: entry['file'] as String?,
        );
      }
    }
  });

  test('shared type dispatch follows envelope identity', () async {
    for (final fixtureName in const <String>[
      'control-workspace-file-metadata-valid.json',
      'event-workspace-file-metadata-valid.json',
    ]) {
      final raw = await TestAssetLoader.loadString(
        'packages/protocol-fixtures/corpus/$fixtureName',
      );
      final fixture = Map<String, Object?>.from(jsonDecode(raw) as Map);
      final message = Map<String, Object?>.from(fixture['message'] as Map);
      final decoded = ProtocolEnvelope.fromJson(message);
      expect(
        decoded,
        fixtureName.startsWith('control-')
            ? isA<ProtocolControl>()
            : isA<ProtocolEvent>(),
      );
    }
  });

  test('controller lease renew responses are recognized', () {
    final decoded = validateProtocolFixture('response', <String, Object?>{
      'protocol': const {'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'requestId': '22222222-2222-4222-8222-222222222222',
      'type': 'controller.renew.result',
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': const {
        'leaseId': '33333333-3333-4333-8333-333333333333',
        'expiresAt': 1784089300000,
      },
    });
    expect(decoded, isA<ProtocolEnvelope>());
  });

  test('legacy partial session summaries remain replayable', () {
    final decoded = validateProtocolFixture('event', <String, Object?>{
      'protocol': const {'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'eventId': '22222222-2222-4222-8222-222222222222',
      'streamId': 'host:33333333-3333-4333-8333-333333333333',
      'cursor': '49',
      'type': 'session.summary',
      'sentAt': '2026-07-15T04:08:45.772Z',
      'payload': const {
        'sessionId': '44444444-4444-4444-8444-444444444444',
        'runtimeState': 'starting',
      },
    });
    expect(decoded, isA<ProtocolEnvelope>());
  });

  test('prompt.submit accepts a valid bounded planTarget', () {
    final boundedId = List<String>.filled(128, 'a').join();
    expect(
      validateProtocolFixture(
        'command',
        _promptSubmitWithPlanTarget(<String, Object?>{
          'planId': boundedId,
          'stepId': boundedId,
          'revision': 'r1',
        }),
      ),
      isA<ProtocolCommand>(),
    );
  });

  test('prompt.submit planTarget requires revision', () {
    expect(
      () => validateProtocolFixture(
        'command',
        _promptSubmitWithPlanTarget(<String, Object?>{
          'planId': 'plan-1',
          'stepId': 'step-1',
        }),
      ),
      throwsA(isA<ProtocolValidationException>()),
    );
  });

  test('prompt.submit planTarget rejects explicit null', () {
    expect(
      () =>
          validateProtocolFixture('command', _promptSubmitWithPlanTarget(null)),
      throwsA(isA<ProtocolValidationException>()),
    );
  });

  test('prompt.submit planTarget rejects private and decimal revisions', () {
    final invalidTargets = <String, Map<String, Object?>>{
      'private sibling': <String, Object?>{
        'planId': 'plan-1',
        'stepId': 'step-1',
        'revision': 'r1',
        'private': 'hidden',
      },
      'decimal revision': <String, Object?>{
        'planId': 'plan-1',
        'stepId': 'step-1',
        'revision': '42',
      },
    };
    for (final invalid in invalidTargets.entries) {
      expect(
        () => validateProtocolFixture(
          'command',
          _promptSubmitWithPlanTarget(invalid.value),
        ),
        throwsA(isA<ProtocolValidationException>()),
        reason: invalid.key,
      );
    }
  });

  test('recipe thinking activity accepts validated nested envelopes', () {
    final payload = _recipeActivity('thinking')
      ..['providerSummary'] = <String, Object?>{
        'kind': 'provider_summary',
        'provider': 'anthropic',
        'model': 'claude',
        'summary': 'Checked the requested files.',
        'truncation': <String, Object?>{
          'retainedBytes': 28,
          'totalBytes': 28,
          'isTruncated': false,
        },
      }
      ..['truncation'] = <String, Object?>{
        'retainedBytes': 28,
        'totalBytes': 40,
        'isTruncated': true,
        'digest': List<String>.filled(64, 'a').join(),
      };

    expect(
      validateProtocolFixture(
        'event',
        _recipeEvent('recipe.activity', payload),
      ),
      isA<ProtocolEvent>(),
    );
  });

  test('recipe activity validates its closed timing envelope', () {
    final payload = _recipeActivity('thinking')
      ..['timing'] = <String, Object?>{
        'startedAt': '2026-07-15T04:20:00.000Z',
        'private': true,
      };

    expect(
      () => validateProtocolFixture(
        'event',
        _recipeEvent('recipe.activity', payload),
      ),
      throwsA(isA<ProtocolValidationException>()),
    );
  });

  test('recipe thinking activity validates summary and truncation', () {
    final invalidNestedValues = <String, Object?>{
      'providerSummary': <String, Object?>{
        'kind': 'raw_thinking',
        'provider': 'anthropic',
        'summary': 'private',
      },
      'truncation': <String, Object?>{
        'retainedBytes': -1,
        'totalBytes': 1,
        'isTruncated': true,
      },
    };
    for (final invalid in invalidNestedValues.entries) {
      final payload = _recipeActivity('thinking')
        ..[invalid.key] = invalid.value;
      expect(
        () => validateProtocolFixture(
          'event',
          _recipeEvent('recipe.activity', payload),
        ),
        throwsA(isA<ProtocolValidationException>()),
        reason: invalid.key,
      );
    }
  });

  test('recipe tool activity validates error, truncation, and arm closure', () {
    final invalidNestedValues = <String, Object?>{
      'errorInfo': <String, Object?>{
        'code': 'private_error',
        'message': 'failed',
        'retryable': false,
      },
      'truncation': <String, Object?>{
        'retainedBytes': 1,
        'totalBytes': 1,
        'isTruncated': false,
        'digest': List<String>.filled(64, 'A').join(),
      },
      'providerSummary': <String, Object?>{
        'kind': 'provider_summary',
        'provider': 'anthropic',
        'summary': 'not valid on tools',
      },
    };
    for (final invalid in invalidNestedValues.entries) {
      final payload = _recipeActivity('tool')..[invalid.key] = invalid.value;
      expect(
        () => validateProtocolFixture(
          'event',
          _recipeEvent('recipe.activity', payload),
        ),
        throwsA(isA<ProtocolValidationException>()),
        reason: invalid.key,
      );
    }
  });

  test('recipe unavailable requires its capability and closed status', () {
    final valid = <String, Object?>{
      'capability': 'recipes.v1',
      'status': <String, Object?>{
        'state': 'unavailable',
        'reason': 'disabled',
        'remediation': 'enable recipes',
      },
    };
    expect(
      validateProtocolFixture(
        'event',
        _recipeEvent('recipe.unavailable', valid),
      ),
      isA<ProtocolEvent>(),
    );

    for (final invalid in <Map<String, Object?>>[
      <String, Object?>{...valid, 'capability': 'plans.v1'},
      <String, Object?>{
        ...valid,
        'status': <String, Object?>{'state': 'unavailable'},
      },
      <String, Object?>{...valid, 'private': true},
    ]) {
      expect(
        () => validateProtocolFixture(
          'event',
          _recipeEvent('recipe.unavailable', invalid),
        ),
        throwsA(isA<ProtocolValidationException>()),
      );
    }
  });

  test('decimal cursors and shared semantic hashes match TypeScript', () async {
    expect(
      DecimalCursor.parse(
        '9007199254740992',
      ).compareTo(DecimalCursor.parse('9007199254740991')),
      1,
    );
    expect(
      () => DecimalCursor.parse('01'),
      throwsA(isA<ProtocolValidationException>()),
    );

    final raw = await TestAssetLoader.loadString(
      'packages/protocol-fixtures/corpus/semantic-hashes.json',
    );
    final cases = List<Map<String, Object?>>.from(jsonDecode(raw) as List);
    for (final hashCase in cases) {
      final values =
          (hashCase['messages'] ?? hashCase['semanticCommands']) as List;
      expect(values.length, greaterThan(1));
      for (final value in values) {
        final json = Map<String, Object?>.from(value as Map);
        final command = ProtocolCommand(
          type: json['type'] as String,
          payload: Map<String, Object?>.from(json['payload'] as Map),
          commandId:
              (json['commandId'] as String?) ??
              '33333333-3333-4333-8333-333333333333',
        );
        expect(canonicalSemanticCommand(command), hashCase['canonical']);
        expect(semanticCommandSha256(command), hashCase['sha256']);
        expect(() => command.payload['new'] = true, throwsUnsupportedError);
        final nested = command.payload['a'];
        if (nested is List<Object?>) {
          expect(() => nested.add(false), throwsUnsupportedError);
        }
      }
    }
  });

  test('tool output boundary metadata remains exact and bounded', () async {
    for (final expected in <String, Map<String, Object?>>{
      'tool-output-event-boundary.json': <String, Object?>{
        'retainedBytes': 262144,
        'totalBytes': 262144,
        'isTruncated': false,
      },
      'tool-output-retained-boundary.json': <String, Object?>{
        'retainedBytes': 5242880,
        'totalBytes': 6291456,
        'isTruncated': true,
      },
    }.entries) {
      final raw = await TestAssetLoader.loadString(
        'packages/protocol-fixtures/corpus/${expected.key}',
      );
      final fixture = Map<String, Object?>.from(jsonDecode(raw) as Map);
      final message = Map<String, Object?>.from(fixture['message'] as Map);
      final payload = Map<String, Object?>.from(message['payload'] as Map);
      expect(
        payload,
        containsPair('retainedBytes', expected.value['retainedBytes']),
      );
      expect(payload, containsPair('totalBytes', expected.value['totalBytes']));
      expect(
        payload,
        containsPair('isTruncated', expected.value['isTruncated']),
      );
      expect(validateProtocolFixture('event', message), isA<ProtocolEvent>());
    }
  });

  test(
    'shared ordered scenario matrix applies transitions and reaches outcomes',
    () async {
      final raw = await TestAssetLoader.loadString(
        'packages/protocol-fixtures/corpus/scenarios.json',
      );
      final scenarios = List<Map<String, Object?>>.from(
        jsonDecode(raw) as List,
      );
      expect(scenarios.length, 11);
      for (final scenario in scenarios) {
        final steps = List<Map<String, Object?>>.from(
          (scenario['steps'] as List).map(
            (step) => Map<String, Object?>.from(step as Map),
          ),
        );
        expect(
          steps.length,
          greaterThan(1),
          reason: scenario['name'] as String?,
        );
        final machine = ProtocolScenarioMachine();
        for (final step in steps) {
          final fixtureRaw = await TestAssetLoader.loadString(
            'packages/protocol-fixtures/corpus/${step['fixture']}',
          );
          final fixture = Map<String, Object?>.from(
            jsonDecode(fixtureRaw) as Map,
          );
          final message = Map<String, Object?>.from(fixture['message'] as Map);
          if (fixture['valid'] == true) {
            expect(
              validateProtocolFixture(fixture['kind'] as String, message),
              isNotNull,
            );
          } else {
            expect(
              () => validateProtocolFixture(fixture['kind'] as String, message),
              throwsA(isA<ProtocolValidationException>()),
            );
          }
          expect(
            machine.apply(step['action'] as String, fixture),
            step['expect'],
          );
        }
        expect(machine.phase, scenario['outcome']);
      }
    },
  );

  test('scenario transitions reject out-of-order behavior', () {
    expect(
      () => ProtocolScenarioMachine().apply('snapshot.end'),
      throwsStateError,
    );
  });

  test('error correlation and canonical stream identities match TypeBox', () {
    final base = <String, Object?>{
      'protocol': <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-8111-111111111111',
      'requestId': '22222222-2222-4222-8222-222222222222',
      'commandId': '33333333-3333-4333-8333-333333333333',
      'sentAt': '2026-07-12T00:00:00.000Z',
    };
    final error = <String, Object?>{
      ...base,
      'type': 'error',
      'payload': <String, Object?>{
        'code': 'invalid_state',
        'message': 'invalid',
        'retryable': false,
        'details': <String, Object?>{},
      },
    };
    expect(ProtocolEnvelope.fromJson(error), isA<ProtocolError>());
    final invalidStream = <String, Object?>{
      ...base,
      'eventId': '44444444-4444-4444-8444-444444444444',
      'type': 'turn.started',
      'streamId': 'session:not-a-uuid',
      'cursor': '1',
      'payload': <String, Object?>{},
    };
    expect(
      () => ProtocolEnvelope.fromJson(invalidStream),
      throwsA(isA<ProtocolValidationException>()),
    );
  });
}
