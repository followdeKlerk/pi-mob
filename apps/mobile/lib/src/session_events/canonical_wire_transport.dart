/// Canonical session-event wire transport.
///
/// This module is the Dart counterpart of
/// `packages/bridge/src/session-events/canonical-event-transport.ts`.
/// It validates and decodes the canonical `session.events.replay.result`
/// and `session.event` wire envelopes now defined in
/// `packages/protocol-schema/src/index.ts` and converts both into the
/// same [CanonicalSessionEvent] shape consumed by
/// [SessionEventSynchronizer].
///
/// The transport is the next cutover seam:
///
///   * It validates the wire shape (sessionId, eventId, sequence,
///     eventType, occurredAt, data) against the protocol schema.
///   * It accepts a bounded replay page, detects internal gaps, and
///     surfaces a structured error so the synchronizer can decide
///     whether to rebuild from zero or skip ahead.
///   * It feeds replay and live events through the same decoder so
///     the reducer cannot tell them apart (plan §3.4).
///   * It exposes [decodeWireEvent] for single-event live frames and
///     [decodeReplayResult] for the replay envelope. The decoder is
///     intentionally side-effect free.
///
/// This module is independent of the legacy coordinator/UI. It does
/// not touch [ConnectionCoordinator], the existing history/live merge,
/// or `TranscriptEventView`. A future slice wires the decoder through
/// the released path.
///
/// Removal criteria:
///
///   - When the coordinator stops merging history + live for the
///     selected session and feeds only canonical events into
///     `SessionEventSynchronizer`, this module remains the wire
///     boundary; deleting it requires deleting the canonical session
///     events on the bridge side as well.
library;

import 'canonical_event.dart';

/// Maximum page size accepted from a single `session.events.replay.result`
/// envelope. The protocol schema caps the events array at 1024; we
/// mirror that limit at decode time so a malicious or buggy bridge
/// cannot coerce the client into buffering unlimited events.
const int kCanonicalReplayPageCap = 1024;

/// Length cap on string fields. The schema caps `eventType` at 128;
/// the transport applies the same cap to `eventId` and `sessionId` for
/// symmetry with the bridge-side validator.
const int kCanonicalStringCap = 128;

/// Regex pattern for an ISO-8601 UTC timestamp with millisecond
/// precision. Matches the schema's `pattern` field.
final RegExp _kIsoUtcPattern = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$',
);

/// Reasons a wire envelope can fail validation. The list is closed so
/// the synchronizer/tests can switch on it deterministically.
enum CanonicalWireErrorCode {
  missingField,
  wrongType,
  outOfRange,
  invalidUuid,
  invalidTimestamp,
  unknownEventType,
  wrongSession,
  pageTooLarge,
  internalGap,
  duplicateSequence,
}

class CanonicalWireError implements Exception {
  const CanonicalWireError(this.code, this.message, {this.field});

  final CanonicalWireErrorCode code;
  final String message;
  final String? field;

  @override
  String toString() =>
      'CanonicalWireError($code${field == null ? "" : ".$field"}: $message)';
}

/// Result of decoding a single `session.event` wire frame.
class CanonicalWireDecodeResult {
  const CanonicalWireDecodeResult({required this.event});

  final CanonicalSessionEvent event;
}

/// Result of decoding a `session.events.replay.result` envelope.
class CanonicalReplayDecodeResult {
  const CanonicalReplayDecodeResult({
    required this.sessionId,
    required this.events,
    required this.latestSequence,
    required this.complete,
  });

  final String sessionId;
  final List<CanonicalSessionEvent> events;
  final int latestSequence;
  final bool complete;
}

/// Validate that [value] looks like a non-empty UUID-shaped string.
bool _isUuid(String value) {
  // Match the protocol schema's UUID pattern: 8-4-4-4-12 hex chars.
  return RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  ).hasMatch(value);
}

/// Validate that [value] looks like a non-empty session identifier.
/// The schema caps sessionId at 128 characters; we apply the same cap.
bool _isSessionId(String value) {
  return value.isNotEmpty && value.length <= kCanonicalStringCap;
}

bool _isBoundedString(String value, int maxLength) {
  return value.isNotEmpty && value.length <= maxLength;
}

