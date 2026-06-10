import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Thin wrapper over [FlutterSecureStorage] for the session JWT.
///
/// The token is stored in the platform Keychain (iOS) / Keystore-backed
/// EncryptedSharedPreferences (Android). It mirrors the `qlix_session` cookie
/// the web app relies on, but lives in secure storage for a native client.
class SecureStore {
  SecureStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const _tokenKey = 'qlix_jwt';

  Future<String?> readToken() => _storage.read(key: _tokenKey);

  Future<void> writeToken(String token) =>
      _storage.write(key: _tokenKey, value: token);

  Future<void> clear() => _storage.delete(key: _tokenKey);
}
