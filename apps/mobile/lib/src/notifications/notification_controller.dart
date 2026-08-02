import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum NotificationPermission { notDetermined, denied, authorized }

abstract interface class NotificationPlatformAdapter {
  String get platform;
  Future<NotificationPermission> permissionStatus();
  Future<NotificationPermission> requestPermission();
  Future<String?> currentToken();
  Stream<String> get tokenChanges;
  Stream<Uri> get notificationTaps;
  Future<void> openNotificationSettings();
  Future<void> setForegroundServiceEnabled(
    bool enabled, {
    required bool appVisible,
  });
  Future<void> updateLiveActivity({
    required String sessionId,
    required String status,
    required DateTime staleAt,
  });
  Future<void> endLiveActivity(String sessionId);
  Future<void> cleanupStaleActivities(DateTime now);
}

class MethodChannelNotificationAdapter implements NotificationPlatformAdapter {
  MethodChannelNotificationAdapter({
    MethodChannel? channel,
    EventChannel? tokenEvents,
    EventChannel? tapEvents,
  }) : _channel = channel ?? const MethodChannel('pi-mob/notifications'),
       _tokenEvents =
           tokenEvents ?? const EventChannel('pi-mob/notification_tokens'),
       _tapEvents = tapEvents ?? const EventChannel('pi-mob/notification_taps');
  final MethodChannel _channel;
  final EventChannel _tokenEvents;
  final EventChannel _tapEvents;
  @override
  String get platform =>
      defaultTargetPlatform == TargetPlatform.iOS ? 'apns' : 'fcm';
  @override
  Future<NotificationPermission> permissionStatus() =>
      _permission('permissionStatus');
  @override
  Future<NotificationPermission> requestPermission() =>
      _permission('requestPermission');
  Future<NotificationPermission> _permission(String method) async {
    final value = await _channel.invokeMethod<String>(method);
    return NotificationPermission.values.firstWhere(
      (item) => item.name == value,
      orElse: () => NotificationPermission.notDetermined,
    );
  }

  @override
  Future<String?> currentToken() =>
      _channel.invokeMethod<String>('currentToken');
  @override
  Stream<String> get tokenChanges => _tokenEvents
      .receiveBroadcastStream()
      .where((value) => value is String)
      .cast<String>();
  @override
  Stream<Uri> get notificationTaps => _tapEvents
      .receiveBroadcastStream()
      .where((value) => value is String)
      .cast<String>()
      .map(Uri.parse);
  @override
  Future<void> openNotificationSettings() =>
      _channel.invokeMethod('openNotificationSettings');

  @override
  Future<void> setForegroundServiceEnabled(
    bool enabled, {
    required bool appVisible,
  }) => _channel.invokeMethod('setForegroundService', {
    'enabled': enabled,
    'appVisible': appVisible,
  });
  @override
  Future<void> updateLiveActivity({
    required String sessionId,
    required String status,
    required DateTime staleAt,
  }) => _channel.invokeMethod('updateLiveActivity', {
    'sessionId': sessionId,
    'status': status,
    'staleAt': staleAt.toUtc().toIso8601String(),
  });
  @override
  Future<void> endLiveActivity(String sessionId) =>
      _channel.invokeMethod('endLiveActivity', {'sessionId': sessionId});
  @override
  Future<void> cleanupStaleActivities(DateTime now) => _channel.invokeMethod(
    'cleanupStaleActivities',
    {'now': now.toUtc().toIso8601String()},
  );
}

class NotificationController extends ChangeNotifier {
  NotificationController({
    required this.adapter,
    required this.register,
    required this.reconcile,
    required this.deviceId,
    required this.appVersion,
  });
  final NotificationPlatformAdapter adapter;
  final Future<void> Function(String platform, String token) register;
  final Future<bool> Function(String sessionId) reconcile;
  final String deviceId;
  final String appVersion;
  StreamSubscription<String>? _tokenSub;
  StreamSubscription<Uri>? _tapSub;
  String? _pendingToken;
  String? _registeredToken;
  Future<void>? _tokenSync;
  Future<void>? _enrollment;
  bool _automaticPermissionPrompted = false;
  bool? _bridgeNotificationsSupported;
  NotificationPermission permission = NotificationPermission.notDetermined;
  bool enabled = false;
  bool tokenAvailable = false;
  bool foregroundServiceEnabled = false;
  String? lastReconciledSession;
  Future<void> initialize() async {
    permission = await adapter.permissionStatus();
    _tokenSub = adapter.tokenChanges.listen(
      (token) => unawaited(_acceptToken(token)),
    );
    _tapSub = adapter.notificationTaps.listen(
      (uri) => unawaited(handleTap(uri)),
    );
    await adapter.cleanupStaleActivities(DateTime.now().toUtc());
    notifyListeners();
  }

