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
  NotificationPermission permission = NotificationPermission.notDetermined;
  bool enabled = false;
  bool foregroundServiceEnabled = false;
  String? lastReconciledSession;
  Future<void> initialize() async {
    permission = await adapter.permissionStatus();
    _tokenSub = adapter.tokenChanges.listen((token) => _register(token));
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
      final token = await adapter.currentToken();
      if (token != null) await _register(token);
    }
    notifyListeners();
  }

  Future<void> _register(String token) => register(adapter.platform, token);
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
