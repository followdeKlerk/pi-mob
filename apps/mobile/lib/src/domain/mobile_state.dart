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
  final String? selectedDeliveryMode;
  final DateTime updatedAt;
}

final class ToolOutputNotice {
  const ToolOutputNotice({
    required this.toolCallId,
    required this.retainedBytes,
    required this.totalBytes,
    required this.isTruncated,
    this.digest,
  });

  final String toolCallId;
  final int retainedBytes;
  final int totalBytes;
  final bool isTruncated;
  final String? digest;
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
