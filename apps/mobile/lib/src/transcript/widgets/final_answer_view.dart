/// Final-answer widget for the transcript.
///
/// Renders a [FinalAnswerViewData] through the safe Markdown subset parser
/// in `view_data/safe_markdown.dart`. The widget is intentionally a thin
/// wrapper around the parsed blocks: the parser is the security boundary,
/// and we expose a single visible Markdown body plus the link tap callback.
///
/// Presentation: the final answer is the primary reading surface in the
/// transcript. It renders **edge-to-edge** against the surrounding surface
/// (no nested card chrome, no elevated container, no extra margin) so the
/// reader can focus on the prose. Typography draws from
/// `Theme.of(context).textTheme` so it cooperates with the rest of the
/// app's hierarchy and the upcoming token theme work.
///
/// The widget never inspects the raw protocol payload. All decisions about
/// which inline marks survive, what links are dropped, and what becomes a
/// paragraph happen in the parser.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'view_data/final_answer_view_data.dart';
import 'view_data/safe_markdown.dart';

/// Final-answer widget. Use [FinalAnswerView.forViewData] to build it.
class FinalAnswerView extends StatelessWidget {
  const FinalAnswerView._({
    required this.data,
    required this.onLinkTap,
    super.key,
  });

  /// Builds a [FinalAnswerView] from a [FinalAnswerViewData]. The widget
  /// key defaults to a value derived from [FinalAnswerViewData.answerId]
  /// so the framework can reuse the [Element] across rebuilds.
  factory FinalAnswerView.forViewData(
    FinalAnswerViewData data, {
    Key? key,
    SafeMarkdownLinkTap? onLinkTap,
  }) => FinalAnswerView._(
    key: key ?? ValueKey('final-answer-${data.answerId}'),
    data: data,
    onLinkTap: onLinkTap,
  );

  /// View-data describing this final answer. Immutable.
  final FinalAnswerViewData data;

  /// Optional link-tap callback. Wired through to the safe-Markdown
  /// renderer; the URL is guaranteed to be http/https with a non-empty
  /// host before the callback fires.
  final SafeMarkdownLinkTap? onLinkTap;

  /// Horizontal inset (in logical pixels) between the edges of the transcript
  /// surface and the prose. Kept as a constant so the rhythm is identical
  /// for every answer and the layout responds predictably at 200% text
  /// scaling.
  static const double _contentInset = 16;

  /// Vertical breathing room above and below the prose. Generous enough
  /// to separate consecutive final answers without reintroducing card
  /// chrome.
  static const double _blockVerticalPadding = 12;

  @override
  Widget build(BuildContext context) {
    final document = parseSafeMarkdown(data.markdown);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // Calm, readable body type. `bodyLarge` is the primary reading size
    // in M3; it scales predictably with the system text scaler.
    final baseStyle = theme.textTheme.bodyLarge ?? const TextStyle();
    final codeStyle = baseStyle.copyWith(
      fontFamily: 'monospace',
      fontSize: (baseStyle.fontSize ?? 14) - 1,
    );
    final linkStyle = baseStyle.copyWith(
      color: scheme.primary,
      decoration: TextDecoration.underline,
      decorationColor: scheme.primary,
    );
    final widgets = buildSafeMarkdownWidgets(
      document,
      baseStyle: baseStyle,
      codeStyle: codeStyle,
      linkStyle: linkStyle,
      blockBackground: scheme.surfaceContainerHighest,
      onLinkTap: onLinkTap,
    );
    return Semantics(
      container: true,
      label: 'Assistant answer',
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: _contentInset,
            vertical: _blockVerticalPadding,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            // Loose line height keeps multi-paragraph answers readable at
            // 100% and 200% without forcing a horizontal scroll.
            mainAxisSize: MainAxisSize.min,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: Wrap(
                  spacing: 4,
                  children: [
                    IconButton(
                      key: ValueKey('copy-answer-${data.answerId}'),
                      tooltip: 'Copy answer',
                      visualDensity: VisualDensity.compact,
                      onPressed: () =>
                          Clipboard.setData(ClipboardData(text: data.markdown)),
                      icon: const Icon(Icons.copy_outlined, size: 18),
                    ),
                    IconButton(
                      key: ValueKey('share-answer-${data.answerId}'),
                      tooltip: 'Share answer',
                      visualDensity: VisualDensity.compact,
                      onPressed: () => SharePlus.instance.share(
                        ShareParams(text: data.markdown),
                      ),
                      icon: const Icon(Icons.share_outlined, size: 18),
                    ),
                  ],
                ),
              ),
              ...widgets,
            ],
          ),
        ),
      ),
    );
  }
}
