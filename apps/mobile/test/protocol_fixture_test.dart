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

Map<String, Object?> _promptSubmitWithFileRefs(Object? fileRefs) =>
    <String, Object?>{
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
        'message': 'Inspect the selected lines',
        'attachmentIds': const <String>[],
        'fileRefs': fileRefs,
      },
    };

Map<String, Object?> _validFileRef() => <String, Object?>{
  'workspaceId': '77777777-7777-4777-8777-777777777777',
  'path': 'lib/src/parser.dart',
  'ranges': <Object?>[
    <String, Object?>{'startLine': 4, 'endLine': 9, 'label': 'Parser'},
  ],
  'digest': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'revision': 'file-r1',
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

Map<String, Object?> _contextSnapshotPayload({bool full = false}) {
  final payload = <String, Object?>{
    'sessionId': '33333333-3333-4333-8333-333333333333',
    'revision': 'context-r1',
    'source': 'session-bridge',
    'stale': false,
    'capability': <String, Object?>{'state': 'available'},
    'lastRefreshedAt': '2026-07-15T04:20:00.000Z',
  };
  if (full) {
    payload.addAll(<String, Object?>{
      'model': <String, Object?>{
        'provider': 'fixture-provider',
        'modelId': 'fixture-model',
      },
      'thinkingLevel': 'low',
      'instructions': 'Fixture workspace instructions.',
      'pinnedFiles': <Object?>[
        <String, Object?>{
          'path': 'src/index.ts',
          'pinnedAt': '2026-07-15T04:20:00.000Z',
          'ranges': <Object?>[
            <String, Object?>{
              'startLine': 1,
              'endLine': 3,
              'label': 'Fixture selection',
            },
          ],
          'revision': 'file-r1',
        },
      ],
      'tokenUsage': <String, Object?>{
        'inputTokens': '128',
        'outputTokens': '32',
        'cacheReadTokens': '16',
        'cacheWriteTokens': '0',
        'contextWindowTokens': '8192',
        'usagePercent': 0.02,
      },
      'compacted': true,
      'compactRevision': 'compact-r1',
      'compactedAt': '2026-07-15T04:19:00.000Z',
      'sources': <Object?>[
        <String, Object?>{
          'sourceId': 'source-fixture',
          'sourceKind': 'file',
          'summary': 'Pinned fixture file',
          'stale': false,
          'capability': <String, Object?>{'state': 'available'},
          'revision': 'file-r1',
          'lastRefreshedAt': '2026-07-15T04:20:00.000Z',
        },
      ],
    });
  }
  return payload;
}

Map<String, Object?> _contextSnapshotEvent(Map<String, Object?> payload) =>
    _recipeEvent('context.snapshot', payload);

Map<String, Object?> _contextSnapshotResult(Map<String, Object?> payload) =>
    <String, Object?>{
      'protocol': const <String, Object?>{'major': 1, 'minor': 0},
      'messageId': '11111111-1111-4111-1111-111111111111',
      'requestId': '22222222-2222-4222-2222-222222222222',
      'type': 'context.snapshot.result',
      'sentAt': '2026-07-15T04:20:00.000Z',
      'payload': payload,
    };

Map<String, Object?> _contextUnavailableEvent(Map<String, Object?> payload) =>
    _recipeEvent('context.unavailable', payload);

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

Map<String, Object?> _workspaceControl(String type, String path) {
  final payload = <String, Object?>{
    'workspaceId': '44444444-4444-4444-4444-444444444444',
    'path': path,
  };
  switch (type) {
    case 'workspace.tree.page':
      payload.addAll(<String, Object?>{'pageSize': 200, 'pageToken': null});
    case 'workspace.file.search':
    case 'workspace.file.content.search':
      payload['query'] = 'fixture';
    case 'workspace.file.read':
      payload.addAll(<String, Object?>{'rangeStart': 1, 'rangeEnd': 1});
  }
  return <String, Object?>{
    'protocol': const <String, Object?>{'major': 1, 'minor': 0},
    'messageId': '11111111-1111-4111-1111-111111111111',
    'requestId': '22222222-2222-4222-2222-222222222222',
    'connectionId': '33333333-3333-4333-3333-333333333333',
    'type': type,
    'sentAt': '2026-07-15T04:20:00.000Z',
    'payload': payload,
  };
}

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

Map<String, Object?> _workspaceResponse(
  String type,
  Map<String, Object?> payload,
) => <String, Object?>{
  'protocol': const <String, Object?>{'major': 1, 'minor': 0},
  'messageId': '11111111-1111-4111-8111-111111111111',
  'requestId': '22222222-2222-4222-8222-222222222222',
  'type': type,
  'sentAt': '2026-07-15T04:20:00.000Z',
  'payload': payload,
};

Map<String, Object?> _workspaceEvent(
  String type,
  Map<String, Object?> payload,
) => <String, Object?>{
  'protocol': const <String, Object?>{'major': 1, 'minor': 0},
  'messageId': '11111111-1111-4111-8111-111111111111',
  'eventId': '22222222-2222-4222-8222-222222222222',
  'streamId': 'host:33333333-3333-4333-8333-333333333333',
  'cursor': '1',
  'type': type,
  'sentAt': '2026-07-15T04:20:00.000Z',
  'payload': payload,
};

Map<String, Object?> _fileMetadata() => <String, Object?>{
  'path': 'src/index.ts',
  'size': 26214400,
  'sha256': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'isBinary': false,
  'modifiedAt': '2026-07-15T04:19:00.000Z',
  'revision': 'file-r1',
  'lastReadAt': '2026-07-15T04:20:00.000Z',
  'languageHint': 'x' * 32,
};

Map<String, Object?> _metadataResponse(Map<String, Object?> file) =>
    _workspaceResponse('workspace.file.metadata.result', <String, Object?>{
      'workspaceId': '44444444-4444-4444-8444-444444444444',
      'file': file,
    });

Map<String, Object?> _metadataEvent(Map<String, Object?> file) =>
    _workspaceEvent('workspace.file.metadata', <String, Object?>{
      'workspaceId': '44444444-4444-4444-8444-444444444444',
      'file': file,
      'previousRevision': 'file-r0',
      'capability': 'files.v1',
    });

Map<String, Object?> _fileReadResult() => <String, Object?>{
  'path': 'src/index.ts',
  'revision': 'file-r1',
  'rangeStart': 1,
  'rangeEnd': 1,
  'totalLines': 1,
  'content': 'fixture',
  'encoding': 'utf-8',
  'isTruncated': false,
  'lastModifiedAt': '2026-07-15T04:19:00.000Z',
};

Map<String, Object?> _fileReadResponse(Map<String, Object?> result) =>
    _workspaceResponse('workspace.file.read.result', <String, Object?>{
      'workspaceId': '44444444-4444-4444-8444-444444444444',
      'result': result,
    });

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

  test(
    'filename and content search results accept item and page boundaries',
    () {
      final filenameItem = <String, Object?>{
        'path': 'src/index.ts',
        'matchStart': 0,
        'matchLength': 1,
      };
      final filenamePayload = <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r1',
        'nextPageToken': 'p' * 256,
        'items': List<Object?>.generate(100, (_) => filenameItem),
      };
      expect(
        validateProtocolFixture(
          'response',
          _workspaceResponse('workspace.file.search.result', filenamePayload),
        ),
        isA<ProtocolResponse>(),
      );

      final contentItem = <String, Object?>{
        'path': 'src/index.ts',
        'line': 1,
        'column': 1,
        'matchStart': 0,
        'matchLength': 1,
        'lineText': 'x' * 4096,
      };
      final contentPayload = <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r1',
        'nextPageToken': null,
        'items': List<Object?>.generate(200, (_) => contentItem),
        'isTruncated': true,
      };
      expect(
        validateProtocolFixture(
          'response',
          _workspaceResponse(
            'workspace.file.content.search.result',
            contentPayload,
          ),
        ),
        isA<ProtocolResponse>(),
      );

      filenamePayload
        ..['nextPageToken'] = null
        ..['items'] = <Object?>[
          <String, Object?>{'path': 'README.md'},
        ];
      contentPayload['items'] = <Object?>[
        <String, Object?>{...contentItem, 'lineText': ''},
      ];
      expect(
        validateProtocolFixture(
          'response',
          _workspaceResponse('workspace.file.search.result', filenamePayload),
        ),
        isA<ProtocolResponse>(),
      );
      expect(
        validateProtocolFixture(
          'response',
          _workspaceResponse(
            'workspace.file.content.search.result',
            contentPayload,
          ),
        ),
        isA<ProtocolResponse>(),
      );
    },
  );

  test(
    'filename and content search results reject closed, missing, and oversized shapes',
    () {
      Map<String, Object?> filenamePayload() => <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r1',
        'items': <Object?>[
          <String, Object?>{
            'path': 'src/index.ts',
            'matchStart': 0,
            'matchLength': 1,
          },
        ],
      };
      Map<String, Object?> contentPayload() => <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'rootRevision': 'tree-r1',
        'items': <Object?>[
          <String, Object?>{
            'path': 'src/index.ts',
            'line': 1,
            'column': 1,
            'matchStart': 0,
            'matchLength': 1,
            'lineText': 'fixture',
          },
        ],
        'isTruncated': false,
      };

      final invalid = <String, Map<String, Object?>>{
        'filename private root': _workspaceResponse(
          'workspace.file.search.result',
          filenamePayload()..['private'] = true,
        ),
        'filename missing revision': _workspaceResponse(
          'workspace.file.search.result',
          filenamePayload()..remove('rootRevision'),
        ),
        'filename oversized items': _workspaceResponse(
          'workspace.file.search.result',
          filenamePayload()
            ..['items'] = List<Object?>.generate(
              101,
              (_) => <String, Object?>{'path': 'src/index.ts'},
            ),
        ),
        'filename private item': _workspaceResponse(
          'workspace.file.search.result',
          filenamePayload()
            ..['items'] = <Object?>[
              <String, Object?>{'path': 'src/index.ts', 'private': true},
            ],
        ),
        'filename nullable offset': _workspaceResponse(
          'workspace.file.search.result',
          filenamePayload()
            ..['items'] = <Object?>[
              <String, Object?>{'path': 'src/index.ts', 'matchStart': null},
            ],
        ),
        'content private item': _workspaceResponse(
          'workspace.file.content.search.result',
          contentPayload()
            ..['items'] = <Object?>[
              <String, Object?>{
                'path': 'src/index.ts',
                'line': 1,
                'column': 1,
                'matchStart': 0,
                'matchLength': 1,
                'lineText': 'fixture',
                'private': true,
              },
            ],
        ),
        'content missing line': _workspaceResponse(
          'workspace.file.content.search.result',
          contentPayload()
            ..['items'] = <Object?>[
              <String, Object?>{
                'path': 'src/index.ts',
                'column': 1,
                'matchStart': 0,
                'matchLength': 1,
                'lineText': 'fixture',
              },
            ],
        ),
        'content oversized line text': _workspaceResponse(
          'workspace.file.content.search.result',
          contentPayload()
            ..['items'] = <Object?>[
              <String, Object?>{
                'path': 'src/index.ts',
                'line': 1,
                'column': 1,
                'matchStart': 0,
                'matchLength': 1,
                'lineText': 'x' * 4097,
              },
            ],
        ),
        'content oversized items': _workspaceResponse(
          'workspace.file.content.search.result',
          contentPayload()
            ..['items'] = List<Object?>.generate(
              201,
              (_) => <String, Object?>{
                'path': 'src/index.ts',
                'line': 1,
                'column': 1,
                'matchStart': 0,
                'matchLength': 1,
                'lineText': '',
              },
            ),
        ),
        'content nullable truncation flag': _workspaceResponse(
          'workspace.file.content.search.result',
          contentPayload()..['isTruncated'] = null,
        ),
      };
      for (final entry in invalid.entries) {
        expect(
          () => validateProtocolFixture('response', entry.value),
          throwsA(isA<ProtocolValidationException>()),
          reason: entry.key,
        );
      }

      for (final type in const <String>[
        'workspace.file.search.result',
        'workspace.file.content.search.result',
      ]) {
        for (final token in <Object?>['', 'p' * 257, 1]) {
          final payload = type == 'workspace.file.search.result'
              ? filenamePayload()
              : contentPayload();
          payload['nextPageToken'] = token;
          expect(
            () => validateProtocolFixture(
              'response',
              _workspaceResponse(type, payload),
            ),
            throwsA(isA<ProtocolValidationException>()),
            reason: '$type page token $token',
          );
        }
      }
    },
  );

  test('file metadata event and response share the complete TS validator', () {
    for (final envelope in <Map<String, Object?>>[
      _metadataResponse(_fileMetadata()),
      _metadataEvent(_fileMetadata()),
    ]) {
      expect(
        validateProtocolFixture(
          envelope.containsKey('eventId') ? 'event' : 'response',
          envelope,
        ),
        envelope.containsKey('eventId')
            ? isA<ProtocolEvent>()
            : isA<ProtocolResponse>(),
      );
    }

    final minimal = _fileMetadata()
      ..remove('sha256')
      ..remove('languageHint');
    expect(
      validateProtocolFixture('response', _metadataResponse(minimal)),
      isA<ProtocolResponse>(),
    );
  });

  test(
    'file metadata event and response reject the same nested invalid shapes',
    () {
      final invalidFiles = <String, Map<String, Object?>>{
        'private field': _fileMetadata()..['private'] = true,
        'missing isBinary': _fileMetadata()..remove('isBinary'),
        'oversized file': _fileMetadata()..['size'] = 26214401,
        'nullable digest': _fileMetadata()..['sha256'] = null,
        'nullable language': _fileMetadata()..['languageHint'] = null,
        'invalid path': _fileMetadata()..['path'] = '../private',
        'invalid revision': _fileMetadata()..['revision'] = '42',
        'missing lastReadAt': _fileMetadata()..remove('lastReadAt'),
      };
      for (final entry in invalidFiles.entries) {
        for (final envelope in <Map<String, Object?>>[
          _metadataResponse(Map<String, Object?>.from(entry.value)),
          _metadataEvent(Map<String, Object?>.from(entry.value)),
        ]) {
          expect(
            () => validateProtocolFixture(
              envelope.containsKey('eventId') ? 'event' : 'response',
              envelope,
            ),
            throwsA(isA<ProtocolValidationException>()),
            reason:
                '${envelope.containsKey('eventId') ? 'event' : 'response'} ${entry.key}',
          );
        }
      }
      final invalidEnvelopes = <String, Map<String, Object?>>{
        'private response payload': _workspaceResponse(
          'workspace.file.metadata.result',
          <String, Object?>{
            'workspaceId': '44444444-4444-4444-8444-444444444444',
            'file': _fileMetadata(),
            'private': true,
          },
        ),
        'private event payload':
            _workspaceEvent('workspace.file.metadata', <String, Object?>{
              'workspaceId': '44444444-4444-4444-8444-444444444444',
              'file': _fileMetadata(),
              'capability': 'files.v1',
              'private': true,
            }),
        'nullable previous revision':
            _workspaceEvent('workspace.file.metadata', <String, Object?>{
              'workspaceId': '44444444-4444-4444-8444-444444444444',
              'file': _fileMetadata(),
              'previousRevision': null,
              'capability': 'files.v1',
            }),
        'missing event capability':
            _workspaceEvent('workspace.file.metadata', <String, Object?>{
              'workspaceId': '44444444-4444-4444-8444-444444444444',
              'file': _fileMetadata(),
            }),
      };
      for (final entry in invalidEnvelopes.entries) {
        expect(
          () => validateProtocolFixture(
            entry.value.containsKey('eventId') ? 'event' : 'response',
            entry.value,
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: entry.key,
        );
      }
    },
  );

  test('file read results validate full bounds and truncation shape', () {
    final boundary = _fileReadResult()
      ..['content'] = 'x' * 524288
      ..['isTruncated'] = true
      ..['truncation'] = <String, Object?>{
        'retainedBytes': 524288,
        'totalBytes': 600000,
        'isTruncated': true,
        'digest':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      };
    expect(
      validateProtocolFixture('response', _fileReadResponse(boundary)),
      isA<ProtocolResponse>(),
    );
    expect(
      validateProtocolFixture(
        'response',
        _fileReadResponse(_fileReadResult()..['content'] = ''),
      ),
      isA<ProtocolResponse>(),
    );
  });

  test(
    'file read results reject private, missing, oversized, and nullable fields',
    () {
      final invalidResults = <String, Map<String, Object?>>{
        'private result': _fileReadResult()..['private'] = true,
        'missing encoding': _fileReadResult()..remove('encoding'),
        'oversized content': _fileReadResult()..['content'] = 'x' * 524289,
        'zero range start': _fileReadResult()..['rangeStart'] = 0,
        'negative total lines': _fileReadResult()..['totalLines'] = -1,
        'wrong encoding': _fileReadResult()..['encoding'] = 'utf-16',
        'nullable truncation': _fileReadResult()..['truncation'] = null,
        'private truncation': _fileReadResult()
          ..['truncation'] = <String, Object?>{
            'retainedBytes': 1,
            'totalBytes': 2,
            'isTruncated': true,
            'private': true,
          },
        'missing modification time': _fileReadResult()
          ..remove('lastModifiedAt'),
      };
      for (final entry in invalidResults.entries) {
        expect(
          () => validateProtocolFixture(
            'response',
            _fileReadResponse(entry.value),
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: entry.key,
        );
      }

      final privatePayload = <String, Object?>{
        'workspaceId': '44444444-4444-4444-8444-444444444444',
        'result': _fileReadResult(),
        'private': true,
      };
      expect(
        () => validateProtocolFixture(
          'response',
          _workspaceResponse('workspace.file.read.result', privatePayload),
        ),
        throwsA(isA<ProtocolValidationException>()),
      );
    },
  );

  test('workspace stale and unavailable events match closed TS shapes', () {
    Map<String, Object?> stale() => <String, Object?>{
      'workspaceId': '44444444-4444-4444-8444-444444444444',
      'path': 'src/index.ts',
      'previousRevision': 'file-r1',
      'currentRevision': 'file-r2',
      'modifiedAt': '2026-07-15T04:20:00.000Z',
      'capability': 'files.v1',
    };
    Map<String, Object?> unavailable() => <String, Object?>{
      'workspaceId': '44444444-4444-4444-8444-444444444444',
      'capability': 'files.v1',
      'status': <String, Object?>{
        'state': 'unavailable',
        'reason': 'File browser unavailable.',
        'remediation': 'Refresh the workspace.',
        'source': 'workspace-index',
        'revision': 'file-r2',
        'lastRefreshedAt': '2026-07-15T04:20:00.000Z',
      },
    };

    expect(
      validateProtocolFixture(
        'event',
        _workspaceEvent('workspace.file.stale', stale()),
      ),
      isA<ProtocolEvent>(),
    );
    expect(
      validateProtocolFixture(
        'event',
        _workspaceEvent('workspace.file.unavailable', unavailable()),
      ),
      isA<ProtocolEvent>(),
    );

    final invalid = <String, Map<String, Object?>>{
      'stale private root': _workspaceEvent(
        'workspace.file.stale',
        stale()..['private'] = true,
      ),
      'stale missing revision': _workspaceEvent(
        'workspace.file.stale',
        stale()..remove('currentRevision'),
      ),
      'stale nullable revision': _workspaceEvent(
        'workspace.file.stale',
        stale()..['previousRevision'] = null,
      ),
      'stale invalid path': _workspaceEvent(
        'workspace.file.stale',
        stale()..['path'] = '../private',
      ),
      'stale wrong capability': _workspaceEvent(
        'workspace.file.stale',
        stale()..['capability'] = 'contexts.v1',
      ),
      'unavailable private root': _workspaceEvent(
        'workspace.file.unavailable',
        unavailable()..['private'] = true,
      ),
      'unavailable missing status': _workspaceEvent(
        'workspace.file.unavailable',
        unavailable()..remove('status'),
      ),
      'unavailable nullable status': _workspaceEvent(
        'workspace.file.unavailable',
        unavailable()..['status'] = null,
      ),
      'unavailable private status': _workspaceEvent(
        'workspace.file.unavailable',
        unavailable()
          ..['status'] = <String, Object?>{
            'state': 'unavailable',
            'reason': 'unavailable',
            'remediation': 'refresh',
            'private': true,
          },
      ),
      'unavailable missing explanation': _workspaceEvent(
        'workspace.file.unavailable',
        unavailable()..['status'] = <String, Object?>{'state': 'unavailable'},
      ),
    };
    for (final entry in invalid.entries) {
      expect(
        () => validateProtocolFixture('event', entry.value),
        throwsA(isA<ProtocolValidationException>()),
        reason: entry.key,
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

  test(
    'context snapshots accept TS partial and full payloads in event and response',
    () {
      for (final full in const <bool>[false, true]) {
        expect(
          validateProtocolFixture(
            'event',
            _contextSnapshotEvent(_contextSnapshotPayload(full: full)),
          ),
          isA<ProtocolEvent>(),
          reason: 'event full=$full',
        );
        expect(
          validateProtocolFixture(
            'response',
            _contextSnapshotResult(_contextSnapshotPayload(full: full)),
          ),
          isA<ProtocolResponse>(),
          reason: 'response full=$full',
        );
      }

      final unavailable = <String, Object?>{
        'sessionId': '33333333-3333-4333-8333-333333333333',
        'capability': 'contexts.v1',
        'status': <String, Object?>{
          'state': 'unavailable',
          'reason': 'Context inspector is unavailable.',
          'remediation': 'Refresh the session context.',
          'source': 'session-bridge',
          'revision': 'context-r1',
          'lastRefreshedAt': '2026-07-15T04:20:00.000Z',
        },
      };
      expect(
        validateProtocolFixture('event', _contextUnavailableEvent(unavailable)),
        isA<ProtocolEvent>(),
      );
    },
  );

  test(
    'context snapshot event and response reject the same R4 invalid shapes',
    () {
      Map<String, Object?> withToken(Object value) {
        final payload = _contextSnapshotPayload(full: true);
        (payload['tokenUsage']! as Map<String, Object?>)['inputTokens'] = value;
        return payload;
      }

      Map<String, Object?> withUsagePercent(Object? value) {
        final payload = _contextSnapshotPayload(full: true);
        (payload['tokenUsage']! as Map<String, Object?>)['usagePercent'] =
            value;
        return payload;
      }

      Map<String, Object?> withRange(Object? range) {
        final payload = _contextSnapshotPayload(full: true);
        final pinned =
            (payload['pinnedFiles']! as List<Object?>).first
                as Map<String, Object?>;
        pinned['ranges'] = <Object?>[range];
        return payload;
      }

      Map<String, Object?> withSource(Map<String, Object?> changes) {
        final payload = _contextSnapshotPayload(full: true);
        final source =
            (payload['sources']! as List<Object?>).first
                as Map<String, Object?>;
        source.addAll(changes);
        return payload;
      }

      Map<String, Object?> withCapability(Map<String, Object?> capability) {
        final payload = _contextSnapshotPayload();
        payload['capability'] = capability;
        return payload;
      }

      final invalid = <String, Map<String, Object?>>{
        'private root field': _contextSnapshotPayload(full: true)
          ..['private'] = 'hidden',
        'missing revision': _contextSnapshotPayload()..remove('revision'),
        'missing freshness': _contextSnapshotPayload()
          ..remove('lastRefreshedAt'),
        'token has 17 digits': withToken('99999999999999999'),
        'token uses exponent': withToken('1e6'),
        'usagePercent string': withUsagePercent('0.5'),
        'usagePercent out of range': withUsagePercent(1.01),
        'usagePercent explicit null': withUsagePercent(null),
        'range is reversed': withRange(<String, Object?>{
          'startLine': 3,
          'endLine': 2,
        }),
        'range private field': withRange(<String, Object?>{
          'startLine': 1,
          'endLine': 2,
          'private': true,
        }),
        'range explicit null': _contextSnapshotPayload(full: true)
          ..['pinnedFiles'] = <Object?>[
            <String, Object?>{
              'path': 'src/index.ts',
              'pinnedAt': '2026-07-15T04:20:00.000Z',
              'ranges': null,
              'revision': 'file-r1',
            },
          ],
        'source id empty': withSource(<String, Object?>{'sourceId': ''}),
        'source private field': withSource(<String, Object?>{'private': true}),
        'source capability state invalid': withSource(<String, Object?>{
          'capability': <String, Object?>{'state': 'unknown'},
        }),
        'root capability private field': withCapability(<String, Object?>{
          'state': 'available',
          'private': true,
        }),
        'root capability unavailable missing explanation': withCapability(
          <String, Object?>{'state': 'unavailable'},
        ),
        'model explicit null': _contextSnapshotPayload()..['model'] = null,
        'instructions explicit null': _contextSnapshotPayload()
          ..['instructions'] = null,
        'token usage explicit null': _contextSnapshotPayload()
          ..['tokenUsage'] = null,
        'sources explicit null': _contextSnapshotPayload()..['sources'] = null,
      };

      for (final invalidEntry in invalid.entries) {
        expect(
          () => validateProtocolFixture(
            'event',
            _contextSnapshotEvent(invalidEntry.value),
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: 'event ${invalidEntry.key}',
        );
        expect(
          () => validateProtocolFixture(
            'response',
            _contextSnapshotResult(invalidEntry.value),
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: 'response ${invalidEntry.key}',
        );
      }
    },
  );

  test(
    'context unavailable rejects private, missing, and invalid capability status fields',
    () {
      Map<String, Object?> unavailable() => <String, Object?>{
        'sessionId': '33333333-3333-4333-8333-333333333333',
        'capability': 'contexts.v1',
        'status': <String, Object?>{
          'state': 'unavailable',
          'reason': 'Context inspector is unavailable.',
          'remediation': 'Refresh the session context.',
        },
      };

      final invalid = <String, Map<String, Object?>>{
        'private root field': unavailable()..['private'] = true,
        'missing status': unavailable()..remove('status'),
        'wrong capability': unavailable()..['capability'] = 'files.v1',
        'status private field': unavailable()
          ..['status'] = <String, Object?>{
            'state': 'unavailable',
            'reason': 'unavailable',
            'remediation': 'refresh',
            'private': true,
          },
        'status explicit null': unavailable()..['status'] = null,
      };
      for (final invalidEntry in invalid.entries) {
        expect(
          () => validateProtocolFixture(
            'event',
            _contextUnavailableEvent(invalidEntry.value),
          ),
          throwsA(isA<ProtocolValidationException>()),
          reason: invalidEntry.key,
        );
      }
    },
  );

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

  test('prompt.submit accepts a valid ranged file reference', () {
    expect(
      validateProtocolFixture(
        'command',
        _promptSubmitWithFileRefs(<Object?>[_validFileRef()]),
      ),
      isA<ProtocolCommand>(),
    );
  });

  test('prompt.submit file references reject private fields and nulls', () {
    final privateRef = _validFileRef()..['private'] = 'hidden';
    for (final invalid in <Object?>[
      <Object?>[privateRef],
      null,
      <Object?>[_validFileRef()..['ranges'] = null],
      <Object?>[_validFileRef()..['digest'] = null],
    ]) {
      expect(
        () => validateProtocolFixture(
          'command',
          _promptSubmitWithFileRefs(invalid),
        ),
        throwsA(isA<ProtocolValidationException>()),
      );
    }
  });

  test('prompt.submit file references reject oversized and invalid ranges', () {
    final tooManyRanges = List<Object?>.generate(
      17,
      (_) => <String, Object?>{'startLine': 1, 'endLine': 1},
    );
    final invalidRefs = <String, Map<String, Object?>>{
      'path': _validFileRef()..['path'] = List<String>.filled(1025, 'x').join(),
      'revision': _validFileRef()
        ..['revision'] = 'r${List<String>.filled(128, 'x').join()}',
      'range count': _validFileRef()..['ranges'] = tooManyRanges,
      'range start': _validFileRef()
        ..['ranges'] = <Object?>[
          <String, Object?>{'startLine': 0, 'endLine': 1},
        ],
      'range order': _validFileRef()
        ..['ranges'] = <Object?>[
          <String, Object?>{'startLine': 2, 'endLine': 1},
        ],
      'range private field': _validFileRef()
        ..['ranges'] = <Object?>[
          <String, Object?>{'startLine': 1, 'endLine': 1, 'private': true},
        ],
      'range label': _validFileRef()
        ..['ranges'] = <Object?>[
          <String, Object?>{
            'startLine': 1,
            'endLine': 1,
            'label': List<String>.filled(65, 'x').join(),
          },
        ],
      'missing digest': _validFileRef()..remove('digest'),
      'short digest': _validFileRef()
        ..['digest'] = List<String>.filled(63, 'a').join(),
      'uppercase digest': _validFileRef()
        ..['digest'] = List<String>.filled(64, 'A').join(),
    };
    for (final invalid in invalidRefs.entries) {
      expect(
        () => validateProtocolFixture(
          'command',
          _promptSubmitWithFileRefs(<Object?>[invalid.value]),
        ),
        throwsA(isA<ProtocolValidationException>()),
        reason: invalid.key,
      );
    }
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
