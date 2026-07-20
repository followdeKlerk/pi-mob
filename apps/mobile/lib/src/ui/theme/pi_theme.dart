/// Material 3 theme foundation for Pi Mob.
///
/// Provides [piLightTheme] and [piDarkTheme] built on top of an indigo-seeded
/// [ColorScheme] with a warm terracotta accent and paper-like neutral
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

/// Warm clay accent and supporting neutrals, inspired by editorial paper
/// interfaces rather than the default cool-blue developer palette.
const Color _piSeed = Color(0xFFC96442);
const Color _piAccent = Color(0xFF7D6757);

/// Constructs the light Material 3 theme for Pi Mob.
ThemeData piLightTheme() {
  final colorScheme =
      ColorScheme.fromSeed(
        seedColor: _piSeed,
        secondary: _piAccent,
        brightness: Brightness.light,
      ).copyWith(
        primary: const Color(0xFFC96442),
        onPrimary: const Color(0xFFFAF9F5),
        primaryContainer: const Color(0xFFFCE4D8),
        onPrimaryContainer: const Color(0xFF3A1D10),
        secondary: const Color(0xFF7D6757),
        onSecondary: const Color(0xFFFAF9F5),
        secondaryContainer: const Color(0xFFEFE0D2),
        onSecondaryContainer: const Color(0xFF2A1F17),
        tertiary: const Color(0xFF6F7F4F),
        surface: const Color(0xFFFAF9F5),
        onSurface: const Color(0xFF141413),
        onSurfaceVariant: const Color(0xFF5E5D59),
        outline: const Color(0xFF87867F),
        outlineVariant: const Color(0xFFE8E6DC),
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
        primary: const Color(0xFFD97757),
        onPrimary: const Color(0xFF2A1208),
        primaryContainer: const Color(0xFF7A3D23),
        onPrimaryContainer: const Color(0xFFFCE4D8),
        secondary: const Color(0xFFCFC0B1),
        onSecondary: const Color(0xFF3A2F25),
        secondaryContainer: const Color(0xFF5E4D40),
        onSecondaryContainer: const Color(0xFFEFE0D2),
        tertiary: const Color(0xFFBCC99A),
        surface: const Color(0xFF1F1E1B),
        onSurface: const Color(0xFFEAE6DA),
        onSurfaceVariant: const Color(0xFFB0AEA5),
        outline: const Color(0xFF73726C),
        outlineVariant: const Color(0xFF3D3D3A),
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

  // Warm paper in light mode and warm near-black in dark mode.
  final surfaceTint = isDark
      ? const Color(0xFF1F1E1B)
      : const Color(0xFFFAF9F5);
  final canvas = isDark ? const Color(0xFF141413) : const Color(0xFFF5F4ED);

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
          ? const Color(0xFF0F0F0E)
          : const Color(0xFFFFFFFF),
      surfaceContainerLow: isDark
          ? const Color(0xFF1A1917)
          : const Color(0xFFF5F4ED),
      surfaceContainer: isDark
          ? const Color(0xFF1E1D1A)
          : const Color(0xFFF0EEE5),
      surfaceContainerHigh: isDark
          ? const Color(0xFF272621)
          : const Color(0xFFEBE8DE),
      surfaceContainerHighest: isDark
          ? const Color(0xFF322F2A)
          : const Color(0xFFE5E2D7),
      outlineVariant: isDark
          ? const Color(0xFF3D3D3A)
          : const Color(0xFFE8E6DC),
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
      color: isDark ? const Color(0xFF1F1E1B) : const Color(0xFFFAF9F5),
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
      fillColor: isDark ? const Color(0xFF1A1917) : const Color(0xFFFAF9F5),
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
