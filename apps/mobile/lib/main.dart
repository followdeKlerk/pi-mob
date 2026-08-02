import 'dart:async';

import 'package:flutter/material.dart';

import 'src/connection/bridge_transport.dart';
import 'src/connection/connection_coordinator.dart';
import 'src/data/app_database.dart';
import 'src/interaction/interaction_panel.dart';
import 'src/notifications/notification_controller.dart';
import 'src/pairing/pairing_payload.dart';
import 'src/pairing/pairing_enrollment.dart';
import 'src/pairing/pairing_screen.dart';
import 'src/security/secure_credential_store.dart';
import 'src/ui/shell/app_shell.dart';
import 'src/ui/theme/pi_theme.dart';
import 'src/version.dart';

/// Starts the Pi Mob shell with an immediate first-frame placeholder so
/// cold launch never paints a blank screen while [ConnectionCoordinator] is
/// still reading durable state from the local database and reconnecting to
/// the bridge. The placeholder swaps in the real coordinator as soon as it
/// is ready, so the user sees progress from the very first frame.
Future<void> main() async {
  // Paint a placeholder immediately. `WidgetsFlutterBinding` is required
  // before the first `runApp`, but we hand the engine a tiny widget tree
  // first so the OS surface is never black between process start and the
  // first coordinator-driven rebuild.
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _BootPlaceholder());

  final database = AppDatabase();
  final secureCredentialStore = KeychainSecureCredentialStore();
  final coordinator = ConnectionCoordinator(
    transport: IoBridgeTransport(),
    database: database,
    secureCredentialStore: secureCredentialStore,
    onAuthRejection: (reason) {
      // TODO(l10n): show a sanitized re-pair card. The coordinator's phase
      // already carries the actionable reason; the UI subscribes to
      // `phase` and renders the card.
      debugPrint('[pi-mob][auth] bridge rejected auth: $reason');
    },
  );
  await coordinator.initialize();
  final notifications = NotificationController(
    adapter: MethodChannelNotificationAdapter(),
    deviceId: coordinator.installationId,
    appVersion: kMobileAppVersion,
    register: (platform, token) => coordinator.registerNotificationDevice(
      deviceId: coordinator.installationId,
      platform: platform,
      token: token,
      appVersion: kMobileAppVersion,
    ),
    reconcile: (sessionId) async {
      if (!coordinator.sessions.any(
        (session) => session.sessionId == sessionId,
      )) {
        return false;
      }
      await coordinator.selectSession(sessionId);
      return true;
    },
  );
  await notifications.initialize();
  // Hand control to the real app. The router rebuilds immediately to
  // reflect the paired host and current connection phase.
  runApp(PiMobApp(coordinator: coordinator, notifications: notifications));
}

/// Minimal placeholder rendered before [ConnectionCoordinator.initialize]
/// finishes. It paints the brand background, a small spinner and the same
/// "Preparing Pi Mob" copy the user will see at the bottom of the live
/// session sync screen — so the cold launch and the warm sync screen share
/// one visual language.
class _BootPlaceholder extends StatelessWidget {
  const _BootPlaceholder();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pi Mob',
      debugShowCheckedModeBanner: false,
      theme: piLightTheme(),
      darkTheme: piDarkTheme(),
      themeMode: ThemeMode.system,
      home: const _BootPlaceholderScreen(),
    );
  }
}

class _BootPlaceholderScreen extends StatelessWidget {
  const _BootPlaceholderScreen();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Scaffold(
      key: const Key('boot-placeholder-screen'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.terminal_rounded, size: 56, color: colors.primary),
                  const SizedBox(height: 16),
                  Text(
                    'Pi Mob',
                    key: const Key('boot-placeholder-title'),
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Preparing your local data and reconnecting to the bridge…',
                    key: const Key('boot-placeholder-message'),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(strokeWidth: 2.4),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PiMobApp extends StatelessWidget {
  const PiMobApp({required this.coordinator, this.notifications, super.key});

  final ConnectionCoordinator coordinator;
  final NotificationController? notifications;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pi Mob',
      debugShowCheckedModeBanner: false,
      theme: piLightTheme(),
      darkTheme: piDarkTheme(),
      themeMode: ThemeMode.system,
      home: _HomeRouter(coordinator: coordinator, notifications: notifications),
    );
  }
}

/// Routes between the pairing screen and the diagnostic home. When a host is
/// already paired (a hostId was loaded during coordinator initialization) the
/// diagnostic home is shown; otherwise the pairing screen is displayed. After
/// a successful pair, the app switches to the diagnostic home and provides a
/// visible "Forget host" action so the user can re-enter the pairing flow.
class _HomeRouter extends StatefulWidget {
  const _HomeRouter({required this.coordinator, this.notifications});

  final ConnectionCoordinator coordinator;
  final NotificationController? notifications;

  @override
  State<_HomeRouter> createState() => _HomeRouterState();
}

class _HomeRouterState extends State<_HomeRouter> {
  late bool _paired;

  @override
  void initState() {
    super.initState();
    _paired = widget.coordinator.hostId != null;
    widget.coordinator.addListener(_onCoordinatorChanged);
    if (widget.coordinator.isReady && widget.notifications != null) {
      unawaited(
        widget.notifications!.onBridgeReady(
          notificationsSupported: widget.coordinator.supportsCapability(
            'notifications.v1',
          ),
        ),
      );
    }
  }