CanonicalSessionEvent _decodeWireEnvelope(
  Map<String, Object?> payload, {
  required String wireSessionId,
}) {
  final eventId = payload['eventId'];
  if (eventId is! String || !_isUuid(eventId)) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.invalidUuid,
      'eventId must be a UUID-shaped string',
      field: 'eventId',
    );
  }
  final sequence = payload['sequence'];
  if (sequence is! int || sequence < 1) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.outOfRange,
      'sequence must be a positive integer',
      field: 'sequence',
    );
  }
  final eventType = payload['eventType'];
  if (eventType is! String ||
      !_isBoundedString(eventType, kCanonicalStringCap)) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'eventType must be a non-empty string up to 128 characters',
      field: 'eventType',
    );
  }
  final occurredAt = payload['occurredAt'];
  if (occurredAt is! String || !_kIsoUtcPattern.hasMatch(occurredAt)) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.invalidTimestamp,
      'occurredAt must be an ISO-8601 UTC timestamp',
      field: 'occurredAt',
    );
  }
  final data = payload['data'];
  if (data is! Map) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.wrongType,
      'data must be a JSON object',
      field: 'data',
    );
  }
  final sessionId = payload['sessionId'];
  if (sessionId is! String || !_isSessionId(sessionId)) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'sessionId must be a non-empty string up to 128 characters',
      field: 'sessionId',
    );
  }
  if (sessionId != wireSessionId) {
    throw CanonicalWireError(
      CanonicalWireErrorCode.wrongSession,
      'wire sessionId mismatch: envelope=$sessionId expected=$wireSessionId',
      field: 'sessionId',
    );
  }
  final canonicalType = _canonicalEventTypeFor(eventType);
  if (canonicalType == null) {
    throw CanonicalWireError(
      CanonicalWireErrorCode.unknownEventType,
      'eventType is not in the closed canonical set: $eventType',
      field: 'eventType',
    );
  }
  final parsedTime = DateTime.tryParse(occurredAt)?.toUtc();
  if (parsedTime == null) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.invalidTimestamp,
      'occurredAt could not be parsed as a date',
      field: 'occurredAt',
    );
  }
  return CanonicalSessionEvent(
    eventId: eventId,
    sessionId: sessionId,
    sequence: sequence,
    type: canonicalType,
    occurredAt: parsedTime,
    payload: Map<String, Object?>.from(data),
  );
}

CanonicalEventType? _canonicalEventTypeFor(String wireEventType) {
  // Accept the canonical replacement names emitted by the production bridge
  // as well as the original fixture aliases used by older test/replay data.
  switch (wireEventType) {
    case 'assistant.content.replaced':
      return CanonicalEventType.assistantContentReplaced;
    case 'assistant.message.completed':
      return CanonicalEventType.assistantMessageCompleted;
    case 'tool.progress.replaced':
      return CanonicalEventType.toolProgressReplaced;
  }
  for (final entry in CanonicalEventType.values) {
    if (entry != CanonicalEventType.ignored &&
        _canonicalEventTypeWireName(entry) == wireEventType) {
      return entry;
    }
  }
  if (_ignoredCanonicalWireTypes.contains(wireEventType)) {
    return CanonicalEventType.ignored;
  }
  return null;
}

const Set<String> _ignoredCanonicalWireTypes = <String>{
  'session.state',
  'session.metadata',
  'reasoning.started',
  'reasoning.delta',
  'reasoning.completed',
  'extension.dialog',
  'extension.notify',
  'extension.status',
  'extension.widget',
  'extension.title',
  'extension.editor_prefill',
  'queue.snapshot',
  'model.state',
  'context.state',
  'retry.state',
  'compaction.state',
  'error.event',
  'assistant.delta',
  'assistant.completed',
  'tool.output',
  'tool.cancelled',
};

/// Convert the Dart enum name to the wire literal used by the bridge
/// canonical session-event store.
String _canonicalEventTypeWireName(CanonicalEventType type) {
  switch (type) {
    case CanonicalEventType.turnStarted:
      return 'turn.started';
    case CanonicalEventType.turnWaitingForInput:
      return 'turn.waiting_for_input';
    case CanonicalEventType.turnSettled:
      return 'turn.settled';
    case CanonicalEventType.turnAborted:
      return 'turn.aborted';
    case CanonicalEventType.turnFailed:
      return 'turn.failed';
    case CanonicalEventType.turnCancelled:
      return 'turn.cancelled';
    case CanonicalEventType.assistantStarted:
      return 'assistant.started';
    case CanonicalEventType.assistantContentReplaced:
      return 'assistant.content.replaced';
    case CanonicalEventType.assistantMessageCompleted:
      return 'assistant.message.completed';
    case CanonicalEventType.toolCallStarted:
      return 'tool.started';
    case CanonicalEventType.toolProgressReplaced:
      return 'tool.progress.replaced';
    case CanonicalEventType.toolCallCompleted:
      return 'tool.completed';
    case CanonicalEventType.toolCallFailed:
      return 'tool.failed';
    case CanonicalEventType.userMessageCreated:
      return 'user.message.created';
    case CanonicalEventType.ignored:
      return '__ignored__';
  }
}

