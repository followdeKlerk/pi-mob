import 'package:flutter/material.dart';

/// Semantic status colors that complement the Material 3 [ColorScheme].
///
/// Material 3 ships excellent "primary / secondary / tertiary / error" roles,
/// but Pi Mob surfaces routinely need to convey orthogonal signals: a
/// connection that is ready versus degraded versus offline, a tool result
/// that succeeded versus warned versus failed, a transcript block that is
/// informational versus critical. Each [PiSemanticColors] entry ships both
/// a foreground and a container variant so widgets can pick the contrast
/// pair that fits their surface without re-deriving the value at every
/// callsite.
///
/// The pairings are tuned so the foreground against its container clears
/// WCAG 2.2 AA (>= 4.5:1) in both light and dark variants. Tests in
/// `apps/mobile/test/ui/pi_theme_test.dart` lock this property in.
@immutable
class PiSemanticColors extends ThemeExtension<PiSemanticColors> {
  const PiSemanticColors({
    required this.success,
    required this.onSuccess,
    required this.successContainer,
    required this.onSuccessContainer,
    required this.warning,
    required this.onWarning,
    required this.warningContainer,
    required this.onWarningContainer,
    required this.critical,
    required this.onCritical,
    required this.criticalContainer,
    required this.onCriticalContainer,
    required this.info,
    required this.onInfo,
    required this.infoContainer,
    required this.onInfoContainer,
    required this.connectionReady,
    required this.connectionDegraded,
    required this.connectionOffline,
  });

  /// Light-mode defaults. Foregrounds are dark on pale containers.
  static const PiSemanticColors light = PiSemanticColors(
    success: Color(0xFF166534),
    onSuccess: Color(0xFFFFFFFF),
    successContainer: Color(0xFFDCFCE7),
    onSuccessContainer: Color(0xFF052E16),
    warning: Color(0xFF92400E),
    onWarning: Color(0xFFFFFFFF),
    warningContainer: Color(0xFFFEF3C7),
    onWarningContainer: Color(0xFF451A03),
    critical: Color(0xFF991B1B),
    onCritical: Color(0xFFFFFFFF),
    criticalContainer: Color(0xFFFEE2E2),
    onCriticalContainer: Color(0xFF450A0A),
    info: Color(0xFF1D4ED8),
    onInfo: Color(0xFFFFFFFF),
    infoContainer: Color(0xFFDBEAFE),
    onInfoContainer: Color(0xFF1E3A8A),
    connectionReady: Color(0xFF166534),
    connectionDegraded: Color(0xFF92400E),
    connectionOffline: Color(0xFF991B1B),
  );

  /// Dark-mode defaults. Containers are deep, foregrounds are pale.
  static const PiSemanticColors dark = PiSemanticColors(
    success: Color(0xFF4ADE80),
    onSuccess: Color(0xFF052E16),
    successContainer: Color(0xFF14532D),
    onSuccessContainer: Color(0xFFDCFCE7),
    warning: Color(0xFFFCD34D),
    onWarning: Color(0xFF451A03),
    warningContainer: Color(0xFF713F12),
    onWarningContainer: Color(0xFFFEF3C7),
    critical: Color(0xFFFCA5A5),
    onCritical: Color(0xFF450A0A),
    criticalContainer: Color(0xFF7F1D1D),
    onCriticalContainer: Color(0xFFFEE2E2),
    info: Color(0xFFF8B19A),
    onInfo: Color(0xFF2A1208),
    infoContainer: Color(0xFF7A3D23),
    onInfoContainer: Color(0xFFFCE4D8),
    connectionReady: Color(0xFF4ADE80),
    connectionDegraded: Color(0xFFFCD34D),
    connectionOffline: Color(0xFFFCA5A5),
  );

  // Success --------------------------------------------------------------
  final Color success;
  final Color onSuccess;
  final Color successContainer;
  final Color onSuccessContainer;

  // Warning --------------------------------------------------------------
  final Color warning;
  final Color onWarning;
  final Color warningContainer;
  final Color onWarningContainer;

  // Critical -------------------------------------------------------------
  final Color critical;
  final Color onCritical;
  final Color criticalContainer;
  final Color onCriticalContainer;

  // Info -----------------------------------------------------------------
  final Color info;
  final Color onInfo;
  final Color infoContainer;
  final Color onInfoContainer;

  // Connection phase ----------------------------------------------------
  /// Foreground for the connection phase badge when the host is reachable.
  final Color connectionReady;

  /// Foreground for the connection phase badge when the host is reachable
  /// but the readiness probe is degraded (e.g. stale generation).
  final Color connectionDegraded;

  /// Foreground for the connection phase badge when the host is offline.
  final Color connectionOffline;

