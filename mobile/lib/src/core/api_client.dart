import 'dart:async';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import 'secure_store.dart';

/// Wraps a [Dio] instance configured for the Qlix backend.
///
/// An interceptor injects `Authorization: Bearer <jwt>` from secure storage on
/// every request. On a 401 it attempts a single `/auth/refresh` (using the
/// current token), stores the new token, and replays the failed request. If
/// refresh fails the session is cleared and [onUnauthorized] fires so the app
/// can route back to sign-in.
class ApiClient {
  ApiClient({required SecureStore store, this.onUnauthorized})
      // ignore: prefer_initializing_formals
      : _store = store {
    dio = Dio(
      BaseOptions(
        baseUrl: '${AppConfig.apiBase}/api/v1',
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 60),
        // Treat only >=500 / network as Dio errors; we read non-2xx bodies.
        validateStatus: (status) => status != null && status < 500,
      ),
    );
    // A bare client used for the refresh call to avoid interceptor recursion.
    _refreshDio = Dio(BaseOptions(baseUrl: '${AppConfig.apiBase}/api/v1'));

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _store.readToken();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final response = error.response;
          final requestPath = error.requestOptions.path;
          final isAuthEndpoint = requestPath.contains('/auth/');
          final alreadyRetried =
              error.requestOptions.extra['__retried__'] == true;

          if (response?.statusCode == 401 &&
              !isAuthEndpoint &&
              !alreadyRetried) {
            final newToken = await _tryRefresh();
            if (newToken != null) {
              final opts = error.requestOptions;
              opts.extra['__retried__'] = true;
              opts.headers['Authorization'] = 'Bearer $newToken';
              try {
                final retried = await dio.fetch<dynamic>(opts);
                return handler.resolve(retried);
              } catch (_) {
                // fall through to unauthorized handling
              }
            }
            await _store.clear();
            onUnauthorized?.call();
          }
          handler.next(error);
        },
      ),
    );
  }

  late final Dio dio;
  late final Dio _refreshDio;
  final SecureStore _store;

  /// Invoked after an unrecoverable 401 (refresh failed and token cleared).
  /// Set by the session layer after construction to avoid a provider cycle.
  void Function()? onUnauthorized;

  Completer<String?>? _refreshInFlight;

  /// Attempts a single refresh, de-duplicating concurrent callers.
  Future<String?> _tryRefresh() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight.future;

    final completer = Completer<String?>();
    _refreshInFlight = completer;

    () async {
      try {
        final token = await _store.readToken();
        if (token == null || token.isEmpty) {
          completer.complete(null);
          return;
        }
        final res = await _refreshDio.post<dynamic>(
          '/auth/refresh',
          options: Options(
            headers: {'Authorization': 'Bearer $token'},
            validateStatus: (s) => s != null && s < 500,
          ),
        );
        final data = res.data;
        if (res.statusCode == 200 &&
            data is Map &&
            data['token'] is String &&
            (data['token'] as String).isNotEmpty) {
          final next = data['token'] as String;
          await _store.writeToken(next);
          completer.complete(next);
          return;
        }
        completer.complete(null);
      } catch (_) {
        completer.complete(null);
      } finally {
        _refreshInFlight = null;
      }
    }();

    return completer.future;
  }
}

/// Extracts the `error.message` field from a backend error body, if present.
String apiErrorMessage(Object? data, String fallback) {
  if (data is Map) {
    final err = data['error'];
    if (err is Map && err['message'] is String) {
      return err['message'] as String;
    }
  }
  return fallback;
}

String? apiErrorCode(Object? data) {
  if (data is Map) {
    final err = data['error'];
    if (err is Map && err['code'] is String) {
      return err['code'] as String;
    }
  }
  return null;
}
