/// M11 per-session controller state. Each Pi session has exactly one
/// controller lease at a time; every other client observes.
///
/// Mobile uses two related abstractions:
///
/// * [ControllerMode] — the wire-reported mode (none/observer/primary).
/// * [SessionControllerState] — the mobile-side view: who owns the
///   controller, what the lease id is, and the explicit
///   acquire/release/takeover transitions the coordinator can drive.
///
/// The mobile client never invents lease identifiers. It only adopts the
/// one the host reports and only emits transitions that match the
/// authoritative state machine.
library;

/// Coarse controller mode reported by the host. `observer` is the
/// "read-only" remote — observer clients cannot send prompts; `primary`
/// means the current installation owns the lease. `none` is the
/// disconnected/transitioning state.
enum ControllerMode { none, observer, primary }

ControllerMode controllerModeFromWire(Object? value) {
  if (value is! String) return ControllerMode.none;
  switch (value) {
    case 'controller':
    case 'primary':
      return ControllerMode.primary;
    case 'observer':
    case 'view_only':
      return ControllerMode.observer;
    case 'none':
    case '':
      return ControllerMode.none;
    default:
      return ControllerMode.none;
  }
}

String controllerModeWire(ControllerMode mode) => switch (mode) {
  ControllerMode.none => 'none',
  ControllerMode.observer => 'observer',
  ControllerMode.primary => 'controller',
};

/// Per-session state. The coordinator keeps one of these per session and
/// exposes `acquire` / `release` / `takeover` / `markObserver` as the
/// only mutating methods. Direct field mutation is intentionally
/// prohibited so the "no dual controller" invariant can be tested.
final class SessionControllerState {
  SessionControllerState({required this.sessionId})
    : mode = ControllerMode.none,
      leaseId = null,
      previousMode = ControllerMode.none,
      takeoverPending = false;

  final String sessionId;
  ControllerMode mode;

  /// The host-issued lease id for the *current* holder. Mobile may not
  /// fabricate one — it is only ever set from a `controller.state` event
  /// or by an explicit `controller.acquire` reply.
  String? leaseId;

  /// Mode before the most recent transition. Used by the takeover UX
  /// so the user can be told what they took over from.
  ControllerMode previousMode;

  /// True while a takeover is pending. A takeover is a no-op while
  /// another takeover is in flight for the same session.
  bool takeoverPending;

  /// True if the current installation owns the lease. Mutating commands
  /// require this to be `true`.
  bool get hasLease => mode == ControllerMode.primary && leaseId != null;

  /// True if the current installation is observing (no lease but the
  /// session is still streamed). The composer must reject prompts.
  bool get isObserver => mode == ControllerMode.observer;

  SessionControllerState snapshot() =>
      SessionControllerState(sessionId: sessionId).._copyFrom(this);

  void _copyFrom(SessionControllerState other) {
    mode = other.mode;
    leaseId = other.leaseId;
    previousMode = other.previousMode;
    takeoverPending = other.takeoverPending;
  }

  /// Returns the [SessionControllerState] after recording the host's
  /// authoritative reply to a `controller.acquire` call. Idempotent: a
  /// repeat reply with the same lease id is a no-op.
  SessionControllerState adoptAcquire(String newLeaseId) {
    if (leaseId == newLeaseId && mode == ControllerMode.primary) {
      return this;
    }
    if (mode != ControllerMode.primary) previousMode = mode;
    mode = ControllerMode.primary;
    leaseId = newLeaseId;
    takeoverPending = false;
    return this;
  }

  /// Records the host's reply to a `controller.release` call. Mobile
  /// drops the lease id and reverts to observer (the session remains
  /// streamed as a background summary).
  SessionControllerState adoptRelease({ControllerMode? fallback}) {
    previousMode = mode;
    mode = fallback ?? ControllerMode.observer;
    leaseId = null;
    takeoverPending = false;
    return this;
  }

  /// Records an unsolicited observer demotion. The session is still
  /// streamed but mobile can no longer send prompts. Draft text is
  /// preserved by the caller.
  SessionControllerState markObserver({String? observerLeaseId}) {
    previousMode = mode;
    mode = ControllerMode.observer;
    leaseId = observerLeaseId;
    takeoverPending = false;
    return this;
  }

  /// Records a takeover-completed reply: the current installation now
  /// holds the lease.
  SessionControllerState adoptTakeover(String newLeaseId) {
    if (leaseId == newLeaseId && mode == ControllerMode.primary) {
      takeoverPending = false;
      return this;
    }
    previousMode = mode;
    mode = ControllerMode.primary;
    leaseId = newLeaseId;
    takeoverPending = false;
    return this;
  }

  /// Marks a takeover as in-flight. Repeat calls are no-ops.
  void beginTakeover() {
    if (mode == ControllerMode.primary) return;
    takeoverPending = true;
  }

  /// Records an authoritative `none` (the session is closing or the
  /// host has not yet reported a controller). Mobile never sends
  /// mutating commands in this state.
  SessionControllerState markNone() {
    previousMode = mode;
    mode = ControllerMode.none;
    leaseId = null;
    takeoverPending = false;
    return this;
  }
}

/// Aggregated view: `Map<sessionId, SessionControllerState>` plus the
/// currently selected primary session id. The selected primary is the
/// only session allowed to drive the composer.
final class ControllerBook {
  ControllerBook({Map<String, SessionControllerState>? states})
    : _states = states ?? <String, SessionControllerState>{};

  final Map<String, SessionControllerState> _states;

  Iterable<SessionControllerState> get values => _states.values;
  Iterable<String> get sessions => _states.keys;
  bool contains(String sessionId) => _states.containsKey(sessionId);

  SessionControllerState forSession(String sessionId) {
    final existing = _states[sessionId];
    if (existing != null) return existing;
    final created = SessionControllerState(sessionId: sessionId);
    _states[sessionId] = created;
    return created;
  }

  void drop(String sessionId) {
    _states.remove(sessionId);
  }

  /// Returns the single primary session id or `null` if no session is
  /// primary. Used to drive the foreground subscription set.
  String? get primarySessionId {
    for (final entry in _states.entries) {
      if (entry.value.mode == ControllerMode.primary) {
        return entry.key;
      }
    }
    return null;
  }

  /// True when *no* session is primary — the UI is in observer mode
  /// across the board.
  bool get isGlobalObserver => primarySessionId == null;

  Map<String, SessionControllerState> snapshot() {
    return Map<String, SessionControllerState>.unmodifiable(
      _states.map((key, value) => MapEntry(key, value.snapshot())),
    );
  }
}
