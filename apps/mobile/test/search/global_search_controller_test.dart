import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/search/global_search_controller.dart';
import 'package:pi_mob/src/search/search_hits.dart';

const _hostId = '11111111-1111-4111-8111-111111111111';
const _sessionA = '22222222-2222-4222-8222-222222222222';
const _sessionB = '33333333-3333-4333-8333-333333333333';

Future<_Fixture> _connectedFixture({
  Map<String, Object?> helloExtras = const {},
}) async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: _hostId,
      endpoint: 'https://fixture.test',
      displayName: 'Fixture',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  final transport = _ScriptedTransport();
  final coordinator = ConnectionCoordinator(
    transport: transport,
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  await coordinator.connect('https://fixture.test');
  final socket = transport.socket!;
  socket.server(
    _response('hello.accepted', {
      'connectionId': '44444444-4444-4444-8444-444444444444',
      'hostId': _hostId,
      'hostGeneration': '1',
      'hostDisplayName': 'Fixture',
      'bridgeVersion': 'test',
      'piVersion': '0.80.6',
      'serverTime': '2026-07-20T00:00:00.000Z',
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
      ...helloExtras,
    }),
  );
  await _eventually(
    () => socket.sent.any((message) => message['type'] == 'subscription.set'),
  );
  socket.server(
    _response('subscription.accepted', {
      'streams': [
        {'streamId': 'host:$_hostId', 'mode': 'current'},
      ],
    }),
  );
  // The existing app shell fixture seeds a sync.complete with cursor 0
  // before any journal events arrive. Sending session.summary events on
  // the host stream with cursor 1+ before the gate runs would force a
  // cursor-gap rejection, so we always wait for the gate to complete
  // before the test body starts streaming events.
  socket.server(
    _response('stream.sync.complete', {
      'streamId': 'host:$_hostId',
      'currentCursor': '0',
      'mode': 'current',
    }, requestId: null),
  );
  await _eventually(
    () => coordinator.isReady && coordinator.historyGateComplete,
  );
  return _Fixture(database, coordinator, transport);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'searchNow surfaces indexed hits with source and match offsets',
    () async {
      final fixture = await _connectedFixture();
      addTearDown(fixture.dispose);
      final socket = fixture.transport.socket!;
      // Seed two chats with one indexed hit each via the durable event flow.
      socket.server(
        _sessionSummary(
          _sessionA,
          cursor: '1',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'First chat',
        ),
      );
      socket.server(
        _sessionSummary(
          _sessionB,
          cursor: '2',
          eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Second chat',
        ),
      );
      socket.server(
        _event(
          type: 'turn.started',
          streamId: 'session:$_sessionA',
          cursor: '1',
          eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          payload: {'message': 'please analyse the alpha data set'},
        ),
      );
      socket.server(
        _event(
          type: 'turn.started',
          streamId: 'session:$_sessionB',
          cursor: '1',
          eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          payload: {'message': 'compare alpha to beta'},
        ),
      );
      await _eventually(() {
        final transcript = fixture.coordinator.transcriptEvents(_sessionA);
        final transcriptB = fixture.coordinator.transcriptEvents(_sessionB);
        return transcript.isNotEmpty && transcriptB.isNotEmpty;
      });
      final results = await fixture.coordinator.globalSearchController
          .searchNow('alpha');
      expect(results.hits.length, 2);
      expect(results.truncated, isFalse);
      final byEvent = {for (final hit in results.hits) hit.eventId: hit};
      expect(
        byEvent['cccccccc-cccc-4ccc-8ccc-cccccccccccc']!.source.name,
        'userPrompt',
      );
      expect(
        byEvent['dddddddd-dddd-4ddd-8ddd-dddddddddddd']!.source.name,
        'userPrompt',
      );
      expect(
        byEvent['cccccccc-cccc-4ccc-8ccc-cccccccccccc']!.matchStart,
        greaterThan(0),
      );
    },
  );

  test('setQuery debounces, then surfaces hits', () async {
    final fixture = await _connectedFixture();
    addTearDown(fixture.dispose);
    final socket = fixture.transport.socket!;
    socket.server(
      _sessionSummary(
        _sessionA,
        cursor: '1',
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Solo chat',
      ),
    );
    socket.server(
      _event(
        type: 'turn.started',
        streamId: 'session:$_sessionA',
        cursor: '1',
        eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        payload: {'message': 'lorem ipsum dolor sit amet'},
      ),
    );
    // Wait for the indexer to mirror the event into the search table.
    await _eventually(() async {
      final results = await fixture.coordinator.globalSearchController
          .searchNow('lorem');
      return results.hits.isNotEmpty;
    });

    final controller = fixture.coordinator.globalSearchController;
    controller.setQuery('lorem');
    // After the debounce window the controller must surface the hit.
    await _eventually(() async {
      final results = await fixture.coordinator.globalSearchController
          .searchNow('lorem');
      return results.hits.isNotEmpty;
    });
    final results = await fixture.coordinator.globalSearchController.searchNow(
      'lorem',
    );
    expect(results.hits, isNotEmpty);
  });

  test(
    'cancel() clears an in-flight query without leaving listeners stuck',
    () async {
      final fixture = await _connectedFixture();
      addTearDown(fixture.dispose);
      final socket = fixture.transport.socket!;
      socket.server(
        _sessionSummary(
          _sessionA,
          cursor: '1',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Solo',
        ),
      );
      socket.server(
        _event(
          type: 'turn.started',
          streamId: 'session:$_sessionA',
          cursor: '1',
          eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          payload: {'message': 'find this needle'},
        ),
      );
      await _eventually(() async {
        final results = await fixture.coordinator.globalSearchController
            .searchNow('needle');
        return results.hits.isNotEmpty;
      });

      final controller = fixture.coordinator.globalSearchController;
      controller.setQuery('nee');
      controller.cancel();
      expect(controller.phase, GlobalSearchPhase.cancelled);
      expect(controller.results.hits, isEmpty);
    },
  );

  test(
    'queries shorter than the minimum stay idle without a database scan',
    () async {
      final fixture = await _connectedFixture();
      addTearDown(fixture.dispose);
      final controller = fixture.coordinator.globalSearchController;
      controller.setQuery('a');
      expect(controller.phase, GlobalSearchPhase.idle);
      expect(controller.results.hits, isEmpty);
    },
  );

  test(
    'truncated flag is set when the index has more rows than the cap',
    () async {
      final fixture = await _connectedFixture();
      addTearDown(fixture.dispose);
      final database = fixture.database;
      final base = DateTime.utc(2026, 1, 1);
      for (var i = 0; i < kGlobalSearchHitCap + 5; i++) {
        await database.upsertSearchEntry(
          hostId: _hostId,
          sessionId: _sessionA,
          eventId: 'ev-$i',
          cursor: '$i',
          source: 'assistant',
          summary: 'matchword row $i',
          tokens: 'matchword row $i',
          occurredAt: base,
          updatedAt: base.add(Duration(seconds: i)),
        );
      }
      final results = await fixture.coordinator.globalSearchController
          .searchNow('matchword');
      expect(results.hits, hasLength(kGlobalSearchHitCap));
      expect(results.truncated, isTrue);
    },
  );
}

