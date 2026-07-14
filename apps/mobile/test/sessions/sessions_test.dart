import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/sessions/session_badges.dart';
import 'package:pi_mob/src/sessions/session_capacity_notice.dart';
import 'package:pi_mob/src/sessions/session_list_view.dart';
import 'package:pi_mob/src/sessions/session_switcher.dart';
import 'package:pi_mob/src/sessions/session_view_data.dart';
import 'package:pi_mob/src/sessions/observer_banner.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

SessionSummaryData _session({
  required String id,
  String name = 'Session',
  SessionAttention attention = SessionAttention.none,
  SessionBackground background = SessionBackground.foreground,
  int unread = 0,
  bool isController = false,
  bool hasDraft = false,
  SessionRuntime runtime = SessionRuntime.idle,
  String? workspace = 'Mobile',
}) {
  return SessionSummaryData(
    sessionId: id,
    displayName: name,
    workspaceLabel: workspace,
    runtime: runtime,
    attention: attention,
    background: background,
    unreadCount: unread,
    isController: isController,
    hasUnsavedDraft: hasDraft,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SessionViewData', () {
    test('SessionRuntime equality and known set', () {
      expect(SessionRuntime.idle, SessionRuntime.idle);
      expect(SessionRuntime.idle == SessionRuntime.idle, isTrue);
      expect(SessionRuntime.known.contains('running'), isTrue);
      expect(SessionRuntime.known.contains('mystery'), isFalse);
    });

    test('SessionFilterKey.matches honors each branch', () {
      final idle = _session(id: 'a');
      final att = _session(id: 'b', attention: SessionAttention.attention);
      final stopped = _session(id: 'c', attention: SessionAttention.stopped);
      final deleted = _session(id: 'd', attention: SessionAttention.deleted);
      final bg = _session(id: 'e', background: SessionBackground.background);
      final running = _session(id: 'f', runtime: SessionRuntime.running);
      expect(SessionFilterKey.all.matches(idle), isTrue);
      expect(SessionFilterKey.attention.matches(att), isTrue);
      expect(SessionFilterKey.attention.matches(idle), isFalse);
      expect(SessionFilterKey.stopped.matches(stopped), isTrue);
      expect(SessionFilterKey.deleted.matches(deleted), isTrue);
      expect(SessionFilterKey.background.matches(bg), isTrue);
      expect(SessionFilterKey.background.matches(idle), isFalse);
      expect(SessionFilterKey.running.matches(running), isTrue);
    });

    test('isUnread requires unread count > 0', () {
      final u = _session(
        id: 'u',
        background: SessionBackground.unread,
        unread: 4,
      );
      final uZero = _session(id: 'u0', background: SessionBackground.unread);
      expect(u.isUnread, isTrue);
      expect(uZero.isUnread, isFalse);
    });

    test('ObserverBannerText.detail is branch-coverage complete', () {
      for (final r in ObserverReason.values) {
        final text = ObserverBannerText.detail(r, 'Other iPad');
        // neverRequested has no specific controller; every other branch
        // must mention the controller by name.
        if (r == ObserverReason.neverRequested) {
          expect(text, isNotEmpty);
        } else {
          expect(text, contains('Other iPad'));
        }
      }
    });
  });

  group('SessionBadges', () {
    testWidgets('attention + unread + controller + draft render together', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          SessionBadges(
            session: _session(
              id: 'a',
              attention: SessionAttention.attention,
              background: SessionBackground.unread,
              unread: 7,
              isController: true,
              hasDraft: true,
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('session-badge-attention')), findsOneWidget);
      expect(find.byKey(const Key('session-badge-unread')), findsOneWidget);
      expect(find.byKey(const Key('session-badge-controller')), findsOneWidget);
      expect(find.byKey(const Key('session-badge-draft')), findsOneWidget);
    });

    testWidgets('stopped vs deleted render distinct pills', (tester) async {
      await tester.pumpWidget(
        _wrap(
          SessionBadges(
            session: _session(id: 's', attention: SessionAttention.stopped),
          ),
        ),
      );
      expect(find.byKey(const Key('session-badge-stopped')), findsOneWidget);
      expect(find.byKey(const Key('session-badge-deleted')), findsNothing);

      await tester.pumpWidget(
        _wrap(
          SessionBadges(
            session: _session(id: 'd', attention: SessionAttention.deleted),
          ),
        ),
      );
      expect(find.byKey(const Key('session-badge-deleted')), findsOneWidget);
      expect(find.byKey(const Key('session-badge-stopped')), findsNothing);
    });

    testWidgets('renders at 200% text scale without overflow', (tester) async {
      await tester.pumpWidget(
        _wrap(
          MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
            child: SingleChildScrollView(
              child: SizedBox(
                width: 600,
                child: SessionBadges(
                  session: _session(
                    id: 'a',
                    attention: SessionAttention.attention,
                    background: SessionBackground.unread,
                    unread: 12,
                    isController: true,
                    hasDraft: true,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('SessionListView', () {
    SessionListViewData pageData(List<SessionSummaryData> items) {
      return SessionListViewData(
        page: SessionPage(
          items: items,
          pageIndex: 0,
          pageSize: 5,
          totalMatching: items.length,
          hasMore: false,
        ),
        search: '',
        filter: SessionFilterKey.all,
        sort: SessionSortKey.lastActivity,
        foregroundSessionId: items.isEmpty ? null : items.first.sessionId,
        attentionCount: items
            .where((s) => s.attention == SessionAttention.attention)
            .length,
      );
    }

    testWidgets('renders rows, badges, and pagination status', (tester) async {
      var switchedTo = '';
      await tester.pumpWidget(
        _wrap(
          SizedBox(
            width: 400,
            height: 700,
            child: SessionListView(
              data: pageData([
                _session(
                  id: '1',
                  name: 'Investigate',
                  attention: SessionAttention.attention,
                ),
                _session(
                  id: '2',
                  name: 'Standup',
                  background: SessionBackground.unread,
                  unread: 3,
                ),
              ]),
              callbacks: SessionListCallbacks(
                onSessionSwitched: (s) => switchedTo = s.sessionId,
                onTakeControl: (_) {},
              ),
              capacity: const SessionCapacityState(
                active: 2,
                maximum: 3,
                eligibleEviction: [],
              ),
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('session-list-title')), findsOneWidget);
      expect(find.byKey(const Key('session-list-count')), findsOneWidget);
      expect(
        find.byKey(const Key('session-list-attention-chip')),
        findsOneWidget,
      );
      expect(find.text('Investigate'), findsOneWidget);
      expect(find.text('Standup'), findsOneWidget);
      expect(find.byKey(const Key('session-page-status')), findsOneWidget);
      await tester.tap(find.byKey(const Key('session-switch-2')));
      expect(switchedTo, '2');
    });

    testWidgets('search callback fires on keystroke', (tester) async {
      final queries = <String>[];
      await tester.pumpWidget(
        _wrap(
          SizedBox(
            width: 400,
            height: 600,
            child: SessionListView(
              data: pageData([_session(id: '1', name: 'Investigate')]),
              callbacks: SessionListCallbacks(
                onSearchChanged: queries.add,
                onTakeControl: (_) {},
              ),
              capacity: const SessionCapacityState(
                active: 1,
                maximum: 3,
                eligibleEviction: [],
              ),
            ),
          ),
        ),
      );
      await tester.enterText(find.byKey(const Key('session-search')), 'inv');
      await tester.pump();
      expect(queries, contains('inv'));
    });

    testWidgets('add at capacity with no victim shows notice', (tester) async {
      await tester.pumpWidget(
        _wrap(
          SizedBox(
            width: 400,
            height: 700,
            child: SessionListView(
              data: pageData([_session(id: '1', hasDraft: true)]),
              callbacks: const SessionListCallbacks(
                onTakeControl: _AlwaysNoopCallback.call,
              ),
              capacity: const SessionCapacityState(
                active: 3,
                maximum: 3,
                eligibleEviction: [],
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('session-add')));
      await tester.pump();
      expect(find.byKey(const Key('session-capacity-notice')), findsOneWidget);
      expect(
        find.textContaining('All three sessions have unsaved work'),
        findsOneWidget,
      );
    });

    testWidgets('renders at 200% text scale without overflow', (tester) async {
      await tester.pumpWidget(
        _wrap(
          MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
            child: SingleChildScrollView(
              child: SizedBox(
                width: 900,
                height: 1600,
                child: SessionListView(
                  data: pageData([
                    _session(
                      id: '1',
                      name: 'Long session name for wrapping',
                      attention: SessionAttention.attention,
                      background: SessionBackground.unread,
                      unread: 12,
                      hasDraft: true,
                      isController: true,
                    ),
                    _session(
                      id: '2',
                      name: 'Stopped',
                      runtime: SessionRuntime.stopped,
                    ),
                    _session(
                      id: '3',
                      name: 'Trashed',
                      attention: SessionAttention.deleted,
                    ),
                  ]),
                  callbacks: const SessionListCallbacks(
                    onTakeControl: _AlwaysNoopCallback.call,
                  ),
                  capacity: const SessionCapacityState(
                    active: 3,
                    maximum: 3,
                    eligibleEviction: ['1'],
                    lruEvictionCandidateId: '1',
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('SessionSwitcher', () {
    testWidgets('shows foreground selection and unread dot', (tester) async {
      SessionSummaryData? tapped;
      await tester.pumpWidget(
        _wrap(
          SessionSwitcher(
            data: SessionSwitcherViewData(
              sessions: [
                _session(
                  id: '1',
                  name: 'Investigate',
                  background: SessionBackground.unread,
                  unread: 2,
                ),
                _session(id: '2', name: 'Standup'),
              ],
              foregroundSessionId: '2',
              maxVisible: 4,
            ),
            callbacks: SessionSwitcherCallbacks(onSwitch: (s) => tapped = s),
          ),
        ),
      );
      expect(find.byKey(const Key('session-switcher')), findsOneWidget);
      expect(find.byKey(const Key('switcher-unread-1')), findsOneWidget);
      expect(find.byKey(const Key('switcher-row-1')), findsOneWidget);
      await tester.tap(find.byKey(const Key('switcher-row-1')));
      expect(tapped?.sessionId, '1');
    });

    testWidgets('overflow exposes Show all affordance', (tester) async {
      var opened = false;
      await tester.pumpWidget(
        _wrap(
          SessionSwitcher(
            data: SessionSwitcherViewData(
              sessions: [
                for (var i = 0; i < 6; i++) _session(id: 's$i', name: 'S$i'),
              ],
              foregroundSessionId: null,
              maxVisible: 3,
            ),
            callbacks: SessionSwitcherCallbacks(
              onOpenFullList: () => opened = true,
            ),
          ),
        ),
      );
      expect(
        find.byKey(const Key('session-switcher-overflow')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('session-switcher-overflow')));
      expect(opened, isTrue);
    });
  });

  group('ObserverBanner', () {
    testWidgets('confirmation dialog must be confirmed to fire callback', (
      tester,
    ) async {
      SessionSummaryData? taken;
      await tester.pumpWidget(
        _wrap(
          ObserverBanner(
            data: ObserverBannerViewData(
              session: _session(id: 'o', name: 'Other session'),
              reason: ObserverReason.anotherClient,
              controllerClientName: "Nathan's iPad",
            ),
            callbacks: ObserverBannerCallbacks(onTakeControl: (s) => taken = s),
          ),
        ),
      );
      expect(find.byKey(const Key('observer-banner')), findsOneWidget);
      await tester.tap(find.byKey(const Key('observer-take-control')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('observer-take-control-dialog')),
        findsOneWidget,
      );
      // Cancel first; callback must NOT fire.
      await tester.tap(find.byKey(const Key('observer-take-control-cancel')));
      await tester.pumpAndSettle();
      expect(taken, isNull);
      // Re-open and confirm.
      await tester.tap(find.byKey(const Key('observer-take-control')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('observer-take-control-confirm')));
      await tester.pumpAndSettle();
      expect(taken?.sessionId, 'o');
    });

    testWidgets('dismiss callback fires on Dismiss', (tester) async {
      SessionSummaryData? dismissed;
      await tester.pumpWidget(
        _wrap(
          ObserverBanner(
            data: ObserverBannerViewData(
              session: _session(id: 'o'),
              reason: ObserverReason.leaseLost,
              controllerClientName: 'Mac',
            ),
            callbacks: ObserverBannerCallbacks(onDismiss: (s) => dismissed = s),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('observer-dismiss')));
      expect(dismissed?.sessionId, 'o');
    });
  });

  group('SessionCapacityNotice', () {
    testWidgets('no-victim copy appears when eligible list is empty', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const SessionCapacityNotice(
            capacity: SessionCapacityState(
              active: 3,
              maximum: 3,
              eligibleEviction: [],
            ),
          ),
        ),
      );
      expect(
        find.textContaining('All three sessions have unsaved work'),
        findsOneWidget,
      );
    });

    testWidgets('LRU candidate copy appears with action', (tester) async {
      var inspected = false;
      await tester.pumpWidget(
        _wrap(
          SessionCapacityNotice(
            capacity: const SessionCapacityState(
              active: 3,
              maximum: 3,
              eligibleEviction: ['1'],
              lruEvictionCandidateId: '1',
            ),
            onInspectCandidate: () => inspected = true,
          ),
        ),
      );
      expect(
        find.textContaining('least-recently-used idle session'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('session-capacity-inspect')));
      expect(inspected, isTrue);
    });

    testWidgets('renders at 200% text scale without overflow', (tester) async {
      await tester.pumpWidget(
        _wrap(
          MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
            child: const SingleChildScrollView(
              child: SizedBox(
                width: 320,
                child: SessionCapacityNotice(
                  capacity: SessionCapacityState(
                    active: 3,
                    maximum: 3,
                    eligibleEviction: [],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });
}

class _AlwaysNoopCallback {
  static void call(Object _) {}
}
