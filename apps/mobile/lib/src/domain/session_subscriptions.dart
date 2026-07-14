/// M11 subscription set: one full session stream plus up to five
/// bounded summary streams, with per-stream cursor isolation.
///
/// The set is **session-scoped** — the host stream is always subscribed
/// and lives outside this struct. The struct is the deterministic view
/// of the *session* subscriptions the coordinator has asked the host
/// for. Re-subscribing must never confuse the two roles (full vs.
/// summary) and the cursor for each subscription is tracked
/// independently so a gap on one background session cannot stall the
/// foreground session.
library;

import 'mobile_state.dart';

/// Wire detail level. Mirrors the protocol's `subscription.streams[].detail`.
enum SubscriptionDetail { full, summary }

String subscriptionDetailWire(SubscriptionDetail detail) =>
    detail == SubscriptionDetail.full ? 'full' : 'summary';

/// One subscription row. The set holds at most one `full` row and up to
/// five `summary` rows. Cursors are tracked in decimal string form so
/// arbitrary-precision values survive the round trip.
final class SessionSubscription {
  SessionSubscription({
    required this.streamId,
    required this.sessionId,
    required this.detail,
    required this.cursor,
  });

  final String streamId;
  final String sessionId;
  final SubscriptionDetail detail;
  StreamCursor cursor;

  SessionSubscription copyWith({StreamCursor? cursor}) => SessionSubscription(
    streamId: streamId,
    sessionId: sessionId,
    detail: detail,
    cursor: cursor ?? this.cursor,
  );

  Map<String, Object?> toWire() => <String, Object?>{
    'streamId': streamId,
    'detail': subscriptionDetailWire(detail),
    'afterCursor': cursor.value,
  };

  @override
  String toString() => '$streamId($detail@${cursor.value})';
}

/// Immutable view of the subscription set, with explicit operations for
/// mutation. Operations that would violate the size cap raise
/// [StateError] so the caller cannot accidentally exceed it.
final class SessionSubscriptionSet {
  SessionSubscriptionSet._(this._items);

  factory SessionSubscriptionSet.empty() =>
      SessionSubscriptionSet._(<SessionSubscription>[]);

  /// Hard caps from the M11 product spec.
  static const int maxSummarySubscriptions = 5;
  static const int maxTotalSubscriptions = 6; // 1 full + 5 summary

  final List<SessionSubscription> _items;

  List<SessionSubscription> get items =>
      List<SessionSubscription>.unmodifiable(_items);

  /// The full-detail session, or `null` if the host has not yet reported
  /// one. There is at most one full subscription at any time.
  SessionSubscription? get full {
    for (final item in _items) {
      if (item.detail == SubscriptionDetail.full) return item;
    }
    return null;
  }

  /// All summary subscriptions, in subscription order. The order is the
  /// order the host sees them in `subscription.set`, so the UI binds
  /// background badges to the first N of this list.
  List<SessionSubscription> get summaries => _items
      .where((item) => item.detail == SubscriptionDetail.summary)
      .toList(growable: false);

  int get length => _items.length;
  bool get isEmpty => _items.isEmpty;

  /// Returns a new set with the given full-detail session, replacing any
  /// existing full subscription. Throws if `sessionId` is empty.
  SessionSubscriptionSet setFull({
    required String sessionId,
    required StreamCursor cursor,
  }) {
    if (sessionId.isEmpty) {
      throw ArgumentError.value(sessionId, 'sessionId', 'must not be empty');
    }
    final filtered = _items
        .where((item) => item.detail != SubscriptionDetail.full)
        .toList(growable: true);
    filtered.add(
      SessionSubscription(
        streamId: 'session:$sessionId',
        sessionId: sessionId,
        detail: SubscriptionDetail.full,
        cursor: cursor,
      ),
    );
    if (filtered.length > maxTotalSubscriptions) {
      throw StateError(
        'Full subscription would exceed the $maxTotalSubscriptions cap',
      );
    }
    return SessionSubscriptionSet._(List.unmodifiable(filtered));
  }

  /// Returns a new set with `sessionId` added as a summary subscription.
  /// Throws if the cap would be exceeded, the session is already
  /// subscribed (in either role), or the session id is empty.
  SessionSubscriptionSet addSummary({
    required String sessionId,
    required StreamCursor cursor,
  }) {
    if (sessionId.isEmpty) {
      throw ArgumentError.value(sessionId, 'sessionId', 'must not be empty');
    }
    final existing = _items.where((item) => item.sessionId == sessionId);
    if (existing.isNotEmpty) {
      throw StateError('Session $sessionId is already subscribed');
    }
    final summaries = _items
        .where((item) => item.detail == SubscriptionDetail.summary)
        .length;
    if (summaries >= maxSummarySubscriptions) {
      throw StateError(
        'Already subscribed to $maxSummarySubscriptions summaries',
      );
    }
    final next = List<SessionSubscription>.of(_items)
      ..add(
        SessionSubscription(
          streamId: 'session:$sessionId',
          sessionId: sessionId,
          detail: SubscriptionDetail.summary,
          cursor: cursor,
        ),
      );
    if (next.length > maxTotalSubscriptions) {
      throw StateError('Summary would exceed the $maxTotalSubscriptions cap');
    }
    return SessionSubscriptionSet._(List.unmodifiable(next));
  }

  /// Returns a new set with the given session removed (in any role).
  /// Removing a missing session is a no-op.
  SessionSubscriptionSet remove(String sessionId) {
    final next = _items
        .where((item) => item.sessionId != sessionId)
        .toList(growable: false);
    if (next.length == _items.length) return this;
    return SessionSubscriptionSet._(List.unmodifiable(next));
  }

  /// Returns a new set with the cursor for the given session advanced
  /// to `next`. No-op if the session is not in the set. Crucially, this
  /// is **per-session**: advancing a summary cursor never moves the
  /// full session cursor, and vice versa.
  SessionSubscriptionSet advanceCursor({
    required String sessionId,
    required StreamCursor next,
  }) {
    var changed = false;
    final out = <SessionSubscription>[];
    for (final item in _items) {
      if (item.sessionId == sessionId && item.cursor.compareTo(next) < 0) {
        out.add(item.copyWith(cursor: next));
        changed = true;
      } else {
        out.add(item);
      }
    }
    if (!changed) return this;
    return SessionSubscriptionSet._(List.unmodifiable(out));
  }

  /// True if `sessionId` is in the set (in any role).
  bool contains(String sessionId) =>
      _items.any((item) => item.sessionId == sessionId);

  /// True if `sessionId` is the current full-detail subscription.
  bool isFull(String sessionId) => full?.sessionId == sessionId;

  /// True if `sessionId` is a current summary subscription.
  bool isSummary(String sessionId) => _items.any(
    (item) =>
        item.sessionId == sessionId &&
        item.detail == SubscriptionDetail.summary,
  );

  /// Returns the wire-shaped payload suitable for `subscription.set`.
  List<Map<String, Object?>> toWire() =>
      _items.map((item) => item.toWire()).toList(growable: false);
}
