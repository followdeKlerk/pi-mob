/// Manual pairing input shared by the endpoint/passcode UI and enrollment.
library;

final RegExp _magicDns = RegExp(
  r'^[a-z0-9][a-z0-9.-]*\.ts\.net$',
  caseSensitive: false,
);
final RegExp _passcode = RegExp(r'^\d{6}$');
const Set<int> approvedPairingPorts = <int>{8788, 9443};

final class PairingPayload {
  const PairingPayload({
    required this.endpoint,
    required this.passcode,
    required this.expiresAt,
  });

  final Uri endpoint;
  final String passcode;
  final DateTime expiresAt;

  String get hostname => endpoint.host;
}

enum PairingRejection {
  emptyEndpoint,
  malformedEndpoint,
  nonHttps,
  notMagicDns,
  portNotAllowed,
  userInfoNotAllowed,
  pathQueryFragmentNotAllowed,
  emptyPasscode,
  malformedPasscode,
  expiredPasscode,
}

extension PairingRejectionMessage on PairingRejection {
  String get technicalReason => switch (this) {
    PairingRejection.emptyEndpoint => 'Enter the bridge endpoint',
    PairingRejection.malformedEndpoint => 'endpoint must be an HTTPS URL',
    PairingRejection.nonHttps => 'endpoint must use HTTPS',
    PairingRejection.notMagicDns =>
      'endpoint must be a Tailscale MagicDNS hostname ending in .ts.net',
    PairingRejection.portNotAllowed =>
      'endpoint must use the configured bridge port (8788 or 9443)',
    PairingRejection.userInfoNotAllowed =>
      'endpoint must not include credentials',
    PairingRejection.pathQueryFragmentNotAllowed =>
      'endpoint must not include a path, query, or fragment',
    PairingRejection.emptyPasscode => 'Enter the six-digit passcode',
    PairingRejection.malformedPasscode => 'passcode must be six digits',
    PairingRejection.expiredPasscode => 'passcode has expired',
  };
}

final class PairingValidationFailure implements Exception {
  const PairingValidationFailure(this.reason);
  final PairingRejection reason;
  @override
  String toString() => 'PairingValidationFailure(${reason.technicalReason})';
}

Uri validatePairingEndpoint(Object? raw) {
  if (raw is! String || raw.trim().isEmpty) {
    throw const PairingValidationFailure(PairingRejection.emptyEndpoint);
  }
  Uri endpoint;
  try {
    endpoint = Uri.parse(raw.trim());
  } on Object {
    throw const PairingValidationFailure(PairingRejection.malformedEndpoint);
  }
  if (endpoint.scheme != 'https' || endpoint.host.isEmpty) {
    throw PairingValidationFailure(
      endpoint.scheme == 'https'
          ? PairingRejection.malformedEndpoint
          : PairingRejection.nonHttps,
    );
  }
  if (!_magicDns.hasMatch(endpoint.host.toLowerCase())) {
    throw const PairingValidationFailure(PairingRejection.notMagicDns);
  }
  if (endpoint.userInfo.isNotEmpty) {
    throw const PairingValidationFailure(PairingRejection.userInfoNotAllowed);
  }
  if ((endpoint.path.isNotEmpty && endpoint.path != '/') ||
      endpoint.hasQuery ||
      endpoint.hasFragment) {
    throw const PairingValidationFailure(
      PairingRejection.pathQueryFragmentNotAllowed,
    );
  }
  if (endpoint.hasPort && !approvedPairingPorts.contains(endpoint.port)) {
    throw const PairingValidationFailure(PairingRejection.portNotAllowed);
  }
  return endpoint.replace(path: '', query: null, fragment: null);
}

PairingPayload validatePairingInput({
  required Object? endpoint,
  required Object? passcode,
  DateTime? expiresAt,
}) {
  final normalized = validatePairingEndpoint(endpoint);
  if (passcode is! String || passcode.isEmpty) {
    throw const PairingValidationFailure(PairingRejection.emptyPasscode);
  }
  if (!_passcode.hasMatch(passcode)) {
    throw const PairingValidationFailure(PairingRejection.malformedPasscode);
  }
  final expiry =
      expiresAt ?? DateTime.now().toUtc().add(const Duration(minutes: 5));
  if (!expiry.isAfter(DateTime.now().toUtc())) {
    throw const PairingValidationFailure(PairingRejection.expiredPasscode);
  }
  return PairingPayload(
    endpoint: normalized,
    passcode: passcode,
    expiresAt: expiry.toUtc(),
  );
}

String formatPairingValidationException(PairingValidationFailure failure) =>
    failure.reason.technicalReason;
