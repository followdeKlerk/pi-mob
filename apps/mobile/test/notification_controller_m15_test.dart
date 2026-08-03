import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/notifications/notification_controller.dart';

class FakePlatform implements NotificationPlatformAdapter {
  @override
  String platform = 'fcm';
  NotificationPermission status = NotificationPermission.notDetermined;
  String? token = 'token';
  int prompts = 0;
  bool? service;
  bool? visible;
  int openSettingsCalls = 0;
  final tokens = StreamController<String>.broadcast();
  final taps = StreamController<Uri>.broadcast();
  @override
  Future<NotificationPermission> permissionStatus() async => status;
  @override
  Future<NotificationPermission> requestPermission() async {
    prompts++;
    return status = NotificationPermission.authorized;
  }

  @override
  Future<String?> currentToken() async => token;
  @override
  Stream<String> get tokenChanges => tokens.stream;
  @override
  Stream<Uri> get notificationTaps => taps.stream;
  @override
  Future<void> openNotificationSettings() async => openSettingsCalls++;

  @override
  Future<void> setForegroundServiceEnabled(
    bool enabled, {
    required bool appVisible,
  }) async {
    service = enabled;
    visible = appVisible;
  }

  @override
  Future<void> updateLiveActivity({
    required String sessionId,
    required String status,
    required DateTime staleAt,
  }) async {}
  @override
  Future<void> endLiveActivity(String sessionId) async {}
  @override
  Future<void> cleanupStaleActivities(DateTime now) async {}
}

void main() {
  test(
    'permission is requested only by explicit user action and token rotation registers',
    () async {
      final platform = FakePlatform();
      final registrations = <String>[];
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (kind, token) async => registrations.add('$kind:$token'),
        reconcile: (_) async => false,
      );
      await controller.initialize();
      expect(platform.prompts, 0);
      await controller.enableByUserAction();
      expect(platform.prompts, 1);
      expect(registrations, ['fcm:token']);
      platform.tokens.add('rotated');
      await Future<void>.delayed(Duration.zero);
      expect(registrations.last, 'fcm:rotated');
      controller.dispose();
    },
  );
  test(
    'connected notification capability enrolls once without the drawer action',
    () async {
      final platform = FakePlatform();
      final registrations = <String>[];
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (kind, token) async => registrations.add('$kind:$token'),
        reconcile: (_) async => false,
      );
      await controller.initialize();
      await controller.onBridgeReady(notificationsSupported: false);
      expect(platform.prompts, 0);
      expect(registrations, isEmpty);

      await controller.onBridgeReady(notificationsSupported: true);
      expect(platform.prompts, 1);
      expect(registrations, ['fcm:token']);
      await controller.onBridgeReady(notificationsSupported: true);
      expect(platform.prompts, 1);
      expect(registrations, ['fcm:token']);
      controller.dispose();
    },
  );
  test(
    'denied notification permission remains retryable without repeated prompts',
    () async {
      final platform = FakePlatform()..status = NotificationPermission.denied;
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (kind, token) async {},
        reconcile: (_) async => false,
      );
      await controller.initialize();
      await controller.onBridgeReady(notificationsSupported: true);
      expect(platform.prompts, 0);
      expect(controller.enabled, false);
      controller.dispose();
    },
  );
  test(
    'authorized permission without a token stays disabled and retryable',
    () async {
      final platform = FakePlatform()
        ..status = NotificationPermission.authorized
        ..token = null;
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (platform, token) async {},
        reconcile: (_) async => false,
      );
      await controller.initialize();
      await controller.onBridgeReady(notificationsSupported: true);
      expect(controller.enabled, false);
      expect(controller.tokenAvailable, false);
      controller.dispose();
    },
  );
  test(
    'token arriving before bridge readiness is retained and retried',
    () async {
      final platform = FakePlatform();
      var ready = false;
      final registrations = <String>[];
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (kind, token) async {
          if (!ready) throw StateError('bridge is not ready');
          registrations.add('$kind:$token');
        },
        reconcile: (_) async => false,
      );
      await controller.initialize();
      platform.tokens.add('early-token');
      await Future<void>.delayed(Duration.zero);
      expect(registrations, isEmpty);

      ready = true;
      await controller.synchronizeToken();
      expect(registrations, ['fcm:early-token']);
      await controller.synchronizeToken();
      expect(registrations, ['fcm:early-token']);

      platform.token = 'early-token';
      controller.resetHostRegistration();
      await controller.refreshToken();
      expect(registrations, ['fcm:early-token', 'fcm:early-token']);
      controller.dispose();
    },
  );
  test(
    'deep links reconcile authoritative session and stale targets do not apply',
    () async {
      final platform = FakePlatform();
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (platform, token) async {},
        reconcile: (id) async => id == 'current',
      );
      expect(
        await controller.handleTap(
          Uri.parse('pi-mob://session/stale?kind=settled'),
        ),
        false,
      );
      expect(
        await controller.handleTap(
          Uri.parse('pi-mob://session/current?kind=failed'),
        ),
        true,
      );
      expect(controller.lastReconciledSession, 'current');
    },
  );
  test(
    'notification settings action delegates to the platform adapter',
    () async {
      final platform = FakePlatform();
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (platform, token) async {},
        reconcile: (_) async => false,
      );
      await controller.openNotificationSettings();
      expect(platform.openSettingsCalls, 1);
      controller.dispose();
    },
  );
  test(
    'foreground service can only start from visible app and no mutating action exists',
    () async {
      final platform = FakePlatform();
      final controller = NotificationController(
        adapter: platform,
        deviceId: 'd',
        appVersion: '1',
        register: (platform, token) async {},
        reconcile: (_) async => true,
      );
      await expectLater(
        controller.setForegroundService(true, appVisible: false),
        throwsStateError,
      );
      await controller.setForegroundService(true, appVisible: true);
      expect(platform.service, true);
      expect(platform.visible, true);
    },
  );
}
