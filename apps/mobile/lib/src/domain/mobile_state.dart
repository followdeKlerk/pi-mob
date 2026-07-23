import 'dart:collection';
import 'dart:convert';

/// A canonical, arbitrary-precision, non-negative decimal stream cursor.
final class StreamCursor implements Comparable<StreamCursor> {
  StreamCursor._(this.value);

  factory StreamCursor.parse(String value) {
    if (!RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(value)) {
      throw FormatException('Cursor must be a canonical decimal string', value);
    }
    return StreamCursor._(value);
  }

  static final zero = StreamCursor.parse('0');

  final String value;

  StreamCursor get next =>
      StreamCursor.parse((BigInt.parse(value) + BigInt.one).toString());

  @override
  int compareTo(StreamCursor other) => value.length == other.value.length
      ? value.compareTo(other.value)
      : value.length.compareTo(other.value.length);

  @override
  bool operator ==(Object other) =>
      other is StreamCursor && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => value;
}

/// A normalized journal event. All JSON is recursively immutable.
final class StreamEventState {
  StreamEventState({
    required this.hostId,
    required this.streamId,
    required this.cursor,
    required this.eventId,
    required this.type,
    required Map<String, Object?> payload,
    required this.occurredAt,
  }) : payload = immutableJsonObject(payload);

  final String hostId;
  final String streamId;
  final StreamCursor cursor;
  final String eventId;
  final String type;
  final Map<String, Object?> payload;
  final DateTime occurredAt;

  String get payloadJson => jsonEncode(payload);
}

final class HostState {
  HostState({
    required this.hostId,
    required this.endpoint,
    required this.displayName,
    required this.generation,
    required this.connectionState,
    required Iterable<String> capabilities,
    this.bridgeVersion,
    this.piVersion,
    this.protocolVersion,
    this.lastSeenAt,
  }) : capabilities = List<String>.unmodifiable(capabilities);

  final String hostId;
  final String endpoint;
  final String displayName;
  final String generation;
  final String connectionState;
  final List<String> capabilities;
  final String? bridgeVersion;
  final String? piVersion;
  final String? protocolVersion;
  final DateTime? lastSeenAt;
}

final class SessionState {
  const SessionState({
    required this.sessionId,
    required this.hostId,
    required this.name,
    required this.runtimeState,
    required this.queueCount,
    this.workspaceId,
    this.policyMode,
    this.modelSummary,
    this.thinkingLevel,
    this.lastActivityAt,
    this.unreadState,
    this.controllerState,
  });

  final String sessionId;
  final String hostId;
  final String? workspaceId;
  final String name;
  final String runtimeState;
  final String? policyMode;
  final String? modelSummary;
  final String? thinkingLevel;
  final int queueCount;
  final DateTime? lastActivityAt;
  final String? unreadState;
  final String? controllerState;
}

final class DraftState {
  DraftState({
    required this.hostId,
    required this.sessionId,
    required this.text,
    required Iterable<String> localAttachmentRefs,
    required this.updatedAt,
    this.selectedDeliveryMode,
  }) : localAttachmentRefs = List<String>.unmodifiable(localAttachmentRefs);

  final String hostId;
  final String sessionId;
  final String text;
  final List<String> localAttachmentRefs;
  final DeliveryMode? selectedDeliveryMode;
  final DateTime updatedAt;
}

/// Delivery mode the composer submits with. Mirrors the protocol's
/// `deliveryMode` field on `prompt.submit`. Selection is sticky per session
/// and persists with the draft so a user can queue follow-ups, switch to
/// steer, and reconnect without losing the chosen mode.
enum DeliveryMode { immediate, steer, followUp }

String deliveryModeWire(DeliveryMode mode) => switch (mode) {
  DeliveryMode.immediate => 'immediate',
  DeliveryMode.steer => 'steer',
  DeliveryMode.followUp => 'follow_up',
};

String deliveryModeLabel(DeliveryMode mode) => switch (mode) {
  DeliveryMode.immediate => 'Send now',
  DeliveryMode.steer => 'Steer',
  DeliveryMode.followUp => 'Queue follow-up',
};

/// Returns the [DeliveryMode] for a wire string, or `null` for unknown /
/// empty values. Tolerant of host additions: future modes fall through to
/// `null` so the UI can default back to immediate without crashing.
DeliveryMode? deliveryModeFromWire(Object? value) {
  if (value is! String) return null;
  switch (value) {
    case 'immediate':
      return DeliveryMode.immediate;
    case 'steer':
      return DeliveryMode.steer;
    case 'follow_up':
      return DeliveryMode.followUp;
    default:
      return null;
  }
}

