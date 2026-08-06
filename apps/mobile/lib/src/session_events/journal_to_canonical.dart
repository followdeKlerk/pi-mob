/// Adapter that converts the existing journal `StreamEventState`
/// rows into canonical `CanonicalSessionEvent` values the
/// `SessionEventSynchronizer` consumes.
///
/// The adapter is intentionally narrow. It maps the closed set of
/// transcript-relevant journal types (turn/assistant/reasoning/tool
/// lifecycle) into canonical events with strict sequence identity.
/// Events outside the closed set are skipped, mirroring the bridge
/// canonical-event contract from
/// `packages/bridge/src/session-events/canonical-event.ts`.
///
/// Sequence identity:
///   * The journal cursor (`StreamCursor`) is a decimal string. The
///     adapter converts it to a per-session monotonic `int` by
///     parsing the underlying `BigInt`. The bridge canonical-event
///     store mirrors the same numbering scheme.
///   * Two journal events that share the same cursor MUST share the
///     same canonical event id; the synchronizer dedups on this
///     identity.
///
/// The adapter is stateless and synchronous. Callers (the coordinator
/// or a feature-flagged alternate wiring) feed it journal events and
/// route the result to the synchronizer.
library;

import 'dart:convert';

import '../domain/mobile_state.dart';
import 'canonical_event.dart';

class CanonicalAdapterResult {
  const CanonicalAdapterResult({this.canonical, this.droppedReason});

  final CanonicalSessionEvent? canonical;
  final String? droppedReason;

  bool get isAccepted => canonical != null;
}

/// Converts a single journal event to a canonical event. Returns
/// `null` (with `droppedReason`) when the journal event does not map
/// to a canonical event (e.g. diagnostics, snapshots, raw `pi.rpc.event`
/// passthrough frames).
CanonicalAdapterResult adaptJournalEvent(
  StreamEventState event, {
  required String sessionId,
}) {
  if (event.streamId != 'session:$sessionId') {
    return const CanonicalAdapterResult(droppedReason: 'wrong_stream');
  }
  final sequence = _cursorToSequence(event.cursor);
  final type = _canonicalTypeFor(event.type);
  if (type == null) {
    return CanonicalAdapterResult(
      droppedReason: 'unmappable_journal_type:${event.type}',
    );
  }
  final payload = _payloadFor(event.type, event.payload);
  if (payload == null) {
    return CanonicalAdapterResult(
      droppedReason: 'malformed_payload_for:${event.type}',
    );
  }
  return CanonicalAdapterResult(
    canonical: CanonicalSessionEvent(
      eventId: event.eventId,
      sessionId: sessionId,
      sequence: sequence,
      type: type,
      occurredAt: event.occurredAt.toUtc(),
      payload: payload,
    ),
  );
}

CanonicalEventType? _canonicalTypeFor(String journalType) {
  switch (journalType) {
    case 'turn.started':
      return CanonicalEventType.turnStarted;
    case 'turn.waiting_for_input':
      return CanonicalEventType.turnWaitingForInput;
    case 'turn.settled':
      return CanonicalEventType.turnSettled;
    case 'turn.aborted':
      return CanonicalEventType.turnAborted;
    case 'turn.failed':
      return CanonicalEventType.turnFailed;
    case 'turn.cancelled':
      return CanonicalEventType.turnCancelled;
    case 'assistant.started':
      return CanonicalEventType.assistantStarted;
    case 'assistant.completed':
      return CanonicalEventType.assistantMessageCompleted;
    case 'tool.started':
      return CanonicalEventType.toolCallStarted;
    case 'tool.completed':
      return CanonicalEventType.toolCallCompleted;
    case 'tool.failed':
      return CanonicalEventType.toolCallFailed;
  }
  // Assistant delta / tool.output map to replacement semantics; the
  // adapter synthesises canonical events for them inline because the
  // canonical event type is intentionally a replacement snapshot.
  return null;
}

