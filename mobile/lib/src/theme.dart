import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Ink & glass tokens — mirrors `[data-sketch-console]` in globals.css.
abstract final class QlixColors {
  static const ink = Color(0xFF0E0D12);
  static const inkSecondary = Color(0x9E0E0D12); // ~62%
  static const inkTertiary = Color(0x6B0E0D12); // ~42%

  /// Brand accent (orange — `--sketch-purple` on web).
  static const accent = Color(0xFFF97316);
  static const accentHover = Color(0xFFEA580C);
  static const accentSoft = Color(0x17F97316); // ~9%
  static const accentBorder = Color(0x59F97316); // ~35%

  static const green = Color(0xFF15803D);
  static const greenSoft = Color(0x1A15803D);
  static const red = Color(0xFFDC2626);
  static const redSoft = Color(0x14DC2626);
  static const warning = Color(0xFFB45309);
  static const warningSoft = Color(0x1AB45309);

  static const paper = Color(0xFFF2F1EE);
  static const paperHi = Color(0xFFFAF9F7);
  static const paperLo = Color(0xFFEDECEA);

  static const inkBorder = Color(0x21121018); // ~13%
  static const inkBorderStrong = Color(0x42121018); // ~26%

  static const glass = Color(0x94FFFFFF); // ~58% white
  static const glassStrong = Color(0xB8FFFFFF);
  static const white = Color(0xFFFFFFFF);
}

abstract final class QlixMotion {
  static const ease = Cubic(0.22, 1.0, 0.36, 1.0);
  static const fast = Duration(milliseconds: 200);
  static const section = Duration(milliseconds: 440);
  static const stagger = Duration(milliseconds: 65);
}

/// Light "ink & glass" theme matching the Qlix web console.
ThemeData buildQlixTheme() {
  const scheme = ColorScheme.light(
    primary: QlixColors.accent,
    onPrimary: QlixColors.white,
    primaryContainer: QlixColors.accentSoft,
    onPrimaryContainer: QlixColors.accentHover,
    secondary: QlixColors.ink,
    onSecondary: QlixColors.white,
    surface: QlixColors.paper,
    onSurface: QlixColors.ink,
    onSurfaceVariant: QlixColors.inkSecondary,
    error: QlixColors.red,
    onError: QlixColors.white,
    outline: QlixColors.inkBorder,
    outlineVariant: QlixColors.inkBorder,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: scheme,
    scaffoldBackgroundColor: Colors.transparent,
    fontFamily: null, // platform SF / Roboto — matches web system stack
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      foregroundColor: QlixColors.ink,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      titleTextStyle: TextStyle(
        color: QlixColors.ink,
        fontSize: 15,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.2,
      ),
    ),
    dividerColor: QlixColors.inkBorder,
    splashFactory: InkRipple.splashFactory,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: QlixColors.glassStrong,
      hintStyle: const TextStyle(color: QlixColors.inkTertiary, fontSize: 13),
      labelStyle: const TextStyle(color: QlixColors.inkSecondary, fontSize: 13),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: QlixColors.inkBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: QlixColors.inkBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: QlixColors.accentBorder, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: QlixColors.red),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: QlixColors.ink,
        foregroundColor: QlixColors.white,
        disabledBackgroundColor: QlixColors.ink.withValues(alpha: 0.35),
        minimumSize: const Size.fromHeight(48),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.4,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: QlixColors.ink,
        side: const BorderSide(color: QlixColors.inkBorderStrong),
        minimumSize: const Size.fromHeight(44),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: QlixColors.inkSecondary,
        textStyle: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          letterSpacing: 0.3,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: QlixColors.glass,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: QlixColors.inkBorder),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: QlixColors.glass,
      selectedColor: QlixColors.accentSoft,
      labelStyle: const TextStyle(fontSize: 11, letterSpacing: 0.6),
      side: const BorderSide(color: QlixColors.inkBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: QlixColors.accent,
    ),
    refreshIndicatorTheme: const RefreshIndicatorThemeData(
      color: QlixColors.accent,
      backgroundColor: QlixColors.white,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: QlixColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
    ),
    drawerTheme: const DrawerThemeData(
      backgroundColor: QlixColors.white,
    ),
    textTheme: const TextTheme(
      displayLarge: TextStyle(
        color: QlixColors.ink,
        fontWeight: FontWeight.w300,
        letterSpacing: -1.2,
      ),
      headlineMedium: TextStyle(
        color: QlixColors.ink,
        fontWeight: FontWeight.w600,
        fontSize: 26,
        letterSpacing: -0.4,
      ),
      headlineSmall: TextStyle(
        color: QlixColors.ink,
        fontWeight: FontWeight.w700,
        fontSize: 22,
        letterSpacing: -0.3,
      ),
      titleLarge: TextStyle(
        color: QlixColors.ink,
        fontWeight: FontWeight.w700,
        fontSize: 18,
        letterSpacing: -0.2,
      ),
      titleMedium: TextStyle(
        color: QlixColors.ink,
        fontWeight: FontWeight.w600,
        fontSize: 15,
      ),
      bodyLarge: TextStyle(color: QlixColors.ink, fontSize: 15, height: 1.4),
      bodyMedium: TextStyle(color: QlixColors.ink, fontSize: 13, height: 1.45),
      bodySmall: TextStyle(color: QlixColors.inkSecondary, fontSize: 12),
      labelLarge: TextStyle(
        color: QlixColors.inkSecondary,
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.5,
      ),
      labelSmall: TextStyle(
        color: QlixColors.inkTertiary,
        fontSize: 10,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.4,
      ),
    ),
  );

  return base;
}

Color toneColor(BuildContext context, String tone) {
  switch (tone) {
    case 'success':
      return QlixColors.green;
    case 'warn':
      return QlixColors.warning;
    case 'error':
      return QlixColors.red;
    case 'accent':
      return QlixColors.accent;
    default:
      return QlixColors.inkSecondary;
  }
}
