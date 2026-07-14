/// M11 multi-session directory: paginated session summaries with search,
/// filter, sort, and attention (unread/needs-attention) states.
///
/// This module is **mobile-domain only**: it has no widget, transport, or
/// storage dependencies. The coordinator owns the live `SessionState`
/// records, persists summary rows through `AppDatabase`, and feeds this
/// state to UI code. Keeping the directory as a pure value type means
/// pagination, search, filter, and sort are deterministic in tests and
/// can be reused for the future host-dashboard refresh.
library;

/// Distinct attention states the host reports on a session summary. The
/// mobile surface treats any non-`none` value as a badge and never
/// auto-clears: the user dismisses the badge by opening the session,
/// which the coordinator observes to flip the state to `none`.
enum SessionAttentionState {
  /// No badge. The default for freshly observed sessions.
  none,

  /// The session has produced new activity since the user last opened it.
  /// Displayed as the round "unread" dot on the session row.
  unread,

  /// The session requires explicit user action: crashed, waiting for
  /// input, retry-wait, or the controller was lost/taken-over. Displayed
  /// as an attention glyph and survives app restart.
  needsAttention,

  /// The session is running in the background without user input. A
  /// distinct badge so the UI can render a different glyph without
  /// confusing it with the unread dot.
  background,
}

SessionAttentionState sessionAttentionFromWire(Object? value) {
  if (value is! String) return SessionAttentionState.none;
  switch (value) {
    case 'unread':
      return SessionAttentionState.unread;
    case 'needs_attention':
      return SessionAttentionState.needsAttention;
    case 'background':
      return SessionAttentionState.background;
    case 'none':
    case '':
      return SessionAttentionState.none;
    default:
      return SessionAttentionState.none;
  }
}

String sessionAttentionWire(SessionAttentionState state) => switch (state) {
  SessionAttentionState.none => 'none',
  SessionAttentionState.unread => 'unread',
  SessionAttentionState.needsAttention => 'needs_attention',
  SessionAttentionState.background => 'background',
};

/// Stable sort modes for the directory. Sort is *non-destructive*: the
/// underlying host order (`natural`) is the source of truth and the
/// directory re-applies the sort when the user changes it.
enum SessionSort { natural, name, lastActivity, runtime, attention }

String sessionSortLabel(SessionSort sort) => switch (sort) {
  SessionSort.natural => 'Host order',
  SessionSort.name => 'Name',
  SessionSort.lastActivity => 'Last activity',
  SessionSort.runtime => 'Runtime state',
  SessionSort.attention => 'Attention',
};

/// Filter facets the directory understands. Filters compose with `AND`.
final class SessionFilter {
  const SessionFilter({
    this.query = '',
    this.runtimeStates = const <String>{},
    this.attentionStates = const <SessionAttentionState>{},
    this.controllerModes = const <String>{},
  });

  final String query;
  final Set<String> runtimeStates;
  final Set<SessionAttentionState> attentionStates;
  final Set<String> controllerModes;

  bool get isEmpty =>
      query.isEmpty &&
      runtimeStates.isEmpty &&
      attentionStates.isEmpty &&
      controllerModes.isEmpty;

  SessionFilter copyWith({
    String? query,
    Set<String>? runtimeStates,
    Set<SessionAttentionState>? attentionStates,
    Set<String>? controllerModes,
  }) => SessionFilter(
    query: query ?? this.query,
    runtimeStates: runtimeStates ?? this.runtimeStates,
    attentionStates: attentionStates ?? this.attentionStates,
    controllerModes: controllerModes ?? this.controllerModes,
  );

  @override
  bool operator ==(Object other) =>
      other is SessionFilter &&
      other.query == query &&
      _setEq(other.runtimeStates, runtimeStates) &&
      _setEq(other.attentionStates, attentionStates) &&
      _setEq(other.controllerModes, controllerModes);

  @override
  int get hashCode => Object.hash(
    query,
    Object.hashAllUnordered(runtimeStates),
    Object.hashAllUnordered(attentionStates),
    Object.hashAllUnordered(controllerModes),
  );
}

bool _setEq<T>(Set<T> a, Set<T> b) {
  if (a.length != b.length) return false;
  for (final v in a) {
    if (!b.contains(v)) return false;
  }
  return true;
}

/// One row in the directory. Derived from a [SessionState] plus a
/// computed attention value. The directory never stores a copy of the
/// session payload — it stores a key and the host-reported summary.
final class SessionSummary {
  const SessionSummary({
    required this.sessionId,
    required this.name,
    required this.runtimeState,
    required this.workspaceId,
    required this.attention,
    required this.controllerMode,
    required this.queueDepth,
    required this.lastActivityAt,
    this.unreadCount = 0,
  });

  final String sessionId;
  final String name;
  final String runtimeState;
  final String? workspaceId;
  final SessionAttentionState attention;
  final String controllerMode;
  final int queueDepth;
  final int unreadCount;
  final DateTime? lastActivityAt;

  SessionSummary copyWith({
    String? name,
    String? runtimeState,
    String? workspaceId,
    SessionAttentionState? attention,
    String? controllerMode,
    int? queueDepth,
    int? unreadCount,
    DateTime? lastActivityAt,
  }) => SessionSummary(
    sessionId: sessionId,
    name: name ?? this.name,
    runtimeState: runtimeState ?? this.runtimeState,
    workspaceId: workspaceId ?? this.workspaceId,
    attention: attention ?? this.attention,
    controllerMode: controllerMode ?? this.controllerMode,
    queueDepth: queueDepth ?? this.queueDepth,
    unreadCount: unreadCount ?? this.unreadCount,
    lastActivityAt: lastActivityAt ?? this.lastActivityAt,
  );
}

