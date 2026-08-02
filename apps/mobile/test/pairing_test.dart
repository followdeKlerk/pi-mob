import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/pairing/pairing_flow.dart';
import 'package:pi_mob/src/pairing/pairing_payload.dart';
import 'package:pi_mob/src/pairing/pairing_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('manual pairing validation', () {
    test('accepts endpoint and six-digit passcode', () {
      final payload = validatePairingInput(
        endpoint: 'https://host.tailnet.ts.net:8788',
        passcode: '123456',
      );
      expect(payload.endpoint.toString(), 'https://host.tailnet.ts.net:8788');
      expect(payload.passcode, '123456');
      expect(payload.expiresAt.isAfter(DateTime.now().toUtc()), isTrue);
    });

    test('accepts the alternate approved Serve port', () {
      final payload = validatePairingInput(
        endpoint: 'https://host.tailnet.ts.net:9443',
        passcode: '654321',
      );
      expect(payload.endpoint.port, 9443);
    });

    test('rejects unsafe endpoints and ports', () {
      for (final endpoint in <String>[
        'http://host.tailnet.ts.net:8788',
        'https://example.com:8788',
        'https://host.tailnet.ts.net:8443',
        'https://host.tailnet.ts.net:1',
        'https://user@host.tailnet.ts.net:8788',
        'https://host.tailnet.ts.net:8788/path',
        'https://host.tailnet.ts.net:8788?x=1',
      ]) {
        expect(
          () => validatePairingInput(endpoint: endpoint, passcode: '123456'),
          throwsA(isA<PairingValidationFailure>()),
          reason: endpoint,
        );
      }
    });

    test('rejects malformed passcodes', () {
      for (final passcode in <String>['', '12345', '1234567', '12a456']) {
        expect(
          () => validatePairingInput(
            endpoint: 'https://host.tailnet.ts.net:8788',
            passcode: passcode,
          ),
          throwsA(isA<PairingValidationFailure>()),
        );
      }
    });
  });

  group('PairingFlowController', () {
    test('submits endpoint and passcode without QR or JSON state', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedEndpoint('https://host.tailnet.ts.net:8788');
      flow.updateTypedPasscode('123456');
      expect(flow.submit(), isTrue);
      expect(flow.candidate?.endpoint.port, 8788);
      expect(flow.candidate?.passcode, '123456');
      expect(flow.rejection, isNull);
    });

    test('surfaces endpoint and passcode errors', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedEndpoint('https://host.tailnet.ts.net:8443');
      flow.updateTypedPasscode('12345');
      expect(flow.submit(), isFalse);
      expect(flow.phase, PairingPhase.rejected);
      expect(flow.rejection, PairingRejection.portNotAllowed);
    });
  });

  testWidgets('pairing UI has endpoint and passcode fields only', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PairingScreen(onPair: (_) async {}, onForgetHost: () async {}),
      ),
    );
    expect(find.byKey(const Key('manual-endpoint-field')), findsOneWidget);
    expect(find.byKey(const Key('pairing-passcode-field')), findsOneWidget);
    expect(find.byKey(const Key('pairing-submit')), findsOneWidget);
    expect(find.text('Camera'), findsNothing);
    expect(find.textContaining('QR'), findsNothing);
    expect(find.byKey(const Key('manual-json-field')), findsNothing);
  });

  testWidgets('pair button submits the explicit endpoint and passcode', (
    tester,
  ) async {
    PairingPayload? received;
    await tester.pumpWidget(
      MaterialApp(
        home: PairingScreen(
          onPair: (payload) async => received = payload,
          onForgetHost: () async {},
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const Key('manual-endpoint-field')),
      'https://host.tailnet.ts.net:8788',
    );
    await tester.enterText(
      find.byKey(const Key('pairing-passcode-field')),
      '123456',
    );
    await tester.tap(find.byKey(const Key('pairing-submit')));
    await tester.pumpAndSettle();
    expect(received?.endpoint.port, 8788);
    expect(received?.passcode, '123456');
  });
}