/// Translates journal `assistant.delta` payloads into replacement
/// content snapshots. The reducer never sees an append-style delta
/// for an assistant message; the adapter materialises a full
/// replacement block from the running buffer plus the new delta.
CanonicalAdapterResult adaptAssistantDelta(
  StreamEventState delta, {
  required String sessionId,
  required String messageId,
  required String turnId,
  required String previousContent,
}) {
  final text = delta.payload['text'] ?? delta.payload['delta'];
  final nextText = previousContent + (text is String ? text : '');
  return CanonicalAdapterResult(
    canonical: CanonicalSessionEvent(
      eventId: delta.eventId,
      sessionId: sessionId,
      sequence: _cursorToSequence(delta.cursor),
      type: CanonicalEventType.assistantContentReplaced,
      occurredAt: delta.occurredAt.toUtc(),
      payload: <String, Object?>{
        'turnId': turnId,
        'messageId': messageId,
        'content': <Map<String, Object?>>[
          <String, Object?>{'kind': 'text', 'text': nextText},
        ],
      },
    ),
  );
}

/// Translates journal `tool.output` payloads into replacement progress
/// snapshots.
CanonicalAdapterResult adaptToolOutput(
  StreamEventState output, {
  required String sessionId,
  required String toolCallId,
  required String turnId,
}) {
  return CanonicalAdapterResult(
    canonical: CanonicalSessionEvent(
      eventId: output.eventId,
      sessionId: sessionId,
      sequence: _cursorToSequence(output.cursor),
      type: CanonicalEventType.toolProgressReplaced,
      occurredAt: output.occurredAt.toUtc(),
      payload: <String, Object?>{
        'turnId': turnId,
        'toolCallId': toolCallId,
        'progress': output.payload,
      },
    ),
  );
}

Map<String, Object?>? _payloadFor(
  String journalType,
  Map<String, Object?> source,
) {
  switch (journalType) {
    case 'turn.started':
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      return <String, Object?>{'turnId': turnId};
    case 'turn.waiting_for_input':
    case 'turn.settled':
    case 'turn.aborted':
    case 'turn.failed':
    case 'turn.cancelled':
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      return <String, Object?>{'turnId': turnId};
    case 'assistant.started':
      final messageId =
          _readString(source, 'contentBlockId') ??
          _readString(source, 'answerId');
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      if (messageId == null) return null;
      return <String, Object?>{'turnId': turnId, 'messageId': messageId};
    case 'assistant.completed':
      final messageId =
          _readString(source, 'contentBlockId') ??
          _readString(source, 'answerId');
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      if (messageId == null) return null;
      return <String, Object?>{'turnId': turnId, 'messageId': messageId};
    case 'tool.started':
      final toolCallId = _readString(source, 'toolCallId');
      final toolName = _readString(source, 'toolName');
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      if (toolCallId == null || toolName == null) return null;
      final args = source['arguments'];
      return <String, Object?>{
        'turnId': turnId,
        'toolCallId': toolCallId,
        'toolName': toolName,
        'arguments': args is Map
            ? Map<String, Object?>.from(args)
            : const <String, Object?>{},
      };
    case 'tool.completed':
      final toolCallId = _readString(source, 'toolCallId');
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      if (toolCallId == null) return null;
      return <String, Object?>{
        'turnId': turnId,
        'toolCallId': toolCallId,
        'result': source['result'],
      };
    case 'tool.failed':
      final toolCallId = _readString(source, 'toolCallId');
      final turnId =
          _readString(source, 'turnId') ??
          _readString(source, 'turnIndex') ??
          'unknown';
      if (toolCallId == null) return null;
      final error = source['error'] ?? source['errorMessage'];
      return <String, Object?>{
        'turnId': turnId,
        'toolCallId': toolCallId,
        'error': error,
      };
  }
  return null;
}

String? _readString(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is String && value.isNotEmpty) return value;
  if (value is int) return value.toString();
  return null;
}

int _cursorToSequence(StreamCursor cursor) {
  return int.parse(cursor.value);
}

/// Convenience for tests: serialises a list of canonical events to a
/// stable JSON string so test fixtures can be checked in.
String canonicalEventsJson(List<CanonicalSessionEvent> events) {
  return jsonEncode(
    events
        .map(
          (e) => <String, Object?>{
            'eventId': e.eventId,
            'sessionId': e.sessionId,
            'sequence': e.sequence,
            'type': e.type.name,
            'occurredAt': e.occurredAt.toUtc().toIso8601String(),
            'payload': e.payload,
          },
        )
        .toList(growable: false),
  );
}
