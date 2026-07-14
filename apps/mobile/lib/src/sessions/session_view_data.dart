import 'package:flutter/foundation.dart';

/// Why a session is currently drawing attention. Mapped upstream by the host
/// stream reducer; the widget must never invent these values.
enum SessionAttention {
  /// No special attention.
  none,

  /// The host is asking the user to resolve a problem (waiting for input,
  /// policy denial that needs an answer, indeterminate completion, etc).
  attention,

  /// The session is stopped but still observable.
  stopped,

  /// The session is in the soft-deleted/trash state. M11 keeps these in the
  /// list so the user can re-attach before permanent purge.
  deleted,
}

/// Per-session background/foreground state used by the fast switcher and
/// the unread badge. Determined upstream from host subscriptions and the
/// local foreground tracking; the widget never decides this on its own.
enum SessionBackground {
  /// The session is currently the foreground controller target.
  foreground,

  /// The session is observable but running in the background.
  background,

  /// The session is backgrounded and has unread activity that the user has
  /// not yet acknowledged. The unread count is carried separately.
  unread,
}

/// Runtime state string mirrored from the host. Kept as a String so future
/// Pi states (e.g. new crash-loop labels) flow through without mobile
/// changes. The widget only compares to a closed set of known values when
/// it needs to draw a runtime pill.
class SessionRuntime {
  const SessionRuntime._(this.label);

  final String label;

  static const idle = SessionRuntime._('idle');
  static const running = SessionRuntime._('running');
  static const waiting = SessionRuntime._('waiting');
  static const stopped = SessionRuntime._('stopped');
  static const crashed = SessionRuntime._('crashed');
  static const crashLoop = SessionRuntime._('crash_loop');
  static const indeterminate = SessionRuntime._('indeterminate');
  static const providerInterrupted = SessionRuntime._('provider_interrupted');
  static const deleted = SessionRuntime._('deleted');

  static const known = <String>{
    'idle',
    'running',
    'waiting',
    'stopped',
    'crashed',
    'crash_loop',
    'indeterminate',
    'provider_interrupted',
    'deleted',
  };

  bool get isRunning => label == 'running' || label == 'waiting';
  bool get isHalted =>
      label == 'stopped' ||
      label == 'crashed' ||
      label == 'crash_loop' ||
      label == 'provider_interrupted';
  bool get isDeleted => label == 'deleted';

  @override
  bool operator ==(Object other) =>
      other is SessionRuntime && other.label == label;

  @override
  int get hashCode => label.hashCode;

  @override
  String toString() => label;
}

/// One row in the session list / switcher. The widget does not know how this
/// data was assembled; the reducer / coordinator owns that.
@immutable
class SessionSummaryData {
  const SessionSummaryData({
    required this.sessionId,
    required this.displayName,
    required this.workspaceLabel,
    required this.runtime,
    required this.attention,
    required this.background,
    this.unreadCount = 0,
    this.lastActivityAt,
    this.isController = false,
    this.hasUnsavedDraft = false,
  });

  /// Stable identifier echoed by the host.
  final String sessionId;

  /// User-visible label. Never the raw id.
  final String displayName;

  /// Workspace display name. May be `null` to indicate a detached session.
  final String? workspaceLabel;

  /// Current runtime state. Use the closed constants on [SessionRuntime]
  /// for comparisons; raw string comparisons are not allowed in widgets.
  final SessionRuntime runtime;

  /// Why this row is drawing attention. Mapped upstream.
  final SessionAttention attention;

  /// Foreground / background / unread. The widget never decides this.
  final SessionBackground background;

  /// How many events arrived while the user was not looking. `0` means the
  /// badge will not render even if [background] is [SessionBackground.unread].
  final int unreadCount;

  /// Last known activity timestamp, if the host reported one. Null is
  /// allowed and renders as "no activity yet".
  final DateTime? lastActivityAt;

  /// True when this client currently holds the controller lease for the
  /// session. False means observer.
  final bool isController;

  /// True when the user has an in-flight prompt draft that has not been
  /// sent. Used by the no-victim eviction policy.
  final bool hasUnsavedDraft;

  bool get isUnread =>
      background == SessionBackground.unread && unreadCount > 0;

  bool get isBackground =>
      background == SessionBackground.background ||
      background == SessionBackground.unread;
}

