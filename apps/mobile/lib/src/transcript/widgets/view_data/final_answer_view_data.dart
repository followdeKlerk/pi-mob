/// View-data for the final-answer turn.
///
/// The final answer is the model's user-facing response. It is the only
/// piece of the transcript the user is expected to read end-to-end, so the
/// mobile widget renders it with a small dependency-free Markdown subset.
///
/// **Security**: links are restricted to `http` and `https` schemes only.
/// `javascript:`, `file:`, `data:`, and any other scheme are stripped to
/// their text content so the widget never opens an unsafe URL even by
/// accident. See `safe_markdown.dart` for the link normalizer.
library;

/// View-data describing one final-answer turn.
class FinalAnswerViewData {
  const FinalAnswerViewData({required this.answerId, required this.markdown});

  /// Stable identifier. Used as a widget key so the framework preserves the
  /// rendered subtree across rebuilds.
  final String answerId;

  /// Raw Markdown source. The widget parses this with the safe subset parser
  /// defined in `safe_markdown.dart`. Input is treated as untrusted: any
  /// malformed inline syntax falls back to literal text rather than throwing.
  final String markdown;
}