  void _onCoordinatorChanged() {
    if (!mounted) return;
    final notifications = widget.notifications;
    if (widget.coordinator.isReady && notifications != null) {
      unawaited(
        notifications.onBridgeReady(
          notificationsSupported: widget.coordinator.supportsCapability(
            'notifications.v1',
          ),
        ),
      );
    }
    final nextPaired = widget.coordinator.hostId != null;
    if (nextPaired != _paired) {
      setState(() {
        _paired = nextPaired;
      });
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onCoordinatorChanged);
    super.dispose();
  }

  Future<void> _handlePair(PairingPayload payload) async {
    final secure = widget.coordinator.secureCredentialStore;
    if (secure == null) {
      throw const EnrollmentPairingException(
        'Secure credential storage is unavailable. Pairing cannot continue.',
      );
    }
    await completePairing(
      payload: payload,
      coordinator: widget.coordinator,
      enrollment: PairingEnrollmentService(secureCredentialStore: secure),
    );
    await widget.notifications?.refreshToken();
  }

  Future<void> _handleForget() async {
    final notifications = widget.notifications;
    if (notifications?.enabled == true) {
      try {
        await widget.coordinator.unregisterNotificationDevice(
          notifications!.deviceId,
        );
      } catch (_) {
        /* best effort when host is offline */
      }
    }
    notifications?.resetHostRegistration();
    await widget.coordinator.forgetHost();
  }

  @override
  Widget build(BuildContext context) {
    if (!_paired) {
      return PairingScreen(
        key: const ValueKey('pairing-screen'),
        onPair: _handlePair,
        onForgetHost: _handleForget,
        allowForgetWhenUnpaired: false,
      );
    }
    return DiagnosticHome(
      key: const ValueKey('diagnostic-home'),
      coordinator: widget.coordinator,
      notifications: widget.notifications,
      onForgetHost: _handleForget,
    );
  }
}

/// Thin wrapper around [AppShell] that owns the connection-scoped side
/// effects: drafting, dialog presentation, live-activity dispatch.
///
/// The actual surface — sessions / activity / host destinations, app bar,
/// navigation bar — lives in the [AppShell] widget. Keeping this wrapper
/// here preserves the diagnostic `Key('diagnostic-home')` and the public
/// `DiagnosticHome` symbol that downstream widget tests rely on, even
/// though the implementation now lives in the shell module.
class DiagnosticHome extends StatefulWidget {
  const DiagnosticHome({
    required this.coordinator,
    required this.onForgetHost,
    this.notifications,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final NotificationController? notifications;
  final Future<void> Function() onForgetHost;

  @override
  State<DiagnosticHome> createState() => _DiagnosticHomeState();
}

class _DiagnosticHomeState extends State<DiagnosticHome> {
  late final TextEditingController _endpointController;
  late final TextEditingController _draftController;
  String? _presentedDialogId;

  @override
  void initState() {
    super.initState();
    _endpointController = TextEditingController(
      text: widget.coordinator.endpoint?.toString() ?? '',
    );
    _draftController = TextEditingController(text: widget.coordinator.draft);
    widget.coordinator.addListener(_coordinatorChanged);
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _presentDialogIfNeeded(),
    );
  }

  @override
  void didUpdateWidget(covariant DiagnosticHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_coordinatorChanged);
      widget.coordinator.addListener(_coordinatorChanged);
      _coordinatorChanged();
    }
  }

  void _coordinatorChanged() {
    if (!mounted) return;
    final remoteDraft = widget.coordinator.draft;
    if (_draftController.text != remoteDraft) {
      _draftController.value = TextEditingValue(
        text: remoteDraft,
        selection: TextSelection.collapsed(offset: remoteDraft.length),
      );
    }
    final notifications = widget.notifications;
    final sessionId = widget.coordinator.selectedSessionId;
    final status = widget.coordinator.selectedRuntimeState;
    if (notifications?.adapter.platform == 'apns' &&
        sessionId != null &&
        status != null) {
      if (status == 'idle' || status == 'stopped') {
        unawaited(notifications!.adapter.endLiveActivity(sessionId));
      } else {
        unawaited(
          notifications!.adapter.updateLiveActivity(
            sessionId: sessionId,
            status: status,
            staleAt: DateTime.now().toUtc().add(const Duration(minutes: 5)),
          ),
        );
      }
    }
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _presentDialogIfNeeded(),
    );
  }

  Future<void> _presentDialogIfNeeded({bool force = false}) async {
    if (!mounted) return;
    final dialog = widget.coordinator.selectedDialog;
    if (dialog == null || (!force && _presentedDialogId == dialog.dialogId)) {
      return;
    }
    _presentedDialogId = dialog.dialogId;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: SingleChildScrollView(
          child: ExtensionDialogPanel(
            dialog: dialog,
            now: DateTime.now,
            onRespond:
                ({String? value, bool? confirmed, bool cancelled = false}) {
                  unawaited(
                    widget.coordinator.respondToDialog(
                      dialogId: dialog.dialogId,
                      value: value,
                      confirmed: confirmed,
                      cancelled: cancelled,
                    ),
                  );
                  Navigator.of(sheetContext).pop();
                },
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_coordinatorChanged);
    _endpointController.dispose();
    _draftController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      coordinator: widget.coordinator,
      endpointController: _endpointController,
      draftController: _draftController,
      notifications: widget.notifications,
      onForgetHost: widget.onForgetHost,
      onOpenDialog: () => _presentDialogIfNeeded(force: true),
    );
  }
}