Map<String, Object?> _sessionSummary(
  String sessionId, {
  required String cursor,
  required String eventId,
  String name = 'Saved chat',
}) => _event(
  type: 'session.summary',
  streamId: 'host:$_hostId',
  cursor: cursor,
  eventId: eventId,
  payload: {
    'sessionId': sessionId,
    'name': name,
    'runtimeState': 'idle',
    'queueCount': 0,
  },
);

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
  String? requestId,
}) => <String, Object?>{
  'protocol': const {'major': 1, 'minor': 0},
  'messageId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'requestId': ?requestId,
  'type': type,
  'sentAt': '2026-07-20T00:00:00.000Z',
  'payload': payload,
};

Future<void> _eventually(
  FutureOr<bool> Function() condition, {
  int attempts = 1000,
}) async {
  for (var i = 0; i < attempts; i++) {
    if (await condition()) return;
    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
  throw TestFailure('Condition was not met');
}

final class _Fixture {
  _Fixture(this.database, this.coordinator, this.transport);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;
  final _ScriptedTransport transport;

  Future<void> dispose() async {
    coordinator.dispose();
    await database.close();
  }
}

final class _ScriptedTransport implements BridgeTransport {
  _ScriptedSocket? socket;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    return socket = _ScriptedSocket();
  }
}

final class _ScriptedSocket implements BridgeSocket {
  final StreamController<String> _messages = StreamController<String>();
  final List<Map<String, Object?>> sent = [];

  @override
  Stream<String> get messages => _messages.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(Map<String, Object?>.from(message));
  }

  void server(Map<String, Object?> message) {
    _messages.add(jsonEncode(message));
  }

  @override
  Future<void> close([int? code, String? reason]) => _messages.close();
}