/// Decode a single `session.event` wire frame. The optional [wireSessionId]
/// argument asserts the envelope's `sessionId` matches the caller's
/// expectation; pass `null` to skip the check (e.g. for raw debugging).
CanonicalSessionEvent decodeWireEvent(
  Object? wireMessage, {
  String? wireSessionId,
}) {
  if (wireMessage is! Map) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.wrongType,
      'session.event payload must be a JSON object',
    );
  }
  final type = wireMessage['type'];
  if (type != 'session.event') {
    throw CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'expected session.event message type, got ${type ?? "<missing>"}',
      field: 'type',
    );
  }
  final payload = wireMessage['payload'];
  if (payload is! Map) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'session.event payload is missing',
      field: 'payload',
    );
  }
  if (wireSessionId == null) {
    final inferred = payload['sessionId'];
    if (inferred is! String || !_isSessionId(inferred)) {
      throw const CanonicalWireError(
        CanonicalWireErrorCode.missingField,
        'payload.sessionId is required when wireSessionId is not supplied',
        field: 'sessionId',
      );
    }
    wireSessionId = inferred;
  }
  return _decodeWireEnvelope(
    Map<String, Object?>.from(payload),
    wireSessionId: wireSessionId,
  );
}

/// Decode a `session.events.replay.result` envelope into the ordered
/// canonical events for the requested session. The decoder enforces:
///
///   * The wire message type is `session.events.replay.result`.
///   * The top-level `sessionId` matches every per-element `sessionId`.
///   * The page does not exceed [kCanonicalReplayPageCap] elements.
///   * Each per-element envelope validates via [decodeWireEvent].
///   * Sequences are strictly ascending and contiguous from
///     `latestSequence + 1` onward; an internal gap sets
///     `complete: false` and surfaces the events decoded so far.
///
/// The function never throws on internal gap or duplicate sequence
/// because the plan §8.6 fallback ("reset the local event cache for
/// that session") requires the caller to receive the partial page.
CanonicalReplayDecodeResult decodeReplayResult(
  Object? wireMessage, {
  String? wireSessionId,
}) {
  if (wireMessage is! Map) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.wrongType,
      'replay envelope must be a JSON object',
    );
  }
  final type = wireMessage['type'];
  if (type != 'session.events.replay.result') {
    throw CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'expected session.events.replay.result message type, got ${type ?? "<missing>"}',
      field: 'type',
    );
  }
  final payload = wireMessage['payload'];
  if (payload is! Map) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'replay payload is missing',
      field: 'payload',
    );
  }
  final sessionId = payload['sessionId'];
  if (sessionId is! String || !_isSessionId(sessionId)) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.missingField,
      'payload.sessionId is required',
      field: 'sessionId',
    );
  }
  if (wireSessionId != null && wireSessionId != sessionId) {
    throw CanonicalWireError(
      CanonicalWireErrorCode.wrongSession,
      'replay sessionId mismatch: envelope=$sessionId expected=$wireSessionId',
      field: 'sessionId',
    );
  }
  final eventsRaw = payload['events'];
  if (eventsRaw is! List) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.wrongType,
      'payload.events must be an array',
      field: 'events',
    );
  }
  if (eventsRaw.length > kCanonicalReplayPageCap) {
    throw CanonicalWireError(
      CanonicalWireErrorCode.pageTooLarge,
      'replay page exceeds $kCanonicalReplayPageCap elements (${eventsRaw.length})',
      field: 'events',
    );
  }
  final latestSequenceRaw = payload['latestSequence'];
  if (latestSequenceRaw is! int || latestSequenceRaw < 0) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.outOfRange,
      'latestSequence must be a non-negative integer',
      field: 'latestSequence',
    );
  }
  final completeRaw = payload['complete'];
  if (completeRaw is! bool) {
    throw const CanonicalWireError(
      CanonicalWireErrorCode.wrongType,
      'complete must be a boolean',
      field: 'complete',
    );
  }
  final events = <CanonicalSessionEvent>[];
  int? previousSequence;
  var internalGap = false;
  var duplicateSequence = false;
  for (final entry in eventsRaw) {
    final event = _decodeWireEnvelope(
      Map<String, Object?>.from(entry as Map),
      wireSessionId: sessionId,
    );
    if (previousSequence != null) {
      if (event.sequence <= previousSequence) {
        duplicateSequence = true;
      } else if (event.sequence != previousSequence + 1) {
        internalGap = true;
      }
    }
    // The first replay element is allowed to start at any positive sequence:
    // the request may resume after an already-applied cursor.
    previousSequence = event.sequence;
    events.add(event);
  }
  return CanonicalReplayDecodeResult(
    sessionId: sessionId,
    events: events,
    latestSequence: latestSequenceRaw,
    complete: completeRaw && !internalGap && !duplicateSequence,
  );
}
