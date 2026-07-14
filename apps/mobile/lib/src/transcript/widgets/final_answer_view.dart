/// Final-answer widget for the transcript.
///
/// Renders a [FinalAnswerViewData] through the safe Markdown subset parser
/// in `view_data/safe_markdown.dart`. The widget is intentionally a thin
/// wrapper around the parsed blocks: the parser is the security boundary,
/// and we expose a single visible Markdown body plus the link tap callback.
///
/// The widget never inspects the raw protocol payload. All decisions about
/// which inline marks survive, what links are dropped, and what becomes a
/// paragraph happen in the parser.
library;

import 'package:flutter/material.dart';

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

  @override
  Widget build(BuildContext context) {
    final document = parseSafeMarkdown(data.markdown);
    final theme = Theme.of(context);
    final baseStyle = theme.textTheme.bodyMedium ?? const TextStyle();
    final codeStyle = const TextStyle(fontFamily: 'monospace');
    final linkStyle = baseStyle.copyWith(
      color: theme.colorScheme.primary,
      decoration: TextDecoration.underline,
    );
    final widgets = buildSafeMarkdownWidgets(
      document,
      baseStyle: baseStyle,
      codeStyle: codeStyle,
      linkStyle: linkStyle,
      onLinkTap: onLinkTap,
    );
    return Semantics(
      container: true,
      label: 'Assistant answer',
      child: Card(
        margin: const EdgeInsets.symmetric(vertical: 4),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: widgets,
          ),
        ),
      ),
    );
  }
}
