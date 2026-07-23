/// Visible focus indicator for M16-08.
///
/// Wraps an interactive widget with a clearly visible focus ring whenever
/// the keyboard / D-pad / switch control moves focus to the wrapped child.
/// The ring uses the active [ColorScheme.primary] so it remains visible
/// across light/dark themes; the user is never asked to "guess" where
/// focus lives.
///
/// The widget is intentionally non-intrusive: the focus ring only paints
/// when [FocusManager] reports that focus is held by the child, so sighted
/// mouse/touch users never see decoration while focus is invisible.
library;

import 'package:flutter/material.dart';

import '../theme/pi_tokens.dart';

class FocusRing extends StatelessWidget {
  const FocusRing({required this.child, this.borderRadius, super.key});

  final Widget child;
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    final focusNode = FocusNode(skipTraversal: false);
    return Focus(
      focusNode: focusNode,
      child: ListenableBuilder(
        listenable: focusNode,
        builder: (context, _) {
          final hasFocus = focusNode.hasFocus;
          return AnimatedContainer(
            duration: PiDuration.short,
            curve: PiCurve.decelerate,
            decoration: BoxDecoration(
              borderRadius: borderRadius ?? BorderRadius.circular(PiRadius.md),
              border: hasFocus
                  ? Border.all(
                      color: Theme.of(context).colorScheme.primary,
                      width: 2,
                    )
                  : null,
            ),
            child: child,
          );
        },
      ),
    );
  }
}