  @override
  PiSemanticColors copyWith({
    Color? success,
    Color? onSuccess,
    Color? successContainer,
    Color? onSuccessContainer,
    Color? warning,
    Color? onWarning,
    Color? warningContainer,
    Color? onWarningContainer,
    Color? critical,
    Color? onCritical,
    Color? criticalContainer,
    Color? onCriticalContainer,
    Color? info,
    Color? onInfo,
    Color? infoContainer,
    Color? onInfoContainer,
    Color? connectionReady,
    Color? connectionDegraded,
    Color? connectionOffline,
  }) {
    return PiSemanticColors(
      success: success ?? this.success,
      onSuccess: onSuccess ?? this.onSuccess,
      successContainer: successContainer ?? this.successContainer,
      onSuccessContainer: onSuccessContainer ?? this.onSuccessContainer,
      warning: warning ?? this.warning,
      onWarning: onWarning ?? this.onWarning,
      warningContainer: warningContainer ?? this.warningContainer,
      onWarningContainer: onWarningContainer ?? this.onWarningContainer,
      critical: critical ?? this.critical,
      onCritical: onCritical ?? this.onCritical,
      criticalContainer: criticalContainer ?? this.criticalContainer,
      onCriticalContainer: onCriticalContainer ?? this.onCriticalContainer,
      info: info ?? this.info,
      onInfo: onInfo ?? this.onInfo,
      infoContainer: infoContainer ?? this.infoContainer,
      onInfoContainer: onInfoContainer ?? this.onInfoContainer,
      connectionReady: connectionReady ?? this.connectionReady,
      connectionDegraded: connectionDegraded ?? this.connectionDegraded,
      connectionOffline: connectionOffline ?? this.connectionOffline,
    );
  }

  @override
  PiSemanticColors lerp(ThemeExtension<PiSemanticColors>? other, double t) {
    if (other is! PiSemanticColors) return this;
    return PiSemanticColors(
      success: Color.lerp(success, other.success, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      successContainer: Color.lerp(
        successContainer,
        other.successContainer,
        t,
      )!,
      onSuccessContainer: Color.lerp(
        onSuccessContainer,
        other.onSuccessContainer,
        t,
      )!,
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      warningContainer: Color.lerp(
        warningContainer,
        other.warningContainer,
        t,
      )!,
      onWarningContainer: Color.lerp(
        onWarningContainer,
        other.onWarningContainer,
        t,
      )!,
      critical: Color.lerp(critical, other.critical, t)!,
      onCritical: Color.lerp(onCritical, other.onCritical, t)!,
      criticalContainer: Color.lerp(
        criticalContainer,
        other.criticalContainer,
        t,
      )!,
      onCriticalContainer: Color.lerp(
        onCriticalContainer,
        other.onCriticalContainer,
        t,
      )!,
      info: Color.lerp(info, other.info, t)!,
      onInfo: Color.lerp(onInfo, other.onInfo, t)!,
      infoContainer: Color.lerp(infoContainer, other.infoContainer, t)!,
      onInfoContainer: Color.lerp(onInfoContainer, other.onInfoContainer, t)!,
      connectionReady: Color.lerp(connectionReady, other.connectionReady, t)!,
      connectionDegraded: Color.lerp(
        connectionDegraded,
        other.connectionDegraded,
        t,
      )!,
      connectionOffline: Color.lerp(
        connectionOffline,
        other.connectionOffline,
        t,
      )!,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! PiSemanticColors) return false;
    return other.success == success &&
        other.onSuccess == onSuccess &&
        other.successContainer == successContainer &&
        other.onSuccessContainer == onSuccessContainer &&
        other.warning == warning &&
        other.onWarning == onWarning &&
        other.warningContainer == warningContainer &&
        other.onWarningContainer == onWarningContainer &&
        other.critical == critical &&
        other.onCritical == onCritical &&
        other.criticalContainer == criticalContainer &&
        other.onCriticalContainer == onCriticalContainer &&
        other.info == info &&
        other.onInfo == onInfo &&
        other.infoContainer == infoContainer &&
        other.onInfoContainer == onInfoContainer &&
        other.connectionReady == connectionReady &&
        other.connectionDegraded == connectionDegraded &&
        other.connectionOffline == connectionOffline;
  }

  @override
  int get hashCode => Object.hash(
    success,
    onSuccess,
    successContainer,
    onSuccessContainer,
    warning,
    onWarning,
    warningContainer,
    onWarningContainer,
    critical,
    onCritical,
    criticalContainer,
    onCriticalContainer,
    info,
    onInfo,
    infoContainer,
    onInfoContainer,
    connectionReady,
    connectionDegraded,
    connectionOffline,
  );
}

/// Convenience accessor that returns the surrounding [PiSemanticColors]
/// or falls back to [PiSemanticColors.light] when the extension is missing
/// (e.g. inside an isolated test that pumped a plain [MaterialApp]).
extension PiSemanticColorsContext on BuildContext {
  PiSemanticColors get piSemanticColors =>
      Theme.of(this).extension<PiSemanticColors>() ?? PiSemanticColors.light;
}
