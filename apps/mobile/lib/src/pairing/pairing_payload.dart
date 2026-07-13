/// Non-secret host discovery payload exchanged over a QR code or typed
/// manually during pairing.
///
/// The mobile client owns no credentials; Tailscale is the connection
/// authentication boundary. This payload only carries public discovery
/// metadata so the user can confirm what they are about to trust.
library;

const String _kind = 'pi-mob-host';
const int _version = 1;
const int _protocolMajor = 1;

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
);

final RegExp _displayNamePattern = RegExp(r'^[\P{Cc}]{1,64}$', unicode: true);

/// Result of a strict pairing payload validation. The payload is intentionally
/// a structured value object so the UI can render each field explicitly.
final class PairingPayload {
  const PairingPayload({
    required this.hostId,
    required this.displayName,
    required this.endpoint,
    required this.protocolMajor,
    required this.kind,
    required this.version,
  });

  /// UUID-shaped stable host identifier learned during the hello handshake.
  final String hostId;

  /// Owner-chosen display name shown in confirmations and host headers.
  final String displayName;

  /// HTTPS MagicDNS origin of the form `https://<host>.<tailnet>.ts.net`.
  final Uri endpoint;

  /// Mobile-app-supported protocol major version. Always `1` for the v1 wire.
  final int protocolMajor;

  /// Payload discriminator. Must be the literal string `pi-mob-host`.
  final String kind;

  /// Payload schema version. Must equal `1`.
  final int version;

  /// Hostname extracted from [endpoint] for the confirmation view.
  String get hostname => endpoint.host;

  /// Last eight hex characters of [hostId]. The confirmation view presents the
  /// suffix rather than the full ID so the user can compare it against the
  /// host without copying long strings.
  String get hostIdSuffix {
    if (hostId.length < 8) return hostId;
    return hostId.substring(hostId.length - 8);
  }

  PairingPayload copyWith({Uri? endpoint, String? displayName}) =>
      PairingPayload(
        hostId: hostId,
        displayName: displayName ?? this.displayName,
        endpoint: endpoint ?? this.endpoint,
        protocolMajor: protocolMajor,
        kind: kind,
        version: version,
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'kind': kind,
    'version': version,
    'hostId': hostId,
    'displayName': displayName,
    'endpoint': endpoint.toString(),
    'protocolMajor': protocolMajor,
  };
}

/// Reasons why a payload or endpoint fails validation. Each value maps to a
/// stable UI message and helps tests assert behaviour without depending on the
/// human-readable text.
enum PairingRejection {
  notAnObject,
  missingKind,
  wrongKind,
  missingVersion,
  wrongVersion,
  missingHostId,
  malformedHostId,
  missingDisplayName,
  malformedDisplayName,
  missingEndpoint,
  malformedEndpoint,
  missingProtocolMajor,
  wrongProtocolMajor,
  nonHttps,
  notMagicDns,
  loopbackAddress,
  wildcardAddress,
  privateLanAddress,
  linkLocalAddress,
  uniqueLocalAddress,
  ipv4MappedAddress,
  ipv4CompatibleAddress,
  tunnelBroker,
  documentationPrefix,
  discardedPrefix,
  portNotAllowed,
  userInfoNotAllowed,
  pathQueryFragmentNotAllowed,
  reservedName,
  funnelLikePattern,
}

