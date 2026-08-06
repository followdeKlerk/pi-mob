/// Canonical mobile session-event contract.
///
/// This module is the Dart counterpart of
/// `packages/protocol-schema/src/session-events-v2.ts` from the
/// bridge rewrite slice. It declares the closed set of user-visible
/// transcript events the canonical mobile reducer consumes. The
/// canonical event is the single mobile-readable authority; the
/// reducer MUST NOT also depend on raw `pi.rpc.event` envelopes,
/// Pi-owned JSONL reconstructions, or any other transcript projection.
///
/// The slice reuses the existing normalised `StreamEventState` journal
/// row type (`apps/mobile/lib/src/domain/mobile_state.dart`) for
/// durable storage, but tags every cached row with a closed
/// `CanonicalEventType`. Rows outside the closed set are routed to
/// diagnostics and NEVER feed the transcript reducer.
///
/// Removal criteria for this slice:
///   - When the coordinator stops merging `history + live` for the
///     selected session and instead feeds only canonical events into
///     `SessionEventSynchronizer`, the older `transcriptEvents()`
///     merge helper may be deleted along with this contract, provided
///     the existing golden tests in
///     `apps/mobile/test/transcript/transcript_domain_test.dart`
///     still pass against the canonical adapter.
library;

/// Closed set of canonical event types the mobile reducer consumes.
///
/// This list deliberately mirrors the bridge rewrite slice. Adding a
/// new family here requires:
///   1. A bridge-side fixture in `packages/bridge/test/session-events/`
///   2. A canonical-event schema entry in
///      `packages/protocol-schema/src/session-events-v2.ts`
///   3. A reducer branch in [CanonicalTranscriptReducer]
///   4. Focused Dart tests in
///      `apps/mobile/test/session_events/transcript_reducer_test.dart`
enum CanonicalEventType {
  // Turn lifecycle.
  turnStarted,
  turnWaitingForInput,
  turnSettled,
  turnAborted,
  turnFailed,
  turnCancelled,

  // Assistant.
  assistantStarted,
  assistantContentReplaced,
  assistantMessageCompleted,

  // Tool calls.
  toolCallStarted,
  toolProgressReplaced,
  toolCallCompleted,
  toolCallFailed,

  // User-side.
  userMessageCreated,

  /// Operational canonical rows are sequenced by the bridge but do not
  /// mutate transcript state. They must still advance the cursor.
  ignored,
}

/// Stable envelope shared by every canonical event.
///
/// `eventId` is the deterministic identity the bridge assigns. The
/// reducer never infers identity from list position, timing, or any
/// other transient field. `sequence` is the per-session monotonic
/// sequence produced by the bridge-side canonical event store.
class CanonicalSessionEvent {
  const CanonicalSessionEvent({
    required this.eventId,
    required this.sessionId,
    required this.sequence,
    required this.type,
    required this.occurredAt,
    required this.payload,
  });

  /// Deterministic event identifier (bridge-generated or
  /// command-derived). Two equivalent canonical events share the
  /// same `eventId`.
  final String eventId;

  /// Owning session identifier. Two sessions may share event ids but
  /// never share (sessionId, eventId).
  final String sessionId;

  /// Per-session monotonic sequence assigned by the bridge canonical
  /// store. The reducer uses this to detect replay/live overlap.
  final int sequence;

  final CanonicalEventType type;

  /// Wall-clock timestamp produced by the bridge. Stored as ISO-8601
  /// string so the reducer remains free of clock reads.
  final DateTime occurredAt;

  /// Decoded payload. The reducer calls `as Map<String, Object?>` to
  /// look up fields. The wire shape is documented on each reducer
  /// branch.
  final Map<String, Object?> payload;

  /// Wire-style fingerprint for use in tests and logs. The shape is
  /// stable for a given canonical event and never includes host
  /// secrets or path-like fields.
  String get fingerprint =>
      'canonical:$sessionId:$sequence:${type.name}:$eventId';

  @override
  String toString() => 'CanonicalSessionEvent(${type.name}#$eventId@$sequence)';

  CanonicalSessionEvent copyWith({
    String? eventId,
    String? sessionId,
    int? sequence,
    CanonicalEventType? type,
    DateTime? occurredAt,
    Map<String, Object?>? payload,
  }) => CanonicalSessionEvent(
    eventId: eventId ?? this.eventId,
    sessionId: sessionId ?? this.sessionId,
    sequence: sequence ?? this.sequence,
    type: type ?? this.type,
    occurredAt: occurredAt ?? this.occurredAt,
    payload: payload ?? this.payload,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CanonicalSessionEvent &&
          other.eventId == eventId &&
          other.sessionId == sessionId &&
          other.sequence == sequence &&
          other.type == type &&
          other.occurredAt.isAtSameMomentAs(occurredAt) &&
          _payloadEquals(other.payload, payload));

  @override
  int get hashCode => Object.hash(
    eventId,
    sessionId,
    sequence,
    type,
    occurredAt,
    Object.hashAllUnordered(
      payload.entries.map((e) => Object.hash(e.key, e.value)),
    ),
  );
}

bool _payloadEquals(Map<String, Object?> a, Map<String, Object?> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    if (!b.containsKey(entry.key)) return false;
    final av = entry.value;
    final bv = b[entry.key];
    if (av is Map && bv is Map) {
      if (!_payloadEquals(
        Map<String, Object?>.from(av),
        Map<String, Object?>.from(bv),
      )) {
        return false;
      }
    } else if (av is List && bv is List) {
      if (av.length != bv.length) return false;
      for (var i = 0; i < av.length; i++) {
        if (av[i] != bv[i]) return false;
      }
    } else if (av != bv) {
      return false;
    }
  }
  return true;
}

/// Convenience: the canonical event types the mobile reducer treats as
/// terminal for turns. Mirrored from the bridge rewrite slice; only
/// events in [CanonicalEventType] may be present.
const Set<CanonicalEventType> terminalTurnTypes = <CanonicalEventType>{
  CanonicalEventType.turnSettled,
  CanonicalEventType.turnAborted,
  CanonicalEventType.turnFailed,
  CanonicalEventType.turnCancelled,
};

const Set<CanonicalEventType> terminalToolTypes = <CanonicalEventType>{
  CanonicalEventType.toolCallCompleted,
  CanonicalEventType.toolCallFailed,
};

/// Convenience: types that progress an assistant message toward
/// completion. The reducer never regresses a completed message.
const Set<CanonicalEventType> terminalAssistantTypes = <CanonicalEventType>{
  CanonicalEventType.assistantMessageCompleted,
};
