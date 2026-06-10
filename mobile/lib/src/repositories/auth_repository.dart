import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../core/secure_store.dart';
import '../models/session.dart';

class AuthResult {
  const AuthResult({required this.ok, this.session, this.errorMessage});

  final bool ok;
  final Session? session;
  final String? errorMessage;
}

/// Auth endpoints on the shared backend (`/api/v1/auth/*`). Stores the JWT
/// returned in the JSON body into secure storage so subsequent requests carry
/// `Authorization: Bearer`.
class AuthRepository {
  AuthRepository({required this.client, required this.store});

  final ApiClient client;
  final SecureStore store;

  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    return _authCall(
      '/auth/login',
      {'email': email, 'password': password},
      'Login failed',
    );
  }

  Future<AuthResult> signup({
    required String email,
    required String password,
    String? displayName,
    required String workspaceType,
  }) async {
    return _authCall(
      '/auth/signup',
      {
        'email': email,
        'password': password,
        if (displayName != null && displayName.trim().isNotEmpty)
          'displayName': displayName.trim(),
        'workspaceType': workspaceType,
      },
      'Sign up failed',
    );
  }

  Future<AuthResult> _authCall(
    String path,
    Map<String, dynamic> body,
    String fallbackError,
  ) async {
    try {
      final res = await client.dio.post<dynamic>(path, data: body);
      final data = res.data;
      if ((res.statusCode == 200 || res.statusCode == 201) &&
          data is Map<String, dynamic>) {
        final session = Session.fromJson(data);
        final token = session.token;
        if (token != null && token.isNotEmpty) {
          await store.writeToken(token);
        }
        return AuthResult(ok: true, session: session);
      }
      return AuthResult(
        ok: false,
        errorMessage: apiErrorMessage(data, fallbackError),
      );
    } on DioException catch (e) {
      return AuthResult(
        ok: false,
        errorMessage: apiErrorMessage(e.response?.data, fallbackError),
      );
    }
  }

  /// Rehydrates the current session from the stored token. Returns null when
  /// there is no valid session.
  Future<Session?> me() async {
    final token = await store.readToken();
    if (token == null || token.isEmpty) return null;
    try {
      final res = await client.dio.get<dynamic>('/auth/me');
      final data = res.data;
      if (res.statusCode == 200 && data is Map<String, dynamic>) {
        return Session.fromJson(data);
      }
      return null;
    } on DioException {
      return null;
    }
  }

  Future<void> logout() async {
    try {
      await client.dio.post<dynamic>('/auth/logout');
    } catch (_) {
      // Best-effort; the local token is the source of truth for the app.
    }
    await store.clear();
  }
}
