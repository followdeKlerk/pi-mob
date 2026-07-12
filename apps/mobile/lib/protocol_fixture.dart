/// Immutable protocol fixture decoder shared by `apps/mobile/test`.
///
/// M1 only ships the `hello` envelope pair. The Dart decoder for the fixture
/// must agree with the TypeScript counterpart in `packages/protocol-fixtures`.
/// The fixture file is loaded from disk at test time so both languages
/// validate the exact same bytes.
library;

class ProtocolHello {
  final String protocol;
  final String protocolVersion;
  final String clientId;
  final List<String> capabilities;

  const ProtocolHello({
    required this.protocol,
    required this.protocolVersion,
    required this.clientId,
    required this.capabilities,
  });

  factory ProtocolHello.fromJson(Map<String, Object?> json) {
    final protocol = json['protocol'];
    final version = json['protocolVersion'];
    final clientId = json['clientId'];
    final capabilities = json['capabilities'];
    if (protocol is! String || protocol != 'hello') {
      throw const FormatException('expected protocol "hello"');
    }
    if (version is! String || version.isEmpty) {
      throw const FormatException('protocolVersion must be a non-empty string');
    }
    if (clientId is! String || clientId.isEmpty) {
      throw const FormatException('clientId must be a non-empty string');
    }
    if (capabilities is! List) {
      throw const FormatException('capabilities must be a list');
    }
    final caps = <String>[
      for (final entry in capabilities)
        if (entry is! String)
          throw const FormatException('capability entries must be strings')
        else
          entry,
    ];
    return ProtocolHello(
      protocol: protocol,
      protocolVersion: version,
      clientId: clientId,
      capabilities: List.unmodifiable(caps),
    );
  }
}