  Future<void> enableByUserAction() async {
    permission = await adapter.requestPermission();
    enabled = permission == NotificationPermission.authorized;
    if (enabled) {
      await refreshToken();
      enabled = tokenAvailable;
    }
    notifyListeners();
  }

  /// Enrolls this installation after the bridge advertises remote
  /// notifications. A process requests permission at most once; reconnects
  /// still refresh the real token and retry registration when needed.
  Future<void> onBridgeReady({required bool notificationsSupported}) {
    _bridgeNotificationsSupported = notificationsSupported;
    if (!notificationsSupported) return Future<void>.value();
    final active = _enrollment;
    if (active != null) return active;
    final future = _enrollAutomatically();
    _enrollment = future;
    return future.whenComplete(() {
      if (identical(_enrollment, future)) _enrollment = null;
    });
  }

  Future<void> _enrollAutomatically() async {
    permission = await adapter.permissionStatus();
    if (permission == NotificationPermission.notDetermined &&
        !_automaticPermissionPrompted) {
      _automaticPermissionPrompted = true;
      permission = await adapter.requestPermission();
    }
    enabled = permission == NotificationPermission.authorized;
    if (enabled) {
      await refreshToken();
      enabled = tokenAvailable;
    }
    notifyListeners();
  }

  /// Reloads the platform token after pairing a different host. A token is
  /// scoped to the installation, but registration is scoped to each bridge.
  Future<void> refreshToken() async {
    final token = await adapter.currentToken();
    tokenAvailable = token != null && token.isNotEmpty;
    if (tokenAvailable) await _acceptToken(token!);
    notifyListeners();
  }

  /// Clears host-scoped registration state without deleting the installation
  /// token. The next successful pairing calls [refreshToken].
  void resetHostRegistration() {
    _registeredToken = null;
    _pendingToken = null;
  }

  Future<void> _acceptToken(String token) async {
    if (token.isEmpty) return;
    tokenAvailable = true;
    _pendingToken = token;
    await synchronizeToken();
  }

  /// Retries a token that arrived before the bridge completed its handshake.
  /// Registration is best-effort: an unavailable bridge must never surface as
  /// an unhandled platform-stream error or lose the newest rotated token.
  Future<void> synchronizeToken() {
    final active = _tokenSync;
    if (active != null) return active;
    final future = _drainPendingToken();
    _tokenSync = future;
    return future.whenComplete(() {
      if (identical(_tokenSync, future)) _tokenSync = null;
    });
  }

  Future<void> _drainPendingToken() async {
    while (true) {
      if (_bridgeNotificationsSupported == false) return;
      final token = _pendingToken;
      if (token == null) return;
      if (token == _registeredToken) {
        if (_pendingToken == token) _pendingToken = null;
        continue;
      }
      try {
        await register(adapter.platform, token);
      } catch (_) {
        return;
      }
      _registeredToken = token;
      if (_pendingToken == token) _pendingToken = null;
    }
  }

  Future<bool> handleTap(Uri uri) async {
    if (uri.scheme != 'pi-mob' ||
        uri.host != 'session' ||
        uri.pathSegments.isEmpty) {
      return false;
    }
    final sessionId = uri.pathSegments.first;
    final applied = await reconcile(sessionId);
    if (applied) {
      lastReconciledSession = sessionId;
      notifyListeners();
    }
    return applied;
  }

  Future<void> openNotificationSettings() =>
      adapter.openNotificationSettings();

  Future<void> setForegroundService(
    bool value, {
    required bool appVisible,
  }) async {
    if (value && !appVisible) {
      throw StateError('foreground service must start while visible');
    }
    await adapter.setForegroundServiceEnabled(value, appVisible: appVisible);
    foregroundServiceEnabled = value;
    notifyListeners();
  }

  @override
  void dispose() {
    unawaited(_tokenSub?.cancel());
    unawaited(_tapSub?.cancel());
    super.dispose();
  }
}
