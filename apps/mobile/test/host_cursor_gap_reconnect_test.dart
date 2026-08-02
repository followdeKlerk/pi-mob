import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';

const _hostId = 'd2ad566c-8d99-4879-8f18-295d3cd61e6f';
const _sessionId = '22222222-2222-4222-8222-222222222222';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('rapid contiguous host replay reaches ready after restored cursor 847', () async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final transport = _GapTransport();
    final coordinator = ConnectionCoordinator(
      transport: transport,
      database: database,
    );
    final streamId = 'host:$_hostId';
    try {
      await database.advanceCursor(
        streamId: streamId,
        hostId: _hostId,
        cursor: '847',
      );
      await coordinator.initialize(autoConnect: false);
      await coordinator.connect('https://fixture.test');
      final socket = transport.socket!;
      socket.server(_helloAccepted());
      await _eventually(
        () => socket.sent.any((message) => message['type'] == 'subscription.set'),
      );
      final subscription = socket.sent.lastWhere(
        (message) => message['type'] == 'subscription.set',
      );
      expect(
        ((subscription['payload'] as Map)['streams'] as List).single['afterCursor'],
        '847',
      );
      socket.server(_response('subscription.accepted', {
        'streams': [
          {'streamId': streamId, 'mode': 'replay'},
        ],
      }));

      for (var cursor = 848; cursor <= 909; cursor += 1) {
        socket.server(_event(
          type: 'host.draining',
          streamId: streamId,
          cursor: '$cursor',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-${cursor.toString().padLeft(12, '0')}',
          payload: {'draining': true},
        ));
      }
      socket.server(_event(
        type: 'session.summary',
        streamId: streamId,
        cursor: '910',
        eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000910',
        payload: {
          'sessionId': _sessionId,
          'runtimeState': 'idle',
          'attentionState': 'ready',
          'queueCount': 0,
        },
      ));
      socket.server(_event(
        type: 'session.summary',
        streamId: streamId,
        cursor: '911',
        eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000911',
        payload: {
          'sessionId': _sessionId,
          'runtimeState': 'idle',
          'attentionState': 'ready',
          'queueCount': 0,
        },
      ));
      socket.server(_response('stream.sync.complete', {
        'streamId': streamId,
        'currentCursor': '911',
        'mode': 'replay',
      }, requestId: null));

      await _eventually(() => coordinator.isReady);
      expect(coordinator.isReady, isTrue);
      expect(await database.cursor(streamId), '911');
      expect(coordinator.errorMessage, isNull);
    } finally {
      coordinator.dispose();
      await database.close();
    }
  });
}

Map<String, Object?> _helloAccepted() => _response('hello.accepted', {
  'connectionId': '44444444-4444-4444-8444-444444444444',
  'hostId': _hostId,
  'hostGeneration': '1',
  'hostDisplayName': 'Fixture host',
  'bridgeVersion': 'm5',
  'piVersion': '0.82.0',
  'serverTime': '2026-07-30T18:00:00.000Z',
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
  'sentAt': '2026-07-30T18:00:00.000Z',
  'payload': payload,
};

Future<void> _eventually(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TestFailure('Condition was not met');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class _GapTransport implements BridgeTransport {
  _GapSocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
        statusCode: 200,
        ready: true,
        body: {'status': 'ready'},
      );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    socket = _GapSocket();
    return socket!;
  }
}

final class _GapSocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) => _messages.add(jsonEncode(message));

  @override
  Future<void> close([int? code, String? reason]) => _messages.close();
}