/// Closed sort key set for the session list. Mapped 1:1 to host columns.
enum SessionSortKey {
  lastActivity('Last activity'),
  displayName('Name'),
  runtimeState('Runtime'),
  attention('Attention');

  const SessionSortKey(this.label);
  final String label;
}

/// Closed filter key set. Mapped upstream.
enum SessionFilterKey {
  all('All sessions'),
  attention('Needs attention'),
  stopped('Stopped'),
  deleted('Deleted'),
  background('Background'),
  running('Running');

  const SessionFilterKey(this.label);
  final String label;

  bool matches(SessionSummaryData session) {
    switch (this) {
      case SessionFilterKey.all:
        return true;
      case SessionFilterKey.attention:
        return session.attention == SessionAttention.attention;
      case SessionFilterKey.stopped:
        return session.attention == SessionAttention.stopped ||
            session.runtime == SessionRuntime.stopped;
      case SessionFilterKey.deleted:
        return session.attention == SessionAttention.deleted ||
            session.runtime == SessionRuntime.deleted;
      case SessionFilterKey.background:
        return session.isBackground;
      case SessionFilterKey.running:
        return session.runtime.isRunning;
    }
  }
}

/// A single page of sessions after the upstream reducer has applied the
/// search/filter/sort and clipped to the page window. The widget never
/// re-implements search/filter/sort: it renders exactly what it is given.
@immutable
class SessionPage {
  const SessionPage({
    required this.items,
    required this.pageIndex,
    required this.pageSize,
    required this.totalMatching,
    required this.hasMore,
  });

  /// Sessions in this page, already sorted and filtered. The widget trusts
  /// the upstream ordering.
  final List<SessionSummaryData> items;

  /// 0-based page index.
  final int pageIndex;

  /// Page size used to produce this page. The widget does not change it.
  final int pageSize;

  /// Total number of sessions that matched the active filter and search.
  final int totalMatching;

  /// True when at least one more page exists.
  final bool hasMore;
}

/// Aggregate state of the three-session capacity. The widget shows a banner
/// when [active] reaches [maximum] and the user attempts to add another.
@immutable
class SessionCapacityState {
  const SessionCapacityState({
    required this.active,
    required this.maximum,
    required this.eligibleEviction,
    this.lruEvictionCandidateId,
  });

  /// Number of currently active (non-deleted) sessions. Bounded by
  /// [maximum].
  final int active;

  /// Hard cap from the host policy. M11 ships with 3.
  final int maximum;

  /// The set of session ids that are eligible for LRU eviction right now.
  /// A session is eligible only if it is backgrounded, idle, and has no
  /// unsaved draft. The widget must never invent additional victims.
  final List<String> eligibleEviction;

  /// The id of the LRU candidate the host picked, if any. The widget shows
  /// the no-victim message when this is null but [active] == [maximum].
  final String? lruEvictionCandidateId;

  bool get isAtCapacity => active >= maximum;
  bool get hasEvictionCandidate => lruEvictionCandidateId != null;
}

/// Closed set of observer-banner reasons. Mapped from the coordinator's
/// lease state. The banner always shows a Take control action.
enum ObserverReason {
  /// We are an observer because another client holds the controller lease.
  anotherClient,

  /// The connection was lost and we lost the lease; the host gave it to
  /// someone else.
  leaseLost,

  /// The session was started by another process and we never asked to be
  /// the controller.
  neverRequested,
}

/// Coordinator-free input to the session list widget.
@immutable
class SessionListViewData {
  const SessionListViewData({
    required this.page,
    required this.search,
    required this.filter,
    required this.sort,
    this.foregroundSessionId,
    this.attentionCount = 0,
  });

  final SessionPage page;

  /// Current search text. The widget only echoes it; it does not
  /// re-implement search.
  final String search;

  final SessionFilterKey filter;
  final SessionSortKey sort;

  /// The session the user is currently focused on (in another surface).
  final String? foregroundSessionId;

  /// How many sessions in the current filter set draw attention. The list
  /// shows this as a header chip; the widget does not count itself.
  final int attentionCount;

  bool get isEmpty => page.items.isEmpty;
}

/// Callback bundle for the session list. All callbacks are explicit so the
/// widget remains coordinator-free. `null` disables the affordance.
@immutable
class SessionListCallbacks {
  const SessionListCallbacks({
    this.onSearchChanged,
    this.onFilterChanged,
    this.onSortChanged,
    this.onPageChanged,
    this.onSessionSelected,
    this.onSessionSwitched,
    this.onTakeControl,
    this.onRestore,
    this.onPermanentDelete,
  });

