import '../domain/mobile_state.dart';

enum EventDisposition { applied, duplicate, gap, conflict, ignoredWhilePaused }

final class EventReduction {
  const EventReduction({required this.state, required this.disposition});

  final StreamViewState state;
  final EventDisposition disposition;

  bool get needsSnapshot =>
      disposition == EventDisposition.conflict ||
      state.integrity == StreamIntegrity.conflict;

  bool get needsReplay =>
      disposition == EventDisposition.gap ||
      state.integrity == StreamIntegrity.gap;
}

/// Applies journal events strictly by arbitrary-precision decimal cursor.
///
/// A stream pauses on the first gap or conflicting cursor. Recovery happens only
/// through [replaceWithSnapshot], so an out-of-order live event can never be
/// accidentally merged into state.
final class OrderedEventReducer {
  const OrderedEventReducer();

  EventReduction apply(StreamViewState state, StreamEventState event) {
    if (event.streamId != state.streamId) {
      throw ArgumentError.value(
        event.streamId,
        'event.streamId',
        'wrong stream',
      );
    }

    final atCursor = state.events.where(
      (existing) => existing.cursor == event.cursor,
    );
    if (atCursor.isNotEmpty) {
      final existing = atCursor.first;
      if (existing.eventId == event.eventId) {
        return EventReduction(
          state: state,
          disposition: EventDisposition.duplicate,
        );
      }
      return EventReduction(
        state: _copy(state, integrity: StreamIntegrity.conflict),
        disposition: EventDisposition.conflict,
      );
    }

    final cursorOrder = event.cursor.compareTo(state.lastContiguousCursor);
    if (cursorOrder <= 0) {
      // The cache may have been compacted, but any old cursor is still a
      // duplicate only if identity was provable. Otherwise fail closed.
      return EventReduction(
        state: _copy(state, integrity: StreamIntegrity.conflict),
        disposition: EventDisposition.conflict,
      );
    }
    if (state.integrity != StreamIntegrity.healthy) {
      return EventReduction(
        state: state,
        disposition: EventDisposition.ignoredWhilePaused,
      );
    }
    if (event.cursor != state.lastContiguousCursor.next) {
      return EventReduction(
        state: _copy(state, integrity: StreamIntegrity.gap),
        disposition: EventDisposition.gap,
      );
    }

    return EventReduction(
      state: StreamViewState(
        streamId: state.streamId,
        lastContiguousCursor: event.cursor,
        integrity: StreamIntegrity.healthy,
        events: [...state.events, event],
        snapshotItems: state.snapshotItems,
      ),
      disposition: EventDisposition.applied,
    );
  }

  /// Atomically constructs replacement state. No pre-baseline event survives.
  StreamViewState replaceWithSnapshot(
    StreamViewState previous,
    StreamSnapshot snapshot, {
    Iterable<StreamEventState> postBaselineEvents = const [],
  }) {
    if (snapshot.streamId != previous.streamId) {
      throw ArgumentError.value(
        snapshot.streamId,
        'snapshot.streamId',
        'wrong stream',
      );
    }
    var replacement = StreamViewState(
      streamId: snapshot.streamId,
      lastContiguousCursor: snapshot.baselineCursor,
      integrity: StreamIntegrity.healthy,
      events: const [],
      snapshotItems: snapshot.items,
    );
    for (final event in postBaselineEvents) {
      final reduction = apply(replacement, event);
      if (reduction.disposition != EventDisposition.applied &&
          reduction.disposition != EventDisposition.duplicate) {
        throw StateError(
          'Invalid post-baseline event sequence: ${event.cursor}',
        );
      }
      replacement = reduction.state;
    }
    return replacement;
  }

  StreamViewState _copy(
    StreamViewState state, {
    required StreamIntegrity integrity,
  }) => StreamViewState(
    streamId: state.streamId,
    lastContiguousCursor: state.lastContiguousCursor,
    integrity: integrity,
    events: state.events,
    snapshotItems: state.snapshotItems,
  );
}

/// Validates multipart snapshots without exposing partial state.
final class SnapshotAssembler {
  String? _snapshotId;
  String? _streamId;
  StreamCursor? _baseline;
  final Map<int, List<Map<String, Object?>>> _parts = {};

  bool get isActive => _snapshotId != null;

  void begin({
    required String snapshotId,
    required String streamId,
    required StreamCursor baselineCursor,
  }) {
    if (isActive) {
      throw StateError('A snapshot is already being assembled');
    }
    if (snapshotId.isEmpty || streamId.isEmpty) {
      throw ArgumentError('Snapshot and stream identifiers must not be empty');
    }
    _snapshotId = snapshotId;
    _streamId = streamId;
    _baseline = baselineCursor;
    _parts.clear();
  }

  void addPart({
    required String snapshotId,
    required int part,
    required Iterable<Map<String, Object?>> items,
  }) {
    _requireSnapshot(snapshotId);
    if (part < 0) throw RangeError.value(part, 'part', 'must be non-negative');
    if (_parts.containsKey(part)) {
      throw StateError('Duplicate snapshot part $part');
    }
    _parts[part] = List<Map<String, Object?>>.unmodifiable(
      items.map(immutableJsonObject),
    );
  }

  StreamSnapshot finish({required String snapshotId, required int partCount}) {
    _requireSnapshot(snapshotId);
    if (partCount < 1) {
      abort();
      throw StateError('Snapshot must contain at least one part');
    }
    final expected = List<int>.generate(partCount, (index) => index);
    if (_parts.length != partCount ||
        expected.any((part) => !_parts.containsKey(part))) {
      abort();
      throw StateError('Snapshot parts are incomplete or non-contiguous');
    }
    final result = StreamSnapshot(
      snapshotId: _snapshotId!,
      streamId: _streamId!,
      baselineCursor: _baseline!,
      items: [for (final part in expected) ..._parts[part]!],
    );
    abort();
    return result;
  }

  void abort() {
    _snapshotId = null;
    _streamId = null;
    _baseline = null;
    _parts.clear();
  }

  void _requireSnapshot(String snapshotId) {
    if (!isActive || snapshotId != _snapshotId) {
      throw StateError('No matching snapshot is active');
    }
  }
}
