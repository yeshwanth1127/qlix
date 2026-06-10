import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Static app configuration.
///
/// Resolution order for the API base URL:
///   1. `.env` file value `QLIX_API_BASE_URL` (loaded at startup).
///   2. A compile-time `--dart-define=QLIX_API_BASE_URL=...` override.
///   3. The Android emulator loopback alias (`10.0.2.2` maps to the host's
///      `localhost`) as a last resort.
class AppConfig {
  const AppConfig._();

  static const String _compileTimeUrl = String.fromEnvironment(
    'QLIX_API_BASE_URL',
    defaultValue: '',
  );

  static const String _fallbackUrl = 'http://10.0.2.2:4000';

  /// Normalized base without a trailing slash.
  static String get apiBase {
    final fromEnvFile = _dotenvValue();
    final raw = fromEnvFile.isNotEmpty
        ? fromEnvFile
        : (_compileTimeUrl.isNotEmpty ? _compileTimeUrl : _fallbackUrl);
    final trimmed = raw.trim();
    return trimmed.endsWith('/')
        ? trimmed.substring(0, trimmed.length - 1)
        : trimmed;
  }

  static String _dotenvValue() {
    // `dotenv.env` is empty if `dotenv.load` hasn't run or the key is absent.
    if (!dotenv.isInitialized) return '';
    return dotenv.maybeGet('QLIX_API_BASE_URL')?.trim() ?? '';
  }
}
