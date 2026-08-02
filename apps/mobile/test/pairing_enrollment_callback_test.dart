import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/pairing/pairing_enrollment.dart';
import 'package:pi_mob/src/pairing/pairing_payload.dart';
import 'package:pi_mob/src/security/secure_credential_store.dart';

class _Store implements SecureCredentialStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String credential) async => value = credential;
  @override
  Future<void> clear() async => value = null;
}

void main() {
  test(
    'enrollment posts passcode to the explicit bridge port and stores credential',
    () async {
      final secure = _Store();
      final endpoint = Uri.parse('https://host.tailnet.ts.net:8788');
      final payload = PairingPayload(
        endpoint: endpoint,
        passcode: '123456',
        expiresAt: DateTime.now().toUtc().add(const Duration(minutes: 5)),
      );
      Uri? postedEndpoint;
      Map<String, Object?>? postedBody;
      final enrollment = PairingEnrollmentService(
        secureCredentialStore: secure,
        post: (uri, body) async {
          postedEndpoint = uri;
          postedBody = body;
          return EnrollmentHttpResponse(
            statusCode: 201,
            body: {'installationCredential': 'pc_${'A' * 43}'},
          );
        },
      );

      await enrollment.enroll(payload, '11111111-2222-4333-8444-555555555555');

      expect(postedEndpoint, endpoint);
      expect(postedBody, {
        'installationId': '11111111-2222-4333-8444-555555555555',
        'passcode': '123456',
      });
      expect(secure.value, startsWith('pc_'));
    },
  );

  test('expired and replayed passcodes fail before a second POST', () async {
    final secure = _Store();
    var posts = 0;
    final enrollment = PairingEnrollmentService(
      secureCredentialStore: secure,
      post: (_, __) async {
        posts++;
        return EnrollmentHttpResponse(
          statusCode: 201,
          body: {'installationCredential': 'pc_${'B' * 43}'},
        );
      },
    );
    final base = PairingPayload(
      endpoint: Uri.parse('https://host.tailnet.ts.net:9443'),
      passcode: '654321',
      expiresAt: DateTime.now().toUtc().add(const Duration(minutes: 5)),
    );
    await enrollment.enroll(base, '11111111-2222-4333-8444-555555555555');
    await expectLater(
      enrollment.enroll(base, '11111111-2222-4333-8444-555555555555'),
      throwsA(isA<EnrollmentPairingException>()),
    );
    expect(posts, 1);
    await expectLater(
      enrollment.enroll(
        PairingPayload(
          endpoint: base.endpoint,
          passcode: '000000',
          expiresAt: DateTime.now().toUtc().subtract(
            const Duration(seconds: 1),
          ),
        ),
        '11111111-2222-4333-8444-555555555555',
      ),
      throwsA(isA<EnrollmentPairingException>()),
    );
  });
}