  /// Called on every search keystroke (debounced upstream if needed).
  final ValueChanged<String>? onSearchChanged;

  final ValueChanged<SessionFilterKey>? onFilterChanged;
  final ValueChanged<SessionSortKey>? onSortChanged;

  /// Called when the user requests a new page (0-based).
  final ValueChanged<int>? onPageChanged;

  /// Called when the user taps a row to inspect it.
  final ValueChanged<SessionSummaryData>? onSessionSelected;

  /// Called when the user requests a controller switch to a session.
  final ValueChanged<SessionSummaryData>? onSessionSwitched;

  /// Called when the user requests to take control from the observer banner
  /// embedded in the list. The widget passes the session id it was rendered
  /// for.
  final ValueChanged<String>? onTakeControl;

  /// Restore a deleted session.
  final ValueChanged<SessionSummaryData>? onRestore;

  /// Permanently delete (purge) a deleted session.
  final ValueChanged<SessionSummaryData>? onPermanentDelete;
}

/// View data for the fast switcher. A smaller, dense surface than the full
/// list; the same row shape is reused so visual rules stay consistent.
@immutable
class SessionSwitcherViewData {
  const SessionSwitcherViewData({
    required this.sessions,
    required this.foregroundSessionId,
    this.maxVisible = 4,
  });

  /// Up to [maxVisible] sessions to render in the switcher. The upstream
  /// surface picks what is shown; the widget does not re-order or filter.
  final List<SessionSummaryData> sessions;

  final String? foregroundSessionId;

  /// The maximum number of rows the switcher is allowed to render. The
  /// widget does not paginate; it shows "more sessions" when truncated.
  final int maxVisible;
}

@immutable
class SessionSwitcherCallbacks {
  const SessionSwitcherCallbacks({
    this.onSwitch,
    this.onOpenFullList,
    this.onTakeControl,
  });

  final ValueChanged<SessionSummaryData>? onSwitch;

  /// Invoked when the user wants the full list (e.g. taps "Show all").
  final VoidCallback? onOpenFullList;

  final ValueChanged<SessionSummaryData>? onTakeControl;
}

/// View data for the observer banner. The widget always exposes a
/// confirmation step before invoking the take-control callback so a user
/// cannot accidentally steal a controller lease.
@immutable
class ObserverBannerViewData {
  const ObserverBannerViewData({
    required this.session,
    required this.reason,
    required this.controllerClientName,
  });

  final SessionSummaryData session;
  final ObserverReason reason;
  final String controllerClientName;
}

@immutable
class ObserverBannerCallbacks {
  const ObserverBannerCallbacks({this.onTakeControl, this.onDismiss});

  /// Invoked only after the user has confirmed via the accessible dialog.
  final ValueChanged<SessionSummaryData>? onTakeControl;

  /// Allows the user to dismiss the banner until the next state change.
  final ValueChanged<SessionSummaryData>? onDismiss;
}

/// Pure helpers that produce the banner copy. The widget uses these to
/// keep its build method free of business text.
class ObserverBannerText {
  const ObserverBannerText._();

  static String headline(ObserverReason reason) => switch (reason) {
    ObserverReason.anotherClient => 'You are observing this session',
    ObserverReason.leaseLost =>
      'Controller lease lost — another client is in control',
    ObserverReason.neverRequested =>
      'Started by another process — read-only observer',
  };

  static String detail(ObserverReason reason, String controller) =>
      switch (reason) {
        ObserverReason.anotherClient =>
          '$controller is currently the controller. You can read but not send '
              'commands until you take control.',
        ObserverReason.leaseLost =>
          'The connection was interrupted. $controller took over. You can '
              'take control back, but their in-flight draft will be preserved.',
        ObserverReason.neverRequested =>
          'You joined as an observer. Take control to send commands; their '
              'in-flight draft will be preserved.',
      };

  static const confirmTitle = 'Take control of this session?';
  static const confirmBody =
      'The current controller will be downgraded to observer. Their in-flight '
      'draft is preserved. You can switch back at any time.';
  static const confirmAffirm = 'Take control';
  static const confirmDecline = 'Stay observer';
  static const confirmAccessibilityHint =
      'Opens a confirmation dialog. Use the Cancel button to stay an '
      'observer, or the Take control button to switch controller.';
}
