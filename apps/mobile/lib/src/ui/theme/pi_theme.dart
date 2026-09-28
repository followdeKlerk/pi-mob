/// Material 3 theme foundation for Pi Mob.
///
/// Orchid, mint and apricot accents on softly tinted surfaces. Strong action
/// contrast and rounded native Material controls keep the personality useful.
/// Status colors remain independent from the brand palette.
library;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'pi_semantic_colors.dart';
import 'pi_tokens.dart';

export 'pi_semantic_colors.dart';
export 'pi_tokens.dart';

/// Saturated orchid with a cool mint counterpoint.
const Color _piSeed = Color(0xFF6541C8);
const Color _piAccent = Color(0xFF006B60);

/// Constructs the light Material 3 theme for Pi Mob.
ThemeData piLightTheme() {
  final colorScheme =
      ColorScheme.fromSeed(
        seedColor: _piSeed,
        secondary: _piAccent,
        brightness: Brightness.light,
      ).copyWith(
        primary: const Color(0xFF6541C8),
        onPrimary: const Color(0xFFFFFFFF),
        primaryContainer: const Color(0xFFEADDFF),
        onPrimaryContainer: const Color(0xFF261052),
        secondary: const Color(0xFF006B60),
        onSecondary: const Color(0xFFFCF8FF),
        secondaryContainer: const Color(0xFFB6F2DE),
        onSecondaryContainer: const Color(0xFF002E27),
        tertiary: const Color(0xFF934522),
        onTertiary: const Color(0xFFFFFFFF),
        tertiaryContainer: const Color(0xFFFFDBCA),
        onTertiaryContainer: const Color(0xFF351000),
        surface: const Color(0xFFFCF8FF),
        onSurface: const Color(0xFF211A2C),
        onSurfaceVariant: const Color(0xFF62596F),
        outline: const Color(0xFF80758E),
        outlineVariant: const Color(0xFFE5DCEE),
        error: const Color(0xFFB53333),
        errorContainer: const Color(0xFFFADDD7),
      );
  return _buildTheme(
    colorScheme: colorScheme,
    semantic: PiSemanticColors.light,
  );
}

/// Constructs the dark Material 3 theme for Pi Mob.
ThemeData piDarkTheme() {
  final colorScheme =
      ColorScheme.fromSeed(
        seedColor: _piSeed,
        secondary: _piAccent,
        brightness: Brightness.dark,
      ).copyWith(
        primary: const Color(0xFFCFB6FF),
        onPrimary: const Color(0xFF351370),
        primaryContainer: const Color(0xFF4D2CA0),
        onPrimaryContainer: const Color(0xFFEADDFF),
        secondary: const Color(0xFF82D8C1),
        onSecondary: const Color(0xFF00382F),
        secondaryContainer: const Color(0xFF005044),
        onSecondaryContainer: const Color(0xFFB6F2DE),
        tertiary: const Color(0xFFFFB596),
        onTertiary: const Color(0xFF542008),
        tertiaryContainer: const Color(0xFF733318),
        onTertiaryContainer: const Color(0xFFFFDBCA),
        surface: const Color(0xFF201A29),
        onSurface: const Color(0xFFF0E7F7),
        onSurfaceVariant: const Color(0xFFC8BCD4),
        outline: const Color(0xFF94879F),
        outlineVariant: const Color(0xFF493F55),
        error: const Color(0xFFE8836F),
        errorContainer: const Color(0xFF7A2018),
      );
  return _buildTheme(colorScheme: colorScheme, semantic: PiSemanticColors.dark);
}

ThemeData _buildTheme({
  required ColorScheme colorScheme,
  required PiSemanticColors semantic,
}) {
  final brightness = colorScheme.brightness;
  final isDark = brightness == Brightness.dark;

  // Tinted canvas separates floating controls from the reading surface.
  final surfaceTint = isDark
      ? const Color(0xFF201A29)
      : const Color(0xFFFCF8FF);
  final canvas = isDark ? const Color(0xFF211A2C) : const Color(0xFFF4EEFA);

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
      surfaceContainerLowest: isDark
          ? const Color(0xFF120E19)
          : const Color(0xFFFFFFFF),
      surfaceContainerLow: isDark
          ? const Color(0xFF1B1524)
          : const Color(0xFFF4EEFA),
      surfaceContainer: isDark
          ? const Color(0xFF251E30)
          : const Color(0xFFEFE6F7),
      surfaceContainerHigh: isDark
          ? const Color(0xFF30273C)
          : const Color(0xFFEAE0F3),
      surfaceContainerHighest: isDark
          ? const Color(0xFF3B3147)
          : const Color(0xFFE3D7ED),
      outlineVariant: isDark
          ? const Color(0xFF493F55)
          : const Color(0xFFE5DCEE),
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
        fontWeight: FontWeight.w700,
      ),
    ),
    cardTheme: CardThemeData(
      color: isDark ? const Color(0xFF201A29) : const Color(0xFFFCF8FF),
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
      fillColor: isDark ? const Color(0xFF1B1524) : const Color(0xFFFCF8FF),
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
        minimumSize: const Size(48, 48),
        textStyle: (isDark ? darkTextTheme : textTheme).labelLarge?.copyWith(
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
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
        minimumSize: const Size(48, 48),
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
        minimumSize: const Size(48, 48),
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