String sessionStateLabel(String state) => switch (state) {
  'crashed' => 'Pi stopped unexpectedly',
  'crash_loop' => 'Repeated crashes',
  'indeterminate' => 'Completion unknown',
  'provider_interrupted' => 'Provider interrupted',
  'waiting_for_input' => 'Needs your input',
  'retry_wait' => 'Retrying soon',
  'compacting' => 'Compacting context',
  'running' => 'Working',
  'idle' => 'Ready',
  'stopped' => 'Stopped',
  _ => state.replaceAll('_', ' '),
};

/// Coarse availability surfaced by the host. Unavailable workspaces remain
/// visible so the user can see why selection failed, but they are not
/// selectable.
enum WorkspaceAvailability { available, unavailable }

/// Trust posture for a workspace. Mirrors the host's `workspace.trust_state`
/// event family. The mobile UI must never allow mutation while trust is not
/// approved and must re-prompt the user when the fingerprint changes.
enum WorkspaceTrustState { unknown, unapproved, approved, fingerprintChanged }

/// Stable identifier for the active per-session policy. Both Full and
/// Read-only are product guardrails enforced through Pi tool hooks; they are
/// not OS-level sandboxes and the UI must never claim otherwise.
enum SessionPolicyMode { full, readOnly }

String sessionPolicyModeWire(SessionPolicyMode mode) => switch (mode) {
  SessionPolicyMode.full => 'full',
  SessionPolicyMode.readOnly => 'read_only',
};

String sessionPolicyModeLabel(SessionPolicyMode mode) => switch (mode) {
  SessionPolicyMode.full => 'Full',
  SessionPolicyMode.readOnly => 'Read-only',
};

/// Resource manifest line item reported by the host. This is display-only and
/// is never used as a path on the mobile device.
final class WorkspaceResource {
  const WorkspaceResource({
    required this.relativePath,
    required this.kind,
    this.sizeBytes,
  });

  final String relativePath;
  final String kind;
  final int? sizeBytes;
}

/// Server-reported workspace entry. Only results returned from the host are
/// ever selectable. Mobile never invents root IDs or relative paths, which is
/// why "outside the root" selections are structurally impossible.
final class WorkspaceEntry {
  const WorkspaceEntry({
    required this.workspaceId,
    required this.displayName,
    required this.rootLabel,
    required this.relativePath,
    required this.repositoryMarker,
    required this.lastUsedAt,
    required this.availability,
    required this.trustState,
    required this.fingerprint,
    required this.policyVersion,
    required this.manifest,
  });

  final String workspaceId;
  final String displayName;
  final String rootLabel;
  final String relativePath;
  final String? repositoryMarker;
  final DateTime? lastUsedAt;
  final WorkspaceAvailability availability;
  final WorkspaceTrustState trustState;
  final String fingerprint;
  final String policyVersion;
  final List<WorkspaceResource> manifest;

  bool get isSelectable =>
      availability == WorkspaceAvailability.available &&
      trustState == WorkspaceTrustState.approved;
}

/// One cancellable workspace-search result row. Mobile never lets a user
/// select a workspace from outside the server-reported set.
final class WorkspaceSearchHit {
  const WorkspaceSearchHit({
    required this.workspaceId,
    required this.displayName,
    required this.relativePath,
    required this.rootLabel,
    required this.availability,
    required this.trustState,
    required this.fingerprint,
    required this.policyVersion,
  });

  final String workspaceId;
  final String displayName;
  final String relativePath;
  final String rootLabel;
  final WorkspaceAvailability availability;
  final WorkspaceTrustState trustState;
  final String fingerprint;
  final String policyVersion;
}

/// Snapshot of the workspace search subsystem. Holds the in-flight request
/// handle so the UI can cancel before the host responds.
final class WorkspaceSearchState {
  WorkspaceSearchState({
    required this.query,
    required this.phase,
    required this.hits,
    required this.error,
  });

  factory WorkspaceSearchState.idle() => WorkspaceSearchState(
    query: '',
    phase: WorkspaceSearchPhase.idle,
    hits: const <WorkspaceSearchHit>[],
    error: null,
  );

  final String query;
  final WorkspaceSearchPhase phase;
  final List<WorkspaceSearchHit> hits;
  final String? error;

  bool get isActive => phase == WorkspaceSearchPhase.searching;

  WorkspaceSearchState copyWith({
    String? query,
    WorkspaceSearchPhase? phase,
    List<WorkspaceSearchHit>? hits,
    String? error,
    bool clearError = false,
  }) => WorkspaceSearchState(
    query: query ?? this.query,
    phase: phase ?? this.phase,
    hits: hits ?? this.hits,
    error: clearError ? null : (error ?? this.error),
  );
}

enum WorkspaceSearchPhase { idle, searching, results, error, cancelled }

final class MobileState {
  MobileState({
    required Iterable<HostState> hosts,
    required Iterable<SessionState> sessions,
    required Map<String, StreamViewState> streams,
    required Iterable<DraftState> drafts,
  }) : hosts = List<HostState>.unmodifiable(hosts),
       sessions = List<SessionState>.unmodifiable(sessions),
       streams = UnmodifiableMapView(Map<String, StreamViewState>.of(streams)),
       drafts = List<DraftState>.unmodifiable(drafts);