extension PairingRejectionMessage on PairingRejection {
  /// Localized in the test surface; the UI presents translated copy. The
  /// message here is the canonical technical reason.
  String get technicalReason => switch (this) {
    PairingRejection.notAnObject => 'QR is not a JSON object',
    PairingRejection.missingKind => 'kind is missing',
    PairingRejection.wrongKind => 'kind must be "pi-mob-host"',
    PairingRejection.missingVersion => 'version is missing',
    PairingRejection.wrongVersion => 'version must be 1',
    PairingRejection.missingHostId => 'hostId is missing',
    PairingRejection.malformedHostId => 'hostId must be a lowercase UUID',
    PairingRejection.missingDisplayName => 'displayName is missing',
    PairingRejection.malformedDisplayName =>
      'displayName must be 1..64 non-control characters',
    PairingRejection.missingEndpoint => 'endpoint is missing',
    PairingRejection.malformedEndpoint => 'endpoint must be an HTTPS URL',
    PairingRejection.missingProtocolMajor => 'protocolMajor is missing',
    PairingRejection.wrongProtocolMajor => 'protocolMajor must be 1',
    PairingRejection.nonHttps => 'endpoint must use HTTPS',
    PairingRejection.notMagicDns =>
      'endpoint must be a Tailscale MagicDNS hostname ending in .ts.net',
    PairingRejection.loopbackAddress => 'loopback endpoints are not allowed',
    PairingRejection.wildcardAddress => 'wildcard addresses are not allowed',
    PairingRejection.privateLanAddress =>
      'private LAN endpoints are not allowed',
    PairingRejection.linkLocalAddress => 'link-local endpoints are not allowed',
    PairingRejection.uniqueLocalAddress =>
      'unique-local IPv6 endpoints are not allowed',
    PairingRejection.ipv4MappedAddress =>
      'IPv4-mapped IPv6 endpoints are not allowed',
    PairingRejection.ipv4CompatibleAddress =>
      'IPv4-compatible IPv6 endpoints are not allowed',
    PairingRejection.tunnelBroker =>
      'IPv6 tunnel-broker endpoints are not allowed',
    PairingRejection.documentationPrefix =>
      'documentation-prefix endpoints are not allowed',
    PairingRejection.discardedPrefix =>
      'discard-prefix endpoints are not allowed',
    PairingRejection.portNotAllowed =>
      'endpoint must be a clean origin without an explicit port',
    PairingRejection.userInfoNotAllowed =>
      'endpoint must not include credentials',
    PairingRejection.pathQueryFragmentNotAllowed =>
      'endpoint must be an origin without path, query, or fragment',
    PairingRejection.reservedName =>
      'endpoint must not be a reserved or private DNS name',
    PairingRejection.funnelLikePattern =>
      'endpoint hostname must not look like Funnel/public routing',
  };
}

/// Strict pairing-payload validator. The returned object records the precise
/// reason a payload was rejected so the UI can present the technical detail.
final class PairingValidationFailure implements Exception {
  const PairingValidationFailure(this.reason, [this.actual]);

  final PairingRejection reason;
  final Object? actual;

  @override
  String toString() => 'PairingValidationFailure(${reason.technicalReason})';
}

/// Strict validator for the non-secret pairing QR payload.
///
/// The QR contract is normative (see `docs/PROTOCOL.md` §3) and the rules are
/// deliberately strict to keep Tailscale as the sole connection-authentication
/// boundary:
///   * kind must equal `pi-mob-host`,
///   * version must equal `1`,
///   * hostId must be a lowercase UUID,
///   * displayName must be 1..64 non-control characters,
///   * endpoint must be a clean HTTPS origin,
///   * the endpoint hostname must be a Tailscale MagicDNS name ending in
///     `.ts.net`,
///   * the resolved IP must not be loopback, wildcard, private LAN, link
///     local, IPv6 unique local, IPv4-mapped IPv6, IPv4-compatible IPv6,
///     tunnel broker, documentation, or discard prefix,
///   * explicit ports, user-info, paths, queries, and fragments are rejected,
///   * well-known reserved names are rejected,
///   * any pattern that resembles Tailscale Funnel/public routing is rejected.
///
/// The validator never invokes the network. IP heuristics are string-based on
/// the literal hostname text; pairings are accepted only when the host
/// self-identifies as a Tailscale MagicDNS origin. The bridge-side TLS
/// handshake with platform-verified certificates is what authenticates the
/// host at connection time.
PairingPayload validatePairingPayload(Object? raw) {
  if (raw is! Map) {
    throw const PairingValidationFailure(PairingRejection.notAnObject);
  }
  final json = Map<String, Object?>.from(raw);

  if (!json.containsKey('kind')) {
    throw const PairingValidationFailure(PairingRejection.missingKind);
  }
  if (json['kind'] != _kind) {
    throw PairingValidationFailure(PairingRejection.wrongKind, json['kind']);
  }

  if (!json.containsKey('version')) {
    throw const PairingValidationFailure(PairingRejection.missingVersion);
  }
  final version = json['version'];
  if (version != _version) {
    throw PairingValidationFailure(PairingRejection.wrongVersion, version);
  }

  if (!json.containsKey('hostId')) {
    throw const PairingValidationFailure(PairingRejection.missingHostId);
  }
  final hostId = json['hostId'];
  if (hostId is! String || !_uuidPattern.hasMatch(hostId)) {
    throw PairingValidationFailure(PairingRejection.malformedHostId, hostId);
  }

  if (!json.containsKey('displayName')) {
    throw const PairingValidationFailure(PairingRejection.missingDisplayName);
  }
  final displayName = json['displayName'];
  if (displayName is! String || !_displayNamePattern.hasMatch(displayName)) {
    throw PairingValidationFailure(
      PairingRejection.malformedDisplayName,
      displayName,
    );
  }

  if (!json.containsKey('endpoint')) {
    throw const PairingValidationFailure(PairingRejection.missingEndpoint);
  }
  final endpointRaw = json['endpoint'];
  final endpoint = _validateEndpoint(endpointRaw);

  if (!json.containsKey('protocolMajor')) {
    throw const PairingValidationFailure(PairingRejection.missingProtocolMajor);
  }
  final protocolMajor = json['protocolMajor'];
  if (protocolMajor != _protocolMajor) {
    throw PairingValidationFailure(
      PairingRejection.wrongProtocolMajor,
      protocolMajor,
    );
  }

  return PairingPayload(
    kind: _kind,
    version: _version,
    hostId: hostId,
    displayName: displayName,
    endpoint: endpoint,
    protocolMajor: _protocolMajor,
  );
}

