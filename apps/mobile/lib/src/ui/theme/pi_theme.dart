/// Material 3 theme foundation for Pi Mob.
///
/// Provides [piLightTheme] and [piDarkTheme] built on top of an indigo-seeded
/// [ColorScheme] with a restrained cyan accent and calm, cool neutral
/// surfaces. Component themes (cards, inputs, buttons, navigation bars) are
/// configured to keep the surface visually quiet so transcript content and
/// controls carry the focus.
///
/// The semantic status colors are exposed via [PiSemanticColors], a
/// [ThemeExtension] consumed through [BuildContext.piSemanticColors].
library;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'pi_semantic_colors.dart';
import 'pi_tokens.dart';

export 'pi_semantic_colors.dart';
export 'pi_tokens.dart';

/// Indigo seed for the primary hue. Indigo conveys focus and reliability
/// without leaning on the project-blue of typical developer tooling; it
/// also pairs well with cyan accents without looking mismatched.
const Color _piSeed = Color(0xFF4F46E5);

/// Cyan accent restraint: the secondary hue shifts away from pure cyan so
/// that combined surfaces (e.g. an indigo primary on a cyan-tinted card)
/// stay low-contrast. Material's tonal palette algorithm honors this on
/// its own when the seed is provided.
const Color _piAccent = Color(0xFF0E7490);

/// Constructs the light Material 3 theme for Pi Mob.
ThemeData piLightTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: _piSeed,
    secondary: _piAccent,
    brightness: Brightness.light,
  );
  return _buildTheme(
    colorScheme: colorScheme,
    semantic: PiSemanticColors.light,
  );
}

/// Constructs the dark Material 3 theme for Pi Mob.
ThemeData piDarkTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: _piSeed,
    secondary: _piAccent,
    brightness: Brightness.dark,
  );
  return _buildTheme(colorScheme: colorScheme, semantic: PiSemanticColors.dark);
}

ThemeData _buildTheme({
  required ColorScheme colorScheme,
  required PiSemanticColors semantic,
}) {
  final brightness = colorScheme.brightness;
  final isDark = brightness == Brightness.dark;

  // Calm neutral surfaces. Pure white/black is jarring on long sessions, so
  // we nudge the surface toward the cool end of the gray scale.
  final surfaceTint = isDark
      ? const Color(0xFF0F172A)
      : const Color(0xFFF8FAFC);
  final canvas = isDark ? const Color(0xFF111827) : const Color(0xFFF1F5F9);

  final textTheme =
      Typography.material2021(
        platform: TargetPlatform.android,
        colorScheme: colorScheme,
      ).black.apply(
        bodyColor: colorScheme.onSurface,
        displayColor: colorScheme.onSurface,
      );
  final darkTextTheme =
      Typography.material2021(
        platform: TargetPlatform.android,
        colorScheme: colorScheme,
      ).white.apply(
        bodyColor: colorScheme.onSurface,
        displayColor: colorScheme.onSurface,
      );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme.copyWith(
      surface: surfaceTint,
      surfaceContainerLowest: canvas,
      surfaceContainerLow: isDark
          ? const Color(0xFF111827)
          : const Color(0xFFF8FAFC),
      surfaceContainer: isDark
          ? const Color(0xFF1F2937)
          : const Color(0xFFEEF2F7),
      surfaceContainerHigh: isDark
          ? const Color(0xFF273449)
          : const Color(0xFFE2E8F0),
      surfaceContainerHighest: isDark
          ? const Color(0xFF334155)
          : const Color(0xFFCBD5E1),
      outlineVariant: isDark
          ? const Color(0xFF334155)
          : const Color(0xFFCBD5E1),
    ),
    scaffoldBackgroundColor: canvas,
    textTheme: isDark ? darkTextTheme : textTheme,
    splashFactory: InkRipple.splashFactory,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: <TargetPlatform, PageTransitionsBuilder>{
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      },
    ),
    iconTheme: IconThemeData(color: colorScheme.onSurfaceVariant),
    appBarTheme: AppBarTheme(
      backgroundColor: surfaceTint,
      foregroundColor: colorScheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 1,
      centerTitle: false,
      titleTextStyle: (isDark ? darkTextTheme : textTheme).titleLarge?.copyWith(
        color: colorScheme.onSurface,
        fontWeight: FontWeight.w600,
      ),
    ),
    cardTheme: CardThemeData(
      color: isDark ? const Color(0xFF111827) : const Color(0xFFFFFFFF),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        side: BorderSide(color: colorScheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFFFFFFF),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: PiSpacing.md,
        vertical: PiSpacing.md,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        borderSide: BorderSide(color: colorScheme.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        borderSide: BorderSide(color: colorScheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        borderSide: BorderSide(color: colorScheme.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        borderSide: BorderSide(color: colorScheme.error),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
        borderSide: BorderSide(color: colorScheme.error, width: 1.5),
      ),
      labelStyle: TextStyle(color: colorScheme.onSurfaceVariant),
      hintStyle: TextStyle(color: colorScheme.onSurfaceVariant),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.lg,
          vertical: PiSpacing.md,
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.lg,
          vertical: PiSpacing.md,
        ),
        side: BorderSide(color: colorScheme.outline),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.md,
          vertical: PiSpacing.sm,
        ),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surfaceTint,
      indicatorColor: colorScheme.secondaryContainer,
      elevation: 0,
      height: 64,
      labelTextStyle: WidgetStatePropertyAll<TextStyle>(
        TextStyle(color: colorScheme.onSurface, fontWeight: FontWeight.w500),
      ),
      iconTheme: WidgetStatePropertyAll<IconThemeData>(
        IconThemeData(color: colorScheme.onSurfaceVariant),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: surfaceTint,
      indicatorColor: colorScheme.secondaryContainer,
      selectedIconTheme: IconThemeData(color: colorScheme.onSecondaryContainer),
      unselectedIconTheme: IconThemeData(color: colorScheme.onSurfaceVariant),
      selectedLabelTextStyle: TextStyle(
        color: colorScheme.onSurface,
        fontWeight: FontWeight.w600,
      ),
      unselectedLabelTextStyle: TextStyle(color: colorScheme.onSurfaceVariant),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surfaceTint,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PiRadius.lg),
        side: BorderSide(color: colorScheme.outlineVariant),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surfaceTint,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(PiRadius.lg)),
      ),
      showDragHandle: true,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: colorScheme.inverseSurface,
      contentTextStyle: TextStyle(color: colorScheme.onInverseSurface),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: colorScheme.outlineVariant,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: colorScheme.onSurfaceVariant,
      textColor: colorScheme.onSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PiRadius.md),
      ),
    ),
    extensions: <ThemeExtension<dynamic>>[semantic],
  );
}
