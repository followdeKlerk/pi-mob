import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Result of the explicit HTTPS readiness probe performed before a socket is
/// opened. Standard platform TLS validation is deliberately left enabled.
final class EndpointProbe {
  const EndpointProbe({
    required this.statusCode,
    required this.ready,
    required this.body,
  });

  final int statusCode;
  final bool ready;
  final Map<String, Object?> body;
}

/// Injectable network boundary used by [ConnectionCoordinator].
abstract interface class BridgeTransport {
  Future<EndpointProbe> probe(Uri endpoint);

  Future<BridgeSocket> connect(Uri endpoint);
}

abstract interface class BridgeSocket {
  Stream<String> get messages;

  Future<void> send(Map<String, Object?> message);

  Future<void> close([int? code, String? reason]);
}

/// Production bridge transport. It accepts HTTPS endpoints only, probes
/// `/readyz`, then upgrades `wss://<host>/v1/ws` using dart:io WebSocket.
final class IoBridgeTransport implements BridgeTransport {
  IoBridgeTransport({HttpClient Function()? httpClientFactory})
    : _httpClientFactory = httpClientFactory ?? HttpClient.new;

  final HttpClient Function() _httpClientFactory;

  @override
  Future<EndpointProbe> probe(Uri endpoint) async {
    _requireHttpsEndpoint(endpoint);
    final client = _httpClientFactory();
    try {
      final request = await client.getUrl(_readyUri(endpoint));
      request.headers.set(HttpHeaders.acceptHeader, ContentType.json.mimeType);
      final response = await request.close();
      final text = await utf8.decoder.bind(response).join();
      Map<String, Object?> body = const {};
      if (text.isNotEmpty) {
        final decoded = jsonDecode(text);
        if (decoded is Map) body = Map<String, Object?>.from(decoded);
      }
      return EndpointProbe(
        statusCode: response.statusCode,
        ready:
            response.statusCode == HttpStatus.ok && body['status'] == 'ready',
        body: body,
      );
    } finally {
      client.close(force: true);
    }
  }

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    _requireHttpsEndpoint(endpoint);
    final socket = await WebSocket.connect(
      _webSocketUri(endpoint).toString(),
      compression: CompressionOptions.compressionOff,
    );
    return _IoBridgeSocket(socket);
  }
}

final class _IoBridgeSocket implements BridgeSocket {
  _IoBridgeSocket(this._socket);

  final WebSocket _socket;

  @override
  Stream<String> get messages =>
      _socket.where((value) => value is String).cast<String>();

  @override
  Future<void> send(Map<String, Object?> message) async {
    _socket.add(jsonEncode(message));
  }

  @override
  Future<void> close([int? code, String? reason]) async {
    await _socket.close(code, reason);
  }
}

Uri normalizeHttpsEndpoint(String value) {
  final trimmed = value.trim();
  final withScheme = trimmed.contains('://') ? trimmed : 'https://$trimmed';
  final uri = Uri.parse(withScheme);
  _requireHttpsEndpoint(uri);
  if ((uri.path.isNotEmpty && uri.path != '/') ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const FormatException(
      'Endpoint must be an HTTPS origin without path, query, or fragment',
    );
  }
  return uri.replace(path: '', query: null, fragment: null);
}

void _requireHttpsEndpoint(Uri endpoint) {
  if (endpoint.scheme != 'https' ||
      endpoint.host.isEmpty ||
      endpoint.userInfo.isNotEmpty) {
    throw const FormatException('Endpoint must be a valid HTTPS URL');
  }
}

Uri _readyUri(Uri endpoint) => endpoint.replace(
  scheme: 'https',
  path: '${endpoint.path.replaceFirst(RegExp(r'/$'), '')}/readyz',
  query: null,
  fragment: null,
);

Uri _webSocketUri(Uri endpoint) => endpoint.replace(
  scheme: 'wss',
  path: '${endpoint.path.replaceFirst(RegExp(r'/$'), '')}/v1/ws',
  query: null,
  fragment: null,
);