/// A single page of directory rows plus the cursor the UI passes to the
/// next page request. `nextCursor == null` means the user has reached the
/// end. The directory is *bounded* — the host returns at most the limit.
final class SessionPage {
  const SessionPage({
    required this.rows,
    required this.nextCursor,
    required this.totalApproximate,
  });

  final List<SessionSummary> rows;

  /// Opaque, host-issued. The mobile client echoes it back; it never
  /// interprets or reconstructs it.
  final String? nextCursor;

  /// Best-effort total count for "showing N of M" affordances. May be
  /// `null` when the host declines to estimate.
  final int? totalApproximate;

  bool get hasMore => nextCursor != null;
}

/// One-page projection of the directory with active filter/sort applied.
/// Use [SessionDirectory.fromSummaries] to construct; apply a new
/// filter/sort to obtain a new projection; slice with [page] to get
/// rows for the active page.
final class SessionDirectory {
  SessionDirectory({
    required List<SessionSummary> all,
    required this.filter,
    required this.sort,
    required this.pageSize,
    required this.pageOffset,
  }) : _all = List<SessionSummary>.unmodifiable(all),
       filtered = List<SessionSummary>.unmodifiable(_applyFilter(all, filter)),
       sorted = List<SessionSummary>.unmodifiable(
         _applySort(_applyFilter(all, filter), sort),
       );

  factory SessionDirectory.fromSummaries(
    Iterable<SessionSummary> summaries, {
    SessionFilter filter = const SessionFilter(),
    SessionSort sort = SessionSort.natural,
    int pageSize = 25,
    int pageOffset = 0,
  }) => SessionDirectory(
    all: summaries.toList(growable: false),
    filter: filter,
    sort: sort,
    pageSize: pageSize,
    pageOffset: pageOffset,
  );

  final List<SessionSummary> _all;
  final List<SessionSummary> filtered;
  final List<SessionSummary> sorted;
  final SessionFilter filter;
  final SessionSort sort;
  final int pageSize;
  final int pageOffset;

  int get totalFiltered => filtered.length;

  SessionPage page() {
    if (pageSize < 1) {
      throw RangeError.range(pageSize, 1, 1 << 20, 'pageSize');
    }
    if (pageOffset < 0) {
      throw RangeError.range(pageOffset, 0, 1 << 31, 'pageOffset');
    }
    final start = pageOffset;
    if (start >= sorted.length) {
      return SessionPage(
        rows: const <SessionSummary>[],
        nextCursor: null,
        totalApproximate: sorted.length,
      );
    }
    final end = (start + pageSize).clamp(0, sorted.length);
    final rows = sorted.sublist(start, end);
    return SessionPage(
      rows: rows,
      nextCursor: end < sorted.length ? 'offset:$end' : null,
      totalApproximate: sorted.length,
    );
  }

  SessionDirectory withFilter(SessionFilter next) => SessionDirectory(
    all: _all,
    filter: next,
    sort: sort,
    pageSize: pageSize,
    pageOffset: 0,
  );

  SessionDirectory withSort(SessionSort next) => SessionDirectory(
    all: _all,
    filter: filter,
    sort: next,
    pageSize: pageSize,
    pageOffset: 0,
  );

  SessionDirectory withPage(int offset) => SessionDirectory(
    all: _all,
    filter: filter,
    sort: sort,
    pageSize: pageSize,
    pageOffset: offset,
  );

  static List<SessionSummary> _applyFilter(
    Iterable<SessionSummary> source,
    SessionFilter filter,
  ) {
    if (filter.isEmpty) return source.toList();
    final query = filter.query.trim().toLowerCase();
    return source
        .where((row) {
          if (query.isNotEmpty) {
            final hay = '${row.name}\n${row.runtimeState}'.toLowerCase();
            if (!hay.contains(query)) return false;
          }
          if (filter.runtimeStates.isNotEmpty &&
              !filter.runtimeStates.contains(row.runtimeState)) {
            return false;
          }
          if (filter.attentionStates.isNotEmpty &&
              !filter.attentionStates.contains(row.attention)) {
            return false;
          }
          if (filter.controllerModes.isNotEmpty &&
              !filter.controllerModes.contains(row.controllerMode)) {
            return false;
          }
          return true;
        })
        .toList(growable: false);
  }

  static List<SessionSummary> _applySort(
    List<SessionSummary> rows,
    SessionSort sort,
  ) {
    final copy = List<SessionSummary>.of(rows);
    int cmp(SessionSummary a, SessionSummary b) {
      switch (sort) {
        case SessionSort.natural:
          return 0;
        case SessionSort.name:
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case SessionSort.lastActivity:
          final aa = a.lastActivityAt;
          final bb = b.lastActivityAt;
          if (aa == null && bb == null) return 0;
          if (aa == null) return 1;
          if (bb == null) return -1;
          return bb.compareTo(aa);
        case SessionSort.runtime:
          return a.runtimeState.compareTo(b.runtimeState);
        case SessionSort.attention:
          return b.attention.index.compareTo(a.attention.index);
      }
    }

    copy.sort(cmp);
    return copy;
  }
}