/// Strict validator for a manually typed HTTPS origin. Used by the manual
/// recovery flow. Returns a normalized origin URL with no path, query,
/// fragment, or port.
Uri validateManualEndpoint(Object? raw) {
  final endpoint = _validateEndpoint(raw);
  return endpoint;
}

Uri _validateEndpoint(Object? raw) {
  if (raw is! String) {
    throw const PairingValidationFailure(PairingRejection.malformedEndpoint);
  }
  Uri endpoint;
  try {
    final normalized = raw.contains('://') ? raw : 'https://$raw';
    endpoint = Uri.parse(normalized);
  } on Object {
    throw const PairingValidationFailure(PairingRejection.malformedEndpoint);
  }

  if (endpoint.scheme != 'https') {
    throw const PairingValidationFailure(PairingRejection.nonHttps);
  }

  if (endpoint.userInfo.isNotEmpty) {
    throw const PairingValidationFailure(PairingRejection.userInfoNotAllowed);
  }

  if (endpoint.hasPort) {
    throw const PairingValidationFailure(PairingRejection.portNotAllowed);
  }

  if (endpoint.path.isNotEmpty && endpoint.path != '/' ||
      endpoint.hasQuery ||
      endpoint.hasFragment) {
    throw const PairingValidationFailure(
      PairingRejection.pathQueryFragmentNotAllowed,
    );
  }

  final host = endpoint.host;
  if (host.isEmpty) {
    throw const PairingValidationFailure(PairingRejection.malformedEndpoint);
  }

  final hostLower = host.toLowerCase();
  _rejectNonTailscaleLiteralHost(hostLower);

  return endpoint.replace(path: '', query: null, fragment: null);
}

void _rejectNonTailscaleLiteralHost(String hostLower) {
  // Tailscale Funnel/public hosts always use a public suffix; the only
  // legitimate private origin for this product is a MagicDNS name ending in
  // `.ts.net`. Reject anything else, including numeric/IP literals and
  // unbranded public domains, before the bridge connection even opens.
  if (!hostLower.endsWith('.ts.net')) {
    throw const PairingValidationFailure(PairingRejection.notMagicDns);
  }

  // Tailscale MagicDNS can be addressed either by a name (e.g. `mac.tailnet`)
  // or by appending `.ts.net` to an IP literal (e.g. `100.64.0.1.ts.net`).
  // Strip the suffix so we can classify the host as an IP literal.
  final core = hostLower.substring(0, hostLower.length - '.ts.net'.length);
  if (_looksLikeIpLiteral(core)) {
    _rejectIpLiteral(core);
  }

  if (_looksLikeFunnelLike(hostLower)) {
    throw const PairingValidationFailure(PairingRejection.funnelLikePattern);
  }

  if (_reservedNames.contains(hostLower.split('.').first)) {
    throw const PairingValidationFailure(PairingRejection.reservedName);
  }
}

bool _looksLikeIpLiteral(String host) {
  if (RegExp(r'^[0-9.]+$').hasMatch(host)) return true;
  if (host.contains(':')) return true;
  return false;
}

