import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../notifications/notification_controller.dart';
import '../theme/pi_theme.dart';
import 'activity_destination.dart';
import 'host_destination.dart';
import 'sessions_destination.dart';

/// Stable identifiers for the three bottom-bar destinations. Used both as the
/// `NavigationDestination` keys and by widget tests.
enum AppShellDestination { sessions, activity, host }

/// Product shell layout for paired Pi Mob clients.
///
/// - [Scaffold] with a contextual [AppBar] (sessions / activity / host)
///   whose leading widget is a small original Pi mark.
/// - A 3-destination Material 3 [NavigationBar] at the bottom.
/// - Side effects (notification sync, forget-host action, foreground service
///   toggle, live activity dispatch, dialog pumping, draft reconciliation,
///   pairing ordered alongside `_HomeRouter`) are preserved by the parent
///   widget that owns the coordinator and notification controller; the shell
///   itself is purely presentational and a thin glue between coordinator
///   state and the destination widgets.
///
/// Destination bodies are swapped on select rather than hidden inside an
/// `IndexedStack`, so scrollables inside each destination are bounded by the
/// freshly measured [SafeArea] + [MediaQuery] insets (notably keyboard). At
/// 360x755 and 200% text scale this layout keeps every destination inside
/// the bottom bar without nested scroll overflow.
class AppShell extends StatefulWidget {
  const AppShell({
    required this.coordinator,
    required this.endpointController,
    required this.draftController,
    required this.notifications,
    required this.onForgetHost,
    required this.onOpenDialog,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController endpointController;
  final TextEditingController draftController;
  final NotificationController? notifications;
  final Future<void> Function() onForgetHost;

  /// Invoked when the user wants to re-open the current extension dialog
  /// from the Activity destination's composer.
  final VoidCallback onOpenDialog;

  /// Selects an initial destination for callers that want to override the
  /// default behaviour (mostly tests). When null, the default selection is
  /// Activity when a session is selected, otherwise Sessions.
  static AppShellDestination resolveInitialDestination(
    ConnectionCoordinator coordinator, {
    AppShellDestination? override,
  }) {
    if (override != null) return override;
    return coordinator.selectedSessionId != null
        ? AppShellDestination.activity
        : AppShellDestination.sessions;
  }

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late AppShellDestination _destination;

  @override
  void initState() {
    super.initState();
    _destination = AppShellDestination.sessions;
    widget.coordinator.addListener(_onCoordinatorChanged);
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _ensureInitialDestination(),
    );
  }

  @override
  void didUpdateWidget(covariant AppShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_onCoordinatorChanged);
      widget.coordinator.addListener(_onCoordinatorChanged);
      _ensureInitialDestination();
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onCoordinatorChanged);
    super.dispose();
  }

  void _onCoordinatorChanged() {
    if (!mounted) return;
    setState(() {});
  }

  void _ensureInitialDestination() {
    if (AppShell.resolveInitialDestination(widget.coordinator) !=
        _destination) {
      setState(
        () => _destination = AppShell.resolveInitialDestination(
          widget.coordinator,
        ),
      );
    }
  }

  void _select(AppShellDestination destination) {
    if (_destination == destination) return;
    setState(() => _destination = destination);
  }

  String _titleFor(AppShellDestination destination) {
    switch (destination) {
      case AppShellDestination.sessions:
        return 'Sessions';
      case AppShellDestination.activity:
        final selected = _selectedSession();
        if (selected != null && selected.name.trim().isNotEmpty) {
          return selected.name;
        }
        return 'Activity';
      case AppShellDestination.host:
        return 'Host';
    }
  }

  SessionState? _selectedSession() {
    final selectedId = widget.coordinator.selectedSessionId;
    if (selectedId == null) return null;
    for (final session in widget.coordinator.sessions) {
      if (session.sessionId == selectedId) return session;
    }
    return null;
  }

  Widget _bodyFor(AppShellDestination destination) {
    switch (destination) {
      case AppShellDestination.sessions:
        return SessionsDestination(coordinator: widget.coordinator);
      case AppShellDestination.activity:
        return ActivityDestination(
          coordinator: widget.coordinator,
          draftController: widget.draftController,
          onOpenDialog: widget.onOpenDialog,
          onGoToSessions: () => _select(AppShellDestination.sessions),
        );
      case AppShellDestination.host:
        return HostDestination(
          coordinator: widget.coordinator,
          endpointController: widget.endpointController,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final colors = Theme.of(context).colorScheme;
    final semantic = context.piSemanticColors;
    final media = MediaQuery.of(context);
    final compactChrome =
        media.size.width < 480 || media.textScaler.scale(1) > 1.3;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: PiSpacing.sm,
        title: Row(
          children: [
            if (!compactChrome) ...[
              const _PiMark(),
              const SizedBox(width: PiSpacing.sm),
            ],
            Expanded(
              child: Text(
                _titleFor(_destination),
                key: const Key('shell-app-bar-title'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        actions: [
          if (widget.notifications case final notifications?) ...[
            ListenableBuilder(
              listenable: notifications,
              builder: (context, _) => IconButton(
                key: const Key('enable-notifications'),
                tooltip: notifications.enabled
                    ? 'Notifications enabled'
                    : 'Enable notifications',
                onPressed: notifications.enabled
                    ? null
                    : () => unawaited(notifications.enableByUserAction()),
                icon: Icon(
                  notifications.enabled
                      ? Icons.notifications_active
                      : Icons.notifications_none,
                ),
              ),
            ),
            if (notifications.adapter.platform == 'fcm')
              ListenableBuilder(
                listenable: notifications,
                builder: (context, _) => IconButton(
                  key: const Key('toggle-foreground-service'),
                  tooltip: notifications.foregroundServiceEnabled
                      ? 'Disable background status'
                      : 'Enable background status',
                  onPressed: notifications.enabled
                      ? () => unawaited(
                          notifications.setForegroundService(
                            !notifications.foregroundServiceEnabled,
                            appVisible: true,
                          ),
                        )
                      : null,
                  icon: Icon(
                    notifications.foregroundServiceEnabled
                        ? Icons.sync_disabled
                        : Icons.sync,
                  ),
                ),
              ),
          ],
          IconButton(
            key: const Key('forget-host-button'),
            tooltip: 'Forget this host and re-pair',
            onPressed: () => widget.onForgetHost(),
            icon: const Icon(Icons.link_off),
          ),
          if (!compactChrome)
            Padding(
              padding: const EdgeInsets.only(right: PiSpacing.md),
              child: Center(
                child: _ConnectionPhaseBadge(
                  isReady: coordinator.isReady,
                  phaseName: coordinator.phase.name,
                  semanticColor: coordinator.isReady
                      ? semantic.connectionReady
                      : semantic.connectionOffline,
                  onColor: colors.onSurface,
                  outline: colors.outlineVariant,
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        top: false,
        // Children are not wrapped in an IndexedStack: each destination owns
        // a single scrollable (or the Activity composite Column) and the
        // correct MediaQuery viewport is the one measured at the moment the
        // child was built.
        child: KeyedSubtree(
          key: ValueKey(_destination),
          child: _bodyFor(_destination),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _destination.index,
        onDestinationSelected: (index) =>
            _select(AppShellDestination.values[index]),
        destinations: const [
          NavigationDestination(
            key: Key('shell-sessions'),
            icon: Icon(Icons.list_alt_outlined),
            selectedIcon: Icon(Icons.list_alt),
            label: 'Sessions',
          ),
          NavigationDestination(
            key: Key('shell-activity'),
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'Activity',
          ),
          NavigationDestination(
            key: Key('shell-host'),
            icon: Icon(Icons.dns_outlined),
            selectedIcon: Icon(Icons.dns),
            label: 'Host',
          ),
        ],
      ),
    );
  }
}

/// Small original Pi mark for the [AppBar] leading slot.
///
/// A typographic mark ("π" on a rounded primary square). The intent is a
/// simple, calm identification that reads at 28dp and survives both light
/// and dark themes without external assets.
class _PiMark extends StatelessWidget {
  const _PiMark();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      width: 28,
      height: 28,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.primary,
          borderRadius: BorderRadius.circular(PiRadius.sm),
        ),
        child: const Center(
          child: Text(
            'π',
            style: TextStyle(
              color: Color(0xFFFFFFFF),
              fontWeight: FontWeight.w700,
              fontSize: 18,
              height: 1,
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact connection-phase pill rendered in the [AppBar] `actions` slot.
/// Hue uses [PiSemanticColors.connectionReady]/[connectionOffline] so the
/// status reads correctly under both light and dark themes.
class _ConnectionPhaseBadge extends StatelessWidget {
  const _ConnectionPhaseBadge({
    required this.isReady,
    required this.phaseName,
    required this.semanticColor,
    required this.onColor,
    required this.outline,
  });

  final bool isReady;
  final String phaseName;
  final Color semanticColor;
  final Color onColor;
  final Color outline;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('shell-connection-badge'),
      padding: const EdgeInsets.symmetric(
        horizontal: PiSpacing.sm,
        vertical: PiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: semanticColor.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(PiRadius.pill),
        border: Border.all(color: outline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: semanticColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: PiSpacing.sm),
          Text(
            isReady ? 'Ready' : phaseName,
            style: TextStyle(
              color: onColor,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