  final List<HostState> hosts;
  final List<SessionState> sessions;
  final Map<String, StreamViewState> streams;
  final List<DraftState> drafts;
}

enum StreamIntegrity { healthy, gap, conflict }

final class StreamViewState {
  StreamViewState({
    required this.streamId,
    required this.lastContiguousCursor,
    required this.integrity,
    required Iterable<StreamEventState> events,
    required Iterable<Map<String, Object?>> snapshotItems,
  }) : events = List<StreamEventState>.unmodifiable(events),
       snapshotItems = List<Map<String, Object?>>.unmodifiable(
         snapshotItems.map(immutableJsonObject),
       );

  factory StreamViewState.initial(String streamId, {StreamCursor? cursor}) =>
      StreamViewState(
        streamId: streamId,
        lastContiguousCursor: cursor ?? StreamCursor.zero,
        integrity: StreamIntegrity.healthy,
        events: const [],
        snapshotItems: const [],
      );

  final String streamId;
  final StreamCursor lastContiguousCursor;
  final StreamIntegrity integrity;
  final List<StreamEventState> events;
  final List<Map<String, Object?>> snapshotItems;
}

final class StreamSnapshot {
  StreamSnapshot({
    required this.snapshotId,
    required this.streamId,
    required this.baselineCursor,
    required Iterable<Map<String, Object?>> items,
  }) : items = List<Map<String, Object?>>.unmodifiable(
         items.map(immutableJsonObject),
       );

  final String snapshotId;
  final String streamId;
  final StreamCursor baselineCursor;
  final List<Map<String, Object?>> items;
}

/// Default page size requested by mobile for `session.history.page`. Mirrors
/// `LIMITS.maxSessionPageSize` from the protocol schema; the host may also
/// enforce smaller pages but never larger.
const int kSessionHistoryPageSize = 100;

const Object _sentinel = Object();

/// Per-session history buffer populated from `session.history.page` responses.
///
/// History items predate the live stream's sync baseline: they are merged
/// with the live `_streams['session:<id>'].events` only at the view layer
/// (see [ConnectionCoordinator.transcriptEvents]) so the canonical
/// cursor-ordered reducer that owns the live stream view is never bypassed.
///
/// Stored events are deduplicated by `eventId` and kept in ascending cursor
/// order across all fetched pages. The coordinator tracks [snapshotRevision]
/// so the UI can react to concurrent host changes (per
/// `docs/PROTOCOL.md §16`). The [nextPageToken] is opaque; mobile never
/// reads or reconstructs it, only echoes it back.
final class SessionHistoryState {
  SessionHistoryState({
    required this.sessionId,
    required Iterable<StreamEventState> items,
    required this.snapshotRevision,
    required this.nextPageToken,
    required this.isLoading,
    required this.error,
  }) : items = List<StreamEventState>.unmodifiable(items);

  factory SessionHistoryState.empty(String sessionId) => SessionHistoryState(
    sessionId: sessionId,
    items: const <StreamEventState>[],
    snapshotRevision: null,
    nextPageToken: null,
    isLoading: false,
    error: null,
  );

  final String sessionId;
  final List<StreamEventState> items;
  final String? snapshotRevision;
  final String? nextPageToken;
  final bool isLoading;

  /// Last transient error string, or `null` if the last fetch succeeded.
  /// Loaded pages preserve prior items even when a follow-up page errors.
  final String? error;

  /// True while older pages remain available on the host. The coordinator
  /// follows this token automatically while the session is selected.
  bool get hasOlder => nextPageToken != null;

  SessionHistoryState copyWith({
    List<StreamEventState>? items,
    Object? snapshotRevision = _sentinel,
    Object? nextPageToken = _sentinel,
    bool? isLoading,
    Object? error = _sentinel,
  }) => SessionHistoryState(
    sessionId: sessionId,
    items: items ?? this.items,
    snapshotRevision: identical(snapshotRevision, _sentinel)
        ? this.snapshotRevision
        : snapshotRevision as String?,
    nextPageToken: identical(nextPageToken, _sentinel)
        ? this.nextPageToken
        : nextPageToken as String?,
    isLoading: isLoading ?? this.isLoading,
    error: identical(error, _sentinel) ? this.error : error as String?,
  );
}

Map<String, Object?> immutableJsonObject(Map<String, Object?> source) =>
    Map<String, Object?>.unmodifiable(
      source.map((key, value) => MapEntry(key, _immutableJson(value))),
    );

Object? _immutableJson(Object? value) {
  if (value is Map) {
    return immutableJsonObject(Map<String, Object?>.from(value));
  }
  if (value is List) {
    return List<Object?>.unmodifiable(value.map(_immutableJson));
  }
  return value;
}