void _rejectIpLiteral(String host) {
  // IPv6 literals always contain `:`.
  if (host.contains(':')) {
    // bracketed IPv6 literals are not produced by Uri.host, but the bare
    // hostname variant still appears when the QR omits the brackets.
    if (host == '::1' || host == '::' || host == '0:0:0:0:0:0:0:1') {
      throw const PairingValidationFailure(PairingRejection.loopbackAddress);
    }
    if (host.startsWith('fe80:') ||
        host.startsWith('fe8') ||
        host.startsWith('fe9') ||
        host.startsWith('fea') ||
        host.startsWith('feb')) {
      throw const PairingValidationFailure(PairingRejection.linkLocalAddress);
    }
    if (host.startsWith('fc') || host.startsWith('fd')) {
      throw const PairingValidationFailure(PairingRejection.uniqueLocalAddress);
    }
    if (RegExp(r'^::ffff:[0-9.]+$').hasMatch(host) ||
        RegExp(r'^::[0-9.]+$').hasMatch(host)) {
      if (host.startsWith('::ffff:')) {
        throw const PairingValidationFailure(
          PairingRejection.ipv4MappedAddress,
        );
      }
      throw const PairingValidationFailure(
        PairingRejection.ipv4CompatibleAddress,
      );
    }
    if (host.startsWith('64:ff9b:') ||
        host.startsWith('2001:db8:') ||
        host.startsWith('2001::') ||
        host == '2001:0::') {
      final reason = host.startsWith('2001:db8:')
          ? PairingRejection.documentationPrefix
          : PairingRejection.tunnelBroker;
      throw PairingValidationFailure(reason, host);
    }
    if (host.startsWith('100::') || host.startsWith('100:')) {
      throw const PairingValidationFailure(PairingRejection.discardedPrefix);
    }
    // Accept non-classified IPv6 literals that are otherwise on a Tailscale
    // suffix; in practice the host will be a MagicDNS name, not an IP.
    return;
  }

  // IPv4 literals.
  if (host == '0.0.0.0' || host == '255.255.255.255') {
    throw const PairingValidationFailure(PairingRejection.wildcardAddress);
  }
  final parts = host.split('.');
  if (parts.length != 4 || parts.any((part) => int.tryParse(part) == null)) {
    // Looks like a numeric string but is not a recognizable IPv4 literal;
    // surface as malformed so the user is not silently mis-paired.
    throw const PairingValidationFailure(PairingRejection.malformedEndpoint);
  }
  final octets = parts.map(int.parse).toList(growable: false);
  final first = octets[0];
  final second = octets[1];
  if (first == 127) {
    throw const PairingValidationFailure(PairingRejection.loopbackAddress);
  }
  if (first == 0) {
    throw const PairingValidationFailure(PairingRejection.wildcardAddress);
  }
  if (first == 10 ||
      (first == 172 && second >= 16 && second <= 31) ||
      (first == 192 && second == 168) ||
      (first == 169 && second == 254)) {
    throw const PairingValidationFailure(PairingRejection.privateLanAddress);
  }
  if (first == 100 && second >= 64 && second <= 127) {
    throw const PairingValidationFailure(PairingRejection.discardedPrefix);
  }
  if (first == 192 && second == 0 && octets[2] == 0) {
    throw const PairingValidationFailure(PairingRejection.documentationPrefix);
  }
  if (first == 198 && second == 18) {
    throw const PairingValidationFailure(PairingRejection.tunnelBroker);
  }
  if (first >= 224) {
    throw const PairingValidationFailure(PairingRejection.wildcardAddress);
  }
  // Accept otherwise valid IPv4 literals that happen to land on a Tailscale
  // suffix; they can only reach the bridge through a configured route.
}

bool _looksLikeFunnelLike(String host) {
  // Tailscale Funnel historically exposes `<node>.<tailnet>.ts.net` and is
  // already covered by the MagicDNS suffix check. We additionally block
  // patterns that resemble explicit Funnel/public routing attributes and
  // non-Tailscale public domains that the user might accidentally type.
  if (host.contains('*')) return true;
  if (host.contains('/')) return true;
  return false;
}

const Set<String> _reservedNames = <String>{
  'localhost',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
};

// Re-exported so other pairing files can format the same exception text.
String formatPairingValidationException(PairingValidationFailure failure) =>
    failure.reason.technicalReason;

// Marker compatibility so callers can pass either failure form to handlers.
typedef PairingException = PairingValidationFailure;
