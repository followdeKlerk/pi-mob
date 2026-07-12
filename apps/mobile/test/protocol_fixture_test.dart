import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/protocol_fixture.dart';
import 'test_asset_loader.dart';

void main() {
  test('hello.valid.json decodes into an immutable ProtocolHello', () async {
    final asset = await TestAssetLoader.loadString(
      'packages/protocol-fixtures/corpus/hello.valid.json',
    );
    final decoded =
        ProtocolHello.fromJson(jsonDecode(asset) as Map<String, Object?>);
    expect(decoded.protocol, 'hello');
    expect(decoded.protocolVersion, '1.0');
    expect(decoded.clientId, isNotEmpty);
    expect(decoded.capabilities, isA<List<String>>());
  });

  test('hello.invalid.json rejects malformed capability type', () async {
    final asset = await TestAssetLoader.loadString(
      'packages/protocol-fixtures/corpus/hello.invalid.json',
    );
    expect(
      () => ProtocolHello.fromJson(jsonDecode(asset) as Map<String, Object?>),
      throwsFormatException,
    );
  });
}
