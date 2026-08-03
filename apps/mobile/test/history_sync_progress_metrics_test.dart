import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';

const _hostId = 'd2ad566c-8d99-4879-8f18-295d3cd61e6f';
const _firstSessionId = '22222222-2222-4222-8222-222222222222';
const _secondSessionId = '33333333-3333-4333-8333-333333333333';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'history sync reports current chat, ETA, throughput, and bounded remaining',
    () async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      final transport = _MetricsTransport();
      var now = DateTime.utc(2026, 7, 30, 18);
      final coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
        now: () => now,
      );
      try {
        await coordinator.initialize(autoConnect: false);
        await coordinator.connect('https://fixture.test');
        final socket = transport.socket!;
        socket.server(_helloAccepted());
        await _eventually(
          () => socket.sent.any(
            (message) => message['type'] == 'subscription.set',
          ),
        );
        final subscription = socket.sent.lastWhere(
          (message) => message['type'] == 'subscription.set',
        );
        socket.server(
          _response(
            'subscription.accepted',
            {
              'streams': [
                {'streamId': 'host:$_hostId', 'mode': 'replay'},
              ],
            },
            requestId: subscription['requestId'] as String?,
          ),
        );
        socket.server(
          _event(
            type: 'session.summary',
            streamId: 'host:$_hostId',
            cursor: '1',
            eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
            payload: {
              'sessionId': _firstSessionId,
              'workspaceId': 'ws',
              'runtimeState': 'idle',
              'attentionState': 'ready',
              'queueCount': 0,
            },
          ),
        );
        socket.server(
          _event(
            type: 'session.summary',
            streamId: 'host:$_hostId',
            cursor: '2',
            eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
            payload: {
              'sessionId': _secondSessionId,
              'workspaceId': 'ws',
              'runtimeState': 'idle',
              'attentionState': 'ready',
              'queueCount': 0,
            },
          ),
        );
        socket.server(
          _response('stream.sync.complete', {
            'streamId': 'host:$_hostId',
            'currentCursor': '2',
            'mode': 'replay',
          }, requestId: null),
        );

        await _eventually(() => coordinator.historyGateRunning);
        expect(
          coordinator.historySyncCurrentSessionName,
          _firstSessionId.substring(0, 8),
        );
        expect(coordinator.historySyncEta, isNull);
        expect(coordinator.historySyncRemaining, 2);

        final firstPage = await _nextHistoryRequest(socket);
        now = now.add(const Duration(seconds: 1));
        socket.server(
          _response(
            'session.history.page.result',
            {
              'items': [
                {
                  'eventId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001',
                  'streamId': 'session:$_firstSessionId',
                  'cursor': '1',
                  'type': 'turn.started',
                  'payload': {'sessionId': _firstSessionId, 'turnId': 'turn-1'},
                },
              ],
              'snapshotRevision': '1',
              'nextPageToken': null,
            },
            requestId: firstPage['requestId'] as String,
          ),
        );
        await _eventually(() => coordinator.historySyncCompleted == 1);

        expect(coordinator.historySyncEta, isA<Duration>());
        expect(coordinator.historySyncEta!.inMilliseconds, greaterThan(0));
        expect(coordinator.historySyncEventsPerSecond, greaterThan(0));
        expect(coordinator.historySyncRemaining, 1);

        await _eventually(
          () =>
              socket.sent
                  .where((message) => message['type'] == 'session.history.page')
                  .length >=
              2,
        );
        final secondPage = socket.sent.lastWhere(
          (message) => message['type'] == 'session.history.page',
        );
        socket.server(
          _response(
            'session.history.page.result',
            {'items': const [], 'snapshotRevision': '0', 'nextPageToken': null},
            requestId: secondPage['requestId'] as String,
          ),
        );
        await _eventually(() => coordinator.historyGateComplete);

        expect(coordinator.historySyncEta, isNull);
        coordinator.debugSetHistorySyncState(completed: 99, total: 2);
        expect(coordinator.historySyncRemaining, 0);
      } finally {
        coordinator.dispose();
        await database.close();
      }
    },
  );
}

Future<Map<String, Object?>> _nextHistoryRequest(_MetricsSocket socket) async {
  await _eventually(
    () =>
        socket.sent.any((message) => message['type'] == 'session.history.page'),
  );
  return socket.sent.lastWhere(
    (message) => message['type'] == 'session.history.page',
  );
}

Map<String, Object?> _helloAccepted() => _response('hello.accepted', {
  'connectionId': '44444444-4444-4444-8444-444444444444',
  'hostId': _hostId,
  'hostGeneration': '1',
  'hostDisplayName': 'Fixture host',
  'bridgeVersion': 'm14',
  'piVersion': '0.82.0',
  'serverTime': '2026-07-30T18:00:00Z',
  'capabilities': ['streams.v1', 'commands.v1'],
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

Map<String, Object?> _event({
  required String type,
  required String streamId,
  required String cursor,
  required String eventId,
  required Map<String, Object?> payload,
}) => <String, Object?>{
  ..._response(type, payload, requestId: null),
  'eventId': eventId,
  'streamId': streamId,
  'cursor': cursor,
};

Map<String, Object?> _response(
  String type,
  Map<String, Object?> payload, {
  String? requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  if (requestId != null) 'requestId': requestId,
  'type': type,
  'sentAt': '2026-07-30T18:00:00Z',
  'payload': payload,
};

Future<void> _eventually(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline))
      throw TestFailure('Condition was not met');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class _MetricsTransport implements BridgeTransport {
  _MetricsSocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    socket = _MetricsSocket();
    return socket!;
  }
}

final class _MetricsSocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Future<void> send(Map<String, Object?> message) async => sent.add(message);

  @override
  Future<void> close([int? code, String? reason]) async {
    await _messages.close();
  }

  void server(Map<String, Object?> message) =>
      _messages.add(jsonEncode(message));
}
