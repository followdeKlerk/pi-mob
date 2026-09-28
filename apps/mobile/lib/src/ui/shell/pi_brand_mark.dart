import 'package:flutter/material.dart';

/// Static brand tile: personality without an idle animation or image asset.
class PiBrandMark extends StatelessWidget {
  const PiBrandMark({this.size = 64, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: size + 8,
        child: Stack(
          children: [
            Positioned.fill(
              left: 8,
              top: 8,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.secondaryContainer,
                  borderRadius: BorderRadius.circular(size * .3),
                ),
              ),
            ),
            Container(
              width: size,
              height: size,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: colors.primary,
                borderRadius: BorderRadius.circular(size * .3),
              ),
              child: Icon(
                Icons.terminal_rounded,
                color: colors.onPrimary,
                size: size * .55,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
