import 'dart:convert';
import 'dart:io';

import '../connection/connection_coordinator.dart';
import '../security/secure_credential_store.dart';
import 'pairing_payload.dart';

final class EnrollmentHttpResponse {
  const EnrollmentHttpResponse({required this.statusCode, required this.body});
  final int statusCode;
  final Map<String, Object?> body;
}

typedef EnrollmentPost =
    Future<EnrollmentHttpResponse> Function(
      Uri endpoint,
      Map<String, Object?> body,
    );

final class EnrollmentPairingException implements Exception {
  const EnrollmentPairingException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Enrolls a new installation and stores only the returned credential in the
/// platform secure store. The challenge itself is never persisted.
final class PairingEnrollmentService {
  PairingEnrollmentService({
    required this.secureCredentialStore,
    EnrollmentPost? post,
  }) : _post = post ?? _postOverHttps;

  final SecureCredentialStore secureCredentialStore;
  final EnrollmentPost _post;
  final Set<String> _consumed = <String>{};

  Future<void> enroll(PairingPayload payload, String installationId) async {
    final passcode = payload.passcode;
    final expiresAt = payload.expiresAt;
    if (!expiresAt.isAfter(DateTime.now().toUtc())) {
      throw const EnrollmentPairingException(
        'This passcode has expired. Run pi-mob pair again.',
      );
    }
    if (!_consumed.add(passcode)) {
      throw const EnrollmentPairingException(
        'This passcode was already used. Run pi-mob pair again.',
      );
    }
    final response = await _post(payload.endpoint, <String, Object?>{
      'installationId': installationId,
      'passcode': passcode,
    });
    if (response.statusCode != 201) {
      throw EnrollmentPairingException(
        response.statusCode == 410
            ? 'This passcode has expired or was already used. Run pi-mob pair again.'
            : 'The bridge rejected this passcode. Run pi-mob pair again.',
      );
    }
    final credential = response.body['installationCredential'];
    if (credential is! String ||
        !RegExp(r'^pc_[A-Za-z0-9_-]{43}$').hasMatch(credential)) {
      throw const EnrollmentPairingException(
        'The bridge returned an invalid pairing credential.',
      );
    }
    await secureCredentialStore.write(credential);
  }
}

Future<void> completePairing({
  required PairingPayload payload,
  required ConnectionCoordinator coordinator,
  required PairingEnrollmentService enrollment,
}) async {
  await enrollment.enroll(payload, coordinator.installationId);
  await coordinator.pairAndWait(payload.endpoint.toString());
}

Future<EnrollmentHttpResponse> _postOverHttps(
  Uri endpoint,
  Map<String, Object?> body,
) async {
  final client = HttpClient();
  try {
    final request = await client.postUrl(
      endpoint.replace(path: '/v1/enroll', query: null, fragment: null),
    );
    request.headers.contentType = ContentType.json;
    final encoded = utf8.encode(jsonEncode(body));
    request.contentLength = encoded.length;
    request.add(encoded);
    final response = await request.close();
    final bytes = await response.fold<List<int>>(<int>[], (all, chunk) {
      if (all.length + chunk.length > 16 * 1024) {
        throw const EnrollmentPairingException(
          'The bridge enrollment response is too large.',
        );
      }
      return all..addAll(chunk);
    });
    Map<String, Object?> decoded = <String, Object?>{};
    if (bytes.isNotEmpty) {
      final value = jsonDecode(utf8.decode(bytes));
      if (value is Map) decoded = Map<String, Object?>.from(value);
    }
    return EnrollmentHttpResponse(
      statusCode: response.statusCode,
      body: decoded,
    );
  } on EnrollmentPairingException {
    rethrow;
  } on Object {
    throw const EnrollmentPairingException(
      'The bridge could not be reached for enrollment.',
    );
  } finally {
    client.close(force: true);
  }
}
