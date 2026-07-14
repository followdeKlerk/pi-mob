import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/attachments.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/domain/session_tree.dart';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const connectionId = '44444444-4444-4444-8444-444444444444';
const leaseId = '55555555-5555-4555-8555-555555555555';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('manual endpoint accepts only a clean HTTPS origin', () {
    expect(
      normalizeHttpsEndpoint('host.example').toString(),
      'https://host.example',
    );
    expect(
      () => normalizeHttpsEndpoint('http://host.example'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://host.example/path'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://host.example?token=x'),
      throwsFormatException,
    );
    expect(
      () => normalizeHttpsEndpoint('https://user@host.example'),
      throwsFormatException,
    );
  });

  late AppDatabase database;
  late FakeBridgeTransport transport;
  late ConnectionCoordinator coordinator;

  setUp(() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    transport = FakeBridgeTransport();
    coordinator = ConnectionCoordinator(
      transport: transport,
      database: database,
    );
  });

  tearDown(() async {
    coordinator.dispose();
    await database.close();
  });

  test(
    'hello, mandatory host plus one session, ordered event and cursor ack',
    () async {
      await coordinator.initialize(autoConnect: false);
      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.single;
      expect(socket.sent.single['type'], 'hello');

      socket.server(helloAccepted());
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'subscription.set'),
      );
      var subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId']);

      socket.server(
        response('subscription.accepted', {
          'streams': [
            {'streamId': 'host:$hostId', 'mode': 'current'},
          ],
        }),
      );
      socket.server(
        response('stream.sync.complete', {
          'streamId': 'host:$hostId',
          'currentCursor': '0',
          'mode': 'current',
        }, requestId: null),
      );
      await eventually(() => coordinator.isReady);

      socket.server(
        event(
          type: 'session.summary',
          streamId: 'host:$hostId',
          cursor: '1',
          eventId: '66666666-6666-4666-8666-666666666666',
          payload: {
            'sessionId': sessionId,
            'workspaceId': workspaceId,
            'name': 'Fixture session',
            'runtimeState': 'idle',
            'queueCount': 0,
          },
        ),
      );
      await eventually(
        () =>
            socket.sent
                .where((message) => message['type'] == 'subscription.set')
                .length >=
            2,
      );
      subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId', 'session:$sessionId']);
      final streams = (subscription['payload'] as Map)['streams'] as List;
      expect((streams[1] as Map)['detail'], 'full');

      socket.server(
        response('subscription.accepted', {
          'streams': [
            {'streamId': 'host:$hostId', 'mode': 'current'},
            {'streamId': 'session:$sessionId', 'mode': 'current'},
          ],
        }),
      );
      socket.server(
        response('stream.sync.complete', {
          'streamId': 'host:$hostId',
          'currentCursor': '1',
          'mode': 'current',
        }, requestId: null),
      );
      socket.server(
        response('stream.sync.complete', {
          'streamId': 'session:$sessionId',
          'currentCursor': '0',
          'mode': 'current',
        }, requestId: null),
      );
      await eventually(() => coordinator.isReady);

      socket.server(
        event(
          type: 'controller.state',
          streamId: 'session:$sessionId',
          cursor: '1',
          eventId: '77777777-7777-4777-8777-777777777777',
          payload: {
            'scope': 'session',
            'sessionId': sessionId,
            'mode': 'controller',
            'leaseId': leaseId,
          },
        ),
      );
      await eventually(() => coordinator.leaseId == leaseId);
      socket.server(
        event(
          type: 'turn.started',
          streamId: 'session:$sessionId',
          cursor: '2',
          eventId: '12121212-1212-4212-8212-121212121212',
          payload: {'sessionId': sessionId},
        ),
      );
      socket.server(
        event(
          type: 'turn.settled',
          streamId: 'session:$sessionId',
          cursor: '3',
          eventId: '13131313-1313-4313-8313-131313131313',
          payload: {'sessionId': sessionId},
        ),
      );
      await eventually(
        () =>
            coordinator
                .streams['session:$sessionId']
                ?.lastContiguousCursor
                .value ==
            '3',
      );
      expect(coordinator.sessions.single.runtimeState, 'idle');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect((await database.allSessions()).single.runtimeState, 'idle');

      await Future<void>.delayed(const Duration(milliseconds: 1100));
      await eventually(
        () => socket.sent.any((message) => message['type'] == 'cursor.ack'),
      );
      final ack = socket.sent.lastWhere(
        (message) => message['type'] == 'cursor.ack',
      );
      expect(
        (ack['payload'] as Map)['cursors'],
        containsPair('session:$sessionId', '3'),
      );
    },
  );

  test('multipart snapshot is assembled and committed atomically', () async {
    await coordinator.initialize(autoConnect: false);
    await coordinator.connect('https://fixture.test');
    final socket = transport.sockets.single;
    socket.server(helloAccepted());
    await eventually(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    );
    socket.server(
      response('subscription.accepted', {
        'streams': [
          {'streamId': 'host:$hostId', 'mode': 'snapshot_required'},
        ],
      }),
    );
    const snapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    socket.server(
      response('stream.snapshot.begin', {
        'snapshotId': snapshotId,
        'streamId': 'host:$hostId',
        'baselineCursor': '7',
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.part', {
        'snapshotId': snapshotId,
        'part': 0,
        'items': [
          {'index': 0, 'json': '{"sessions":['},
        ],
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.part', {
        'snapshotId': snapshotId,
        'part': 1,
        'items': [
          {
            'index': 1,
            'json':
                '{"sessionId":"$sessionId","name":"From snapshot","runtimeState":"idle","queueCount":0}]}',
          },
        ],
      }, requestId: null),
    );
    socket.server(
      response('stream.snapshot.end', {
        'snapshotId': snapshotId,
        'partCount': 2,
      }, requestId: null),
    );
    socket.server(
      response('stream.sync.complete', {
        'streamId': 'host:$hostId',
        'currentCursor': '7',
        'mode': 'snapshot_required',
      }, requestId: null),
    );

    await eventually(() => coordinator.isReady);
    expect(
      coordinator.streams['host:$hostId']!.lastContiguousCursor.value,
      '7',
    );
    expect(coordinator.sessions.single.name, 'From snapshot');
    final snapshots = await database.snapshotsForHost(hostId);
    expect(snapshots.single.baselineCursor, '7');
    expect(jsonDecode(snapshots.single.payloadJson), [
      {
        'sessions': [
          {
            'sessionId': sessionId,
            'name': 'From snapshot',
            'runtimeState': 'idle',
            'queueCount': 0,
          },
        ],
      },
    ]);
  });

  test(
    'pending exact payload reconciles with command.current and never auto-resends',
    () async {
      await makeReady(coordinator, transport);
      final first = transport.sockets.single;

      await coordinator.updateDraft('Implement exactly once');
      await coordinator.submitPrompt();
      final prompt = first.sent.lastWhere(
        (message) => message['type'] == 'prompt.submit',
      );
      final commandId = prompt['commandId'] as String;
      final exactPayload = Map<String, Object?>.from(prompt['payload'] as Map);
      final stored = await database.draft(hostId, sessionId);
      expect(stored!.pendingCommandId, commandId);
      expect(jsonDecode(stored.pendingPayloadJson!), exactPayload);
      expect(stored.draftText, 'Implement exactly once');

      // A fresh foreground connection must perform a read-only reconciliation.
      await coordinator.connect('https://fixture.test');
      final second = transport.sockets.last;
      socketHandshake(
        second,
        includeSession: true,
        hostCursor: '1',
        sessionCursor: '1',
      );
      await eventually(
        () =>
            second.sent.any((message) => message['type'] == 'command.current'),
      );
      expect(
        second.sent.where((message) => message['type'] == 'prompt.submit'),
        isEmpty,
      );
      final current = second.sent.lastWhere(
        (message) => message['type'] == 'command.current',
      );
      expect((current['payload'] as Map)['commandId'], commandId);

      second.server(
        response('command.current.result', {
          'commandId': commandId,
          'state': 'accepted',
        }),
      );
      await eventually(() => coordinator.pendingCommandId == null);
      expect(coordinator.draft, isEmpty);
      final settled = await database.draft(hostId, sessionId);
      expect(settled!.pendingCommandId, isNull);
      expect(settled.draftText, isEmpty);
    },
  );

  test(
    'process restart restores uncertain command and reconciles without send',
    () async {
      await makeReady(coordinator, transport);
      await coordinator.updateDraft('Survive process death');
      await coordinator.submitPrompt();
      final sent = transport.sockets.single.sent.lastWhere(
        (message) => message['type'] == 'prompt.submit',
      );
      final commandId = sent['commandId'] as String;

      coordinator.dispose();
      transport = FakeBridgeTransport();
      coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      expect(coordinator.draft, 'Survive process death');
      expect(coordinator.pendingCommandId, commandId);

      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.single;
      socketHandshake(
        socket,
        includeSession: true,
        hostCursor: '1',
        sessionCursor: '1',
      );
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'command.current'),
      );
      expect(
        socket.sent.where((message) => message['type'] == 'prompt.submit'),
        isEmpty,
      );
      socket.server(
        response('command.current.result', {
          'commandId': commandId,
          'state': 'accepted',
        }),
      );
      await eventually(() => coordinator.pendingCommandId == null);
      expect(coordinator.draft, isEmpty);
    },
  );

  test(
    'host generation reset quarantines command and keeps draft text',
    () async {
      await makeReady(coordinator, transport);
      await coordinator.updateDraft('Keep across restore');
      await coordinator.submitPrompt();

      await coordinator.connect('https://fixture.test');
      final socket = transport.sockets.last;
      socket.server(helloAccepted(generation: '2'));
      await eventually(
        () =>
            socket.sent.any((message) => message['type'] == 'subscription.set'),
      );
      final subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(streamIds(subscription), ['host:$hostId']);
      final stream =
          ((subscription['payload'] as Map)['streams'] as List).single as Map;
      expect(stream.containsKey('afterCursor'), isFalse);
      expect(coordinator.selectedSessionId, isNull);
      expect(coordinator.pendingCommandId, isNull);
      expect(coordinator.draft, 'Keep across restore');
      expect(coordinator.rawEvents, isEmpty);
      final quarantined = await database.draft(hostId, sessionId);
      expect(quarantined?.draftText, 'Keep across restore');
      expect(quarantined?.pendingCommandId, isNull);
      expect(quarantined?.pendingPayloadJson, isNull);
    },
  );

  test(
    'M6 failure states and truncation stay visible without automatic retry',
    () async {
      await makeReady(coordinator, transport);
      final socket = transport.sockets.single;
      await coordinator.updateDraft('Do not repeat');
      await coordinator.submitPrompt();
      final promptCount = socket.sent
          .where((message) => message['type'] == 'prompt.submit')
          .length;
      final commandId =
          socket.sent.lastWhere(
                (message) => message['type'] == 'prompt.submit',
              )['commandId']
              as String;

      socket.server(
        event(
          type: 'command.state',
          streamId: 'session:$sessionId',
          cursor: '2',
          eventId: '14141414-1414-4414-8414-141414141414',
          payload: {
            'sessionId': sessionId,
            'commandId': commandId,
            'commandType': 'prompt.submit',
            'state': 'indeterminate',
            'errorCode': null,
          },
        ),
      );
      socket.server(
        event(
          type: 'turn.indeterminate',
          streamId: 'session:$sessionId',
          cursor: '3',
          eventId: '15151515-1515-4515-8515-151515151515',
          payload: {'sessionId': sessionId, 'reason': 'pi_exit'},
        ),
      );
      socket.server(
        event(
          type: 'tool.output',
          streamId: 'session:$sessionId',
          cursor: '4',
          eventId: '16161616-1616-4616-8616-161616161616',
          payload: {
            'sessionId': sessionId,
            'toolCallId': '17171717-1717-4717-8717-171717171717',
            'retainedBytes': 5242880,
            'totalBytes': 6291456,
            'isTruncated': true,
            'digest':
                'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
        ),
      );
      await eventually(() => coordinator.toolOutputNotices.isNotEmpty);
      expect(coordinator.sessions.single.runtimeState, 'indeterminate');
      expect(coordinator.pendingState, 'indeterminate');
      expect(coordinator.draft, 'Do not repeat');
      expect(coordinator.toolOutputNotices.single.totalBytes, 6291456);
      expect(coordinator.canRetrySession, isTrue);
      await coordinator.retrySession();
      expect(
        socket.sent.any((message) => message['type'] == 'session.activate'),
        isTrue,
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(
        socket.sent
            .where((message) => message['type'] == 'prompt.submit')
            .length,
        promptCount,
      );
    },
  );

  test('receipt below accepted preserves pending command and draft', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    await coordinator.updateDraft('Keep me');
    await coordinator.submitPrompt();
    final prompt = socket.sent.lastWhere(
      (message) => message['type'] == 'prompt.submit',
    );

    socket.server(
      response('command.receipt', {
        'state': 'received',
        'duplicate': false,
      }, commandId: prompt['commandId'] as String),
    );
    await eventually(() => coordinator.pendingState == 'received');
    expect(coordinator.pendingCommandId, isNotNull);
    expect(coordinator.draft, 'Keep me');

    socket.server(
      response('command.current.result', {
        'commandId': prompt['commandId'] as String,
        'state': 'indeterminate',
      }),
    );
    await eventually(() => coordinator.pendingState == 'indeterminate');
    expect(coordinator.pendingCommandId, isNotNull);
    expect(coordinator.draft, 'Keep me');

    socket.server(
      response('command.receipt', {
        'state': 'accepted',
        'duplicate': false,
      }, commandId: prompt['commandId'] as String),
    );
    await eventually(() => coordinator.pendingCommandId == null);
    expect(coordinator.draft, isEmpty);
  });

  test('running session accepts steer prompt over the wire', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    await coordinator.setSelectedDeliveryMode(DeliveryMode.steer);
    socket.server(
      event(
        type: 'turn.started',
        streamId: 'session:$sessionId',
        cursor: '2',
        eventId: '20202020-2020-4202-8202-202020202020',
        payload: {
          'sessionId': sessionId,
          'commandId': 'previous-cmd',
          'deliveryMode': 'immediate',
        },
      ),
    );
    await eventually(() => coordinator.selectedRuntimeState == 'running');
    await coordinator.updateDraft('Steer me');
    expect(coordinator.canSend, isTrue);
    expect(coordinator.composerDisabledReason, isNull);
    await coordinator.submitPrompt();
    final prompt = socket.sent.lastWhere(
      (message) => message['type'] == 'prompt.submit',
    );
    expect(prompt['payload'], containsPair('deliveryMode', 'steer'));
    expect(prompt['payload'], containsPair('message', 'Steer me'));
    final stored = await database.draft(hostId, sessionId);
    expect(stored!.selectedDeliveryMode, 'steer');
  });

  test('running session queues follow-up prompt over the wire', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    socket.server(
      event(
        type: 'turn.started',
        streamId: 'session:$sessionId',
        cursor: '2',
        eventId: '21212121-2121-4212-8212-212121212121',
        payload: {
          'sessionId': sessionId,
          'commandId': 'previous-cmd',
          'deliveryMode': 'immediate',
        },
      ),
    );
    await eventually(() => coordinator.selectedRuntimeState == 'running');
    await coordinator.setSelectedDeliveryMode(DeliveryMode.followUp);
    await coordinator.updateDraft('Run this after');
    await coordinator.submitPrompt();
    final prompt = socket.sent.lastWhere(
      (message) => message['type'] == 'prompt.submit',
    );
    expect(prompt['payload'], containsPair('deliveryMode', 'follow_up'));
    final stored = await database.draft(hostId, sessionId);
    expect(stored!.selectedDeliveryMode, 'follow_up');
  });

  test('running session blocks default immediate composer', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    socket.server(
      event(
        type: 'turn.started',
        streamId: 'session:$sessionId',
        cursor: '2',
        eventId: '22222222-2222-4222-8222-222222222222',
        payload: {
          'sessionId': sessionId,
          'commandId': 'previous-cmd',
          'deliveryMode': 'immediate',
        },
      ),
    );
    await eventually(() => coordinator.selectedRuntimeState == 'running');
    await coordinator.updateDraft('Cannot fire immediately');
    expect(coordinator.selectedDeliveryMode, DeliveryMode.immediate);
    expect(coordinator.canSend, isFalse);
    expect(
      coordinator.composerDisabledReason,
      contains('Steer or Queue follow-up'),
    );

    final sentBefore = socket.sent
        .where((message) => message['type'] == 'prompt.submit')
        .length;
    await coordinator.submitPrompt();
    expect(
      socket.sent.where((message) => message['type'] == 'prompt.submit').length,
      sentBefore,
    );
    expect(coordinator.pendingCommandId, isNull);
  });

  test(
    'M10 model context retry compaction controls reconcile and gate',
    () async {
      await makeReady(coordinator, transport);
      final socket = transport.sockets.single;
      await coordinator.requestModels();
      final request = socket.sent.lastWhere(
        (message) => message['type'] == 'model.list',
      );
      socket.server(
        response('model.list.result', {
          'items': [
            {
              'id': 'anthropic/sonnet',
              'label': 'Sonnet',
              'provider': 'anthropic',
            },
          ],
        }, requestId: request['requestId'] as String),
      );
      socket.server(
        event(
          type: 'model.state',
          streamId: 'session:$sessionId',
          cursor: '2',
          eventId: '30303030-3030-4030-8030-303030303030',
          payload: {
            'sessionId': sessionId,
            'modelId': 'anthropic/sonnet',
            'thinkingLevel': 'medium',
            'steeringEnabled': true,
            'followUpEnabled': false,
          },
        ),
      );
      socket.server(
        event(
          type: 'context.state',
          streamId: 'session:$sessionId',
          cursor: '3',
          eventId: '31313131-3131-4131-8131-313131313131',
          payload: {
            'sessionId': sessionId,
            'inputTokens': 10,
            'outputTokens': 5,
            'contextTokens': 15,
            'contextWindow': 1000,
            'cost': 0.001,
          },
        ),
      );
      socket.server(
        event(
          type: 'retry.state',
          streamId: 'session:$sessionId',
          cursor: '4',
          eventId: '32323232-3232-4232-8232-323232323232',
          payload: {
            'sessionId': sessionId,
            'state': 'waiting',
            'attempt': 1,
            'maxAttempts': 3,
            'delayMs': 5000,
          },
        ),
      );
      socket.server(
        event(
          type: 'compaction.state',
          streamId: 'session:$sessionId',
          cursor: '5',
          eventId: '33333333-3333-4333-8333-333333333334',
          payload: {'sessionId': sessionId, 'state': 'running'},
        ),
      );
      await eventually(() => coordinator.selectedControls?.contextTokens == 15);
      expect(coordinator.configuredModels.single.id, 'anthropic/sonnet');
      expect(coordinator.selectedControls?.retryAttempt, 1);
      expect(coordinator.selectedControls?.compactionPhase.name, 'running');

      await coordinator.setModel('anthropic/sonnet');
      await coordinator.setThinking('high');
      await coordinator.setAutoRetry(true);
      await coordinator.abortRetry();
      await coordinator.compactNow();
      await coordinator.setAutoCompaction(true);
      await coordinator.setSteeringEnabled(true);
      await coordinator.setFollowUpEnabled(false);
      expect(
        socket.sent.map((message) => message['type']),
        containsAll(<String>[
          'model.set',
          'thinking.set',
          'retry.auto.set',
          'retry.abort',
          'compaction.start',
          'compaction.auto.set',
          'steering_mode.set',
          'follow_up_mode.set',
        ]),
      );

      socket.server(
        event(
          type: 'turn.started',
          streamId: 'session:$sessionId',
          cursor: '6',
          eventId: '34343434-3434-4434-8434-343434343434',
          payload: {'sessionId': sessionId, 'turnIndex': 1},
        ),
      );
      await eventually(() => coordinator.selectedRuntimeState == 'running');
      await expectLater(coordinator.setModel('x'), throwsStateError);
    },
  );

  test('history pages merge older events with stable deduplication', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;

    await coordinator.loadOlderHistory(sessionId, pageSize: 2);
    final firstRequest = socket.sent.lastWhere(
      (message) => message['type'] == 'session.history.page',
    );
    expect(firstRequest['payload'], containsPair('pageToken', null));
    socket.server(
      response(
        'session.history.page.result',
        {
          'snapshotRevision': '4',
          'nextPageToken': 'opaque-next',
          'items': [
            {
              'eventId': 'history-3',
              'streamId': 'session:$sessionId',
              'cursor': '3',
              'type': 'assistant.delta',
              'payload': {'contentBlockId': 'a', 'text': 'three'},
              'createdAt': 1,
            },
            {
              'eventId': 'history-4',
              'streamId': 'session:$sessionId',
              'cursor': '4',
              'type': 'assistant.completed',
              'payload': {'contentBlockId': 'a'},
              'createdAt': 2,
            },
          ],
        },
        requestId: firstRequest['requestId'] as String,
      ),
    );
    await eventually(() => coordinator.transcriptEvents(sessionId).length == 2);
    expect(coordinator.historyFor(sessionId).snapshotRevision, '4');
    expect(coordinator.hasOlderHistory(sessionId), isTrue);

    await coordinator.loadOlderHistory(sessionId, pageSize: 2);
    final secondRequest = socket.sent.lastWhere(
      (message) => message['type'] == 'session.history.page',
    );
    expect(secondRequest['payload'], containsPair('pageToken', 'opaque-next'));
    socket.server(
      response(
        'session.history.page.result',
        {
          'snapshotRevision': '5',
          'items': [
            {
              'eventId': 'history-2',
              'streamId': 'session:$sessionId',
              'cursor': '2',
              'type': 'assistant.started',
              'payload': {'contentBlockId': 'a'},
              'createdAt': 0,
            },
            {
              'eventId': 'history-3',
              'streamId': 'session:$sessionId',
              'cursor': '3',
              'type': 'assistant.delta',
              'payload': {'contentBlockId': 'a', 'text': 'three'},
              'createdAt': 1,
            },
          ],
        },
        requestId: secondRequest['requestId'] as String,
      ),
    );
    await eventually(() => coordinator.transcriptEvents(sessionId).length == 3);
    expect(
      coordinator
          .transcriptEvents(sessionId)
          .map((event) => event.cursor.value),
      ['2', '3', '4'],
    );
    expect(coordinator.historyFor(sessionId).snapshotRevision, '5');
    expect(coordinator.hasOlderHistory(sessionId), isFalse);
  });

  test('idle session blocks steer and follow-up delivery modes', () async {
    await makeReady(coordinator, transport);
    // makeReady leaves the session in the idle state.
    expect(coordinator.selectedRuntimeState, 'idle');

    for (final mode in [DeliveryMode.steer, DeliveryMode.followUp]) {
      await coordinator.setSelectedDeliveryMode(mode);
      expect(
        coordinator.canSend,
        isFalse,
        reason: 'idle session must not allow $mode',
      );
      expect(coordinator.composerDisabledReason, isNotNull);
    }
  });

  test('read-only policy still allows composer submission', () async {
    await makeReady(coordinator, transport);
    final socket = transport.sockets.single;
    socket.server(
      event(
        type: 'session.summary',
        streamId: 'host:$hostId',
        cursor: '2',
        eventId: '23232323-2323-4232-8232-232323232323',
        payload: {
          'sessionId': sessionId,
          'name': 'Read-only',
          'runtimeState': 'idle',
          'queueCount': 0,
          'policyMode': 'read_only',
        },
      ),
    );
    await eventually(
      () => coordinator.activePolicyMode == SessionPolicyMode.readOnly,
    );
    await coordinator.updateDraft('Edit me but do not run tools');
    expect(coordinator.canSend, isTrue);
    expect(coordinator.composerDisabledReason, isNull);
    await coordinator.submitPrompt();
    final prompt = socket.sent.lastWhere(
      (message) => message['type'] == 'prompt.submit',
    );
    expect(prompt['payload'], containsPair('deliveryMode', 'immediate'));
    expect(
      prompt['payload'],
      containsPair('message', 'Edit me but do not run tools'),
    );
  });

  test(
    'M13 ready attachment IDs persist and enter prompt only on explicit send',
    () async {
      await makeReady(coordinator, transport);
      final socket = transport.sockets.single;
      final ref = AttachmentRef(
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        kind: AttachmentKind.imagePng,
        filename: 'clean.png',
        sizeBytes: 128,
        mimeType: 'image/png',
        status: AttachmentStatus.ready,
        createdAt: DateTime.utc(2026, 7, 13),
        expiresAt: DateTime.utc(2026, 7, 14),
        width: 1,
        height: 1,
      );
      await coordinator.addDraftAttachment(ref);
      expect(
        socket.sent.where((message) => message['type'] == 'prompt.submit'),
        isEmpty,
      );
      await coordinator.updateDraft('inspect image');
      await coordinator.submitPrompt();
      final prompt = socket.sent.lastWhere(
        (message) => message['type'] == 'prompt.submit',
      );
      expect(prompt['payload'], containsPair('attachmentIds', [ref.id]));
      expect(coordinator.draftAttachments.single.id, ref.id);
    },
  );

  test(
    'M12 lifecycle commands preserve drafts and require explicit purge confirmation',
    () async {
      await makeReady(coordinator, transport);
      final socket = transport.sockets.single;
      await coordinator.updateDraft('keep this draft');
      await coordinator.renameSession(sessionId, 'Renamed');
      await coordinator.forkSession(sessionId, 'entry-1');
      await coordinator.cloneSession(sessionId);
      await coordinator.deleteSession(sessionId);
      expect(coordinator.draft, 'keep this draft');
      expect(
        () => coordinator.purgeSession(sessionId, confirmed: false),
        throwsStateError,
      );
      await coordinator.purgeSession(sessionId, confirmed: true);
      final sentTypes = socket.sent.map((message) => message['type']).toList();
      expect(
        sentTypes,
        containsAll(<String>[
          'session.rename',
          'session.fork',
          'session.clone',
          'session.delete',
          'session.purge',
        ]),
      );
      final fork = socket.sent.lastWhere(
        (message) => message['type'] == 'session.fork',
      );
      expect(fork['payload'], containsPair('entryId', 'entry-1'));
    },
  );

  test(
    'M12 summary and soft removal update the durable tree projection',
    () async {
      await makeReady(coordinator, transport);
      final socket = transport.sockets.single;
      final firstCursor =
          (BigInt.parse(
                    coordinator
                        .streams['host:$hostId']!
                        .lastContiguousCursor
                        .value,
                  ) +
                  BigInt.one)
              .toString();
      socket.server(
        event(
          type: 'session.summary',
          streamId: 'host:$hostId',
          cursor: firstCursor,
          eventId: '24242424-2424-4242-8242-242424242424',
          payload: {
            'sessionId': '66666666-6666-4666-8666-666666666666',
            'name': 'Fork child',
            'workspaceId': workspaceId,
            'runtimeState': 'idle',
            'queueCount': 0,
            'parentSessionId': sessionId,
            'lineageType': 'branch',
            'lineageCreatedFrom': 'entry-1',
          },
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(
        coordinator.sessionTree['66666666-6666-4666-8666-666666666666'],
        isNotNull,
        reason:
            'host cursor ${coordinator.streams['host:$hostId']?.lastContiguousCursor.value}; phase ${coordinator.phase}; error ${coordinator.errorMessage}; raw ${coordinator.rawEvents.isEmpty ? 'none' : coordinator.rawEvents.last}',
      );
      expect(
        coordinator
            .sessionTree['66666666-6666-4666-8666-666666666666']!
            .forkOriginEntryId,
        'entry-1',
      );
      final secondCursor = (BigInt.parse(firstCursor) + BigInt.one).toString();
      socket.server(
        event(
          type: 'session.removed',
          streamId: 'host:$hostId',
          cursor: secondCursor,
          eventId: '25252525-2525-4252-8252-252525252525',
          payload: {
            'sessionId': '66666666-6666-4666-8666-666666666666',
            'deletionState': 'soft_deleted',
            'removedAt': '2026-07-14T00:00:00Z',
            'purgeAfter': '2026-07-21T00:00:00Z',
          },
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final deleted =
          coordinator.sessionTree['66666666-6666-4666-8666-666666666666'];
      expect(deleted?.lifecycle, SessionLifecycleState.softDeleted);
      expect(deleted?.canRestore, isTrue);
    },
  );
}

Future<void> makeReady(
  ConnectionCoordinator coordinator,
  FakeBridgeTransport transport,
) async {
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.sockets.single;
  socket.server(helloAccepted());
  await eventually(
    () => socket.sent.any((message) => message['type'] == 'subscription.set'),
  );
  socket.server(
    response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$hostId', 'mode': 'current'},
      ],
    }),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'host:$hostId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await eventually(() => coordinator.isReady);
  socket.server(
    event(
      type: 'session.summary',
      streamId: 'host:$hostId',
      cursor: '1',
      eventId: '88888888-8888-4888-8888-888888888888',
      payload: {
        'sessionId': sessionId,
        'workspaceId': workspaceId,
        'name': 'Fixture',
        'runtimeState': 'idle',
        'queueCount': 0,
      },
    ),
  );
  await eventually(
    () =>
        socket.sent
            .where((message) => message['type'] == 'subscription.set')
            .length >=
        2,
  );
  socket.server(
    response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$hostId', 'mode': 'current'},
        {'streamId': 'session:$sessionId', 'mode': 'current'},
      ],
    }),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'host:$hostId',
      'currentCursor': '1',
      'mode': 'current',
    }, requestId: null),
  );
  socket.server(
    response('stream.sync.complete', {
      'streamId': 'session:$sessionId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await eventually(() => coordinator.isReady);
  socket.server(
    event(
      type: 'controller.state',
      streamId: 'session:$sessionId',
      cursor: '1',
      eventId: '99999999-9999-4999-8999-999999999999',
      payload: {
        'scope': 'session',
        'sessionId': sessionId,
        'mode': 'controller',
        'leaseId': leaseId,
      },
    ),
  );
  await eventually(() => coordinator.leaseId == leaseId);
}

void socketHandshake(
  FakeBridgeSocket socket, {
  required bool includeSession,
  required String hostCursor,
  required String sessionCursor,
}) {
  socket.server(helloAccepted());
  unawaited(() async {
    await eventually(
      () => socket.sent.any((message) => message['type'] == 'subscription.set'),
    );
    socket.server(
      response('subscription.accepted', {
        'streams': [
          {'streamId': 'host:$hostId', 'mode': 'current'},
          if (includeSession)
            {'streamId': 'session:$sessionId', 'mode': 'current'},
        ],
      }),
    );
    socket.server(
      response('stream.sync.complete', {
        'streamId': 'host:$hostId',
        'currentCursor': hostCursor,
        'mode': 'current',
      }, requestId: null),
    );
    if (includeSession) {
      socket.server(
        response('stream.sync.complete', {
          'streamId': 'session:$sessionId',
          'currentCursor': sessionCursor,
          'mode': 'current',
        }, requestId: null),
      );
    }
  }());
}

List<String> streamIds(Map<String, Object?> subscription) =>
    ((subscription['payload'] as Map)['streams'] as List)
        .map((item) => (item as Map)['streamId'] as String)
        .toList();

Map<String, Object?> helloAccepted({String generation = '1'}) =>
    response('hello.accepted', {
      'connectionId': connectionId,
      'hostId': hostId,
      'hostGeneration': generation,
      'hostDisplayName': 'Fixture host',
      'bridgeVersion': 'm5',
      'piVersion': '0.80.6',
      'serverTime': '2026-07-13T00:00:00.000Z',
      'capabilities': ['streams.v1', 'commands.v1', 'controller_leases.v1'],
      'limits': {
        'maxJsonBytes': 1048576,
        'maxAttachmentBytes': 10485760,
        'maxAttachmentsPerPrompt': 4,
        'maxPromptAttachmentBytes': 26214400,
        'maxQueuedFollowUps': 10,
        'maxSessionPageSize': 100,
        'maxBackgroundSessionSubscriptions': 5,
      },
    });

Map<String, Object?> event({
  required String type,
  required String streamId,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  ...response(type, payload, requestId: null),
  'eventId': eventId,
  'streamId': streamId,
  'cursor': cursor,
};

Map<String, Object?> response(
  String type,
  Map<String, Object?> payload, {
  String? requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  String? commandId,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'requestId': ?requestId,
  'commandId': ?commandId,
  'type': type,
  'sentAt': DateTime.utc(2026, 7, 13).toIso8601String(),
  'payload': payload,
};

Future<void> eventually(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 3),
}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) throw TestFailure('Condition was not met');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class FakeBridgeTransport implements BridgeTransport {
  final List<FakeBridgeSocket> sockets = [];

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    final socket = FakeBridgeSocket();
    sockets.add(socket);
    return socket;
  }
}

final class FakeBridgeSocket implements BridgeSocket {
  final StreamController<String> _controller = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _controller.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) =>
      _controller.add(jsonEncode(message));

  @override
  Future<void> close([int? code, String? reason]) => _controller.close();
}
