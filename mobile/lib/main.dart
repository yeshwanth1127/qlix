import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load config from the bundled .env. Tolerate a missing file so the app
  // still boots on the compile-time / default base URL.
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env bundled — AppConfig falls back to --dart-define or the default.
  }
  runApp(const ProviderScope(child: QlixApp()));
}
