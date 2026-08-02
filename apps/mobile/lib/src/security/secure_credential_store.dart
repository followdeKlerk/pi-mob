import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Android Keystore-backed storage for the per-installation bearer credential.
abstract interface class SecureCredentialStore {
  Future<String?> read();
  Future<void> write(String credential);
  Future<void> clear();
}

class InMemorySecureCredentialStore implements SecureCredentialStore {
  String? _value;
  @override
  Future<String?> read() async => _value;
  @override
  Future<void> write(String credential) async => _value = credential;
  @override
  Future<void> clear() async => _value = null;
}

class KeychainSecureCredentialStore implements SecureCredentialStore {
  KeychainSecureCredentialStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage(
          aOptions: AndroidOptions(
            encryptedSharedPreferences: true,
            resetOnError: true,
          ),
        );

  static const String _key = 'pi-mob.installationCredential.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() async {
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String credential) async {
    if (credential.isEmpty) {
      await clear();
      return;
    }
    await _storage.write(key: _key, value: credential);
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {
      // Storage cleanup is best effort on platforms without a backend.
    }
  }
}
