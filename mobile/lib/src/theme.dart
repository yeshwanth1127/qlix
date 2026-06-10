import 'package:flutter/material.dart';

/// A small, modern dark theme for the Qlix mobile client.
ThemeData buildQlixTheme() {
  const seed = Color(0xFF6366F1); // indigo
  final scheme = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: Brightness.dark,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFF0B0B12),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF0B0B12),
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFF15151F),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    cardTheme: CardThemeData(
      color: const Color(0xFF15151F),
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}

Color toneColor(BuildContext context, String tone) {
  switch (tone) {
    case 'success':
      return const Color(0xFF34D399);
    case 'warn':
      return const Color(0xFFFBBF24);
    case 'error':
      return const Color(0xFFF87171);
    case 'accent':
      return Theme.of(context).colorScheme.primary;
    default:
      return Theme.of(context).colorScheme.onSurfaceVariant;
  }
}
