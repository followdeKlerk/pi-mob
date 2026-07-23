/// A dependency-free safe subset of Markdown for final-answer rendering.
///
/// The parser handles only the features the transcript needs:
///
///   * Code blocks (fenced with triple backticks, optional language tag).
///   * Paragraphs separated by blank lines.
///   * Bullet lists (lines starting with `- ` or `* `).
///   * Ordered lists (lines starting with `1. `, `2. `, ...).
///   * Inline emphasis: `**bold**` and `_italic_` / `*italic*`.
///   * Inline code: `` `code` ``.
///   * Inline links: `[text](url)`. Only `http://` and `https://` schemes are
///     emitted; everything else is dropped (the text remains but no link is
///     rendered). This is the central security property of the widget.
///
/// Anything that fails to parse falls back to literal text — the parser
/// never throws on malformed input. Raw HTML, `<script>` tags, and embedded
/// scripts are simply rendered as text.
///
/// The renderer in this file is intentionally plain. The presentation layer
/// (`final_answer_view.dart`) wraps the AST in selectable text and wires
/// the link-tap callback through a [TapGestureRecognizer].
library;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../../../ui/theme/pi_tokens.dart';

/// Block-level AST nodes.
sealed class SafeMarkdownBlock {
  const SafeMarkdownBlock();
}

/// A paragraph of inline content.
class SafeMarkdownParagraph extends SafeMarkdownBlock {
  const SafeMarkdownParagraph(this.children);
  final List<SafeMarkdownInline> children;
}

/// A fenced code block.
class SafeMarkdownCodeBlock extends SafeMarkdownBlock {
  const SafeMarkdownCodeBlock(this.code, {this.language});
  final String code;
  final String? language;
}

/// A bullet list (unordered).
class SafeMarkdownBulletList extends SafeMarkdownBlock {
  const SafeMarkdownBulletList(this.items);
  final List<List<SafeMarkdownInline>> items;
}

/// A numbered list (ordered).
class SafeMarkdownOrderedList extends SafeMarkdownBlock {
  const SafeMarkdownOrderedList(this.items);
  final List<List<SafeMarkdownInline>> items;
}

/// Inline AST nodes.
sealed class SafeMarkdownInline {
  const SafeMarkdownInline();
}

/// Plain literal text. Always treated as inert.
class SafeMarkdownText extends SafeMarkdownInline {
  const SafeMarkdownText(this.text);
  final String text;
}

/// Bold or italic emphasis wrapping a sequence of inlines.
class SafeMarkdownEmphasis extends SafeMarkdownInline {
  const SafeMarkdownEmphasis({required this.kind, required this.children});
  final SafeMarkdownEmphasisKind kind;
  final List<SafeMarkdownInline> children;
}

/// An inline code span. The text is rendered in a monospace font and never
/// interpreted further.
class SafeMarkdownInlineCode extends SafeMarkdownInline {
  const SafeMarkdownInlineCode(this.code);
  final String code;
}

/// A hyperlink. The URL has already been validated by the parser; widgets
/// should treat the value as already-safe.
class SafeMarkdownLink extends SafeMarkdownInline {
  const SafeMarkdownLink({required this.children, required this.url});
  final List<SafeMarkdownInline> children;
  final String url;
}

enum SafeMarkdownEmphasisKind { bold, italic }

/// Holds the parsed AST.
class SafeMarkdownDocument {
  const SafeMarkdownDocument({required this.blocks});

  final List<SafeMarkdownBlock> blocks;
}

/// Parses a Markdown string into an AST. The parser never throws: any
/// malformed input is downgraded to a literal text paragraph.
SafeMarkdownDocument parseSafeMarkdown(String source) {
  final lines = source.replaceAll('\r\n', '\n').split('\n');
  final blocks = <SafeMarkdownBlock>[];

  var i = 0;
  while (i < lines.length) {
    final line = lines[i];

    // Skip blank lines between blocks.
    if (line.trim().isEmpty) {
      i++;
      continue;
    }

    // Fenced code block: ```lang?\n...\n```
    if (line.trimLeft().startsWith('```')) {
      final fence = line.indexOf('```');
      final lang = line.substring(fence + 3).trim();
      final buffer = <String>[];
      i++;
      while (i < lines.length && !lines[i].trimLeft().startsWith('```')) {
        buffer.add(lines[i]);
        i++;
      }
      // Skip closing fence if present; do not error if missing.
      if (i < lines.length) i++;
      blocks.add(
        SafeMarkdownCodeBlock(
          buffer.join('\n'),
          language: lang.isEmpty ? null : lang,
        ),
      );
      continue;
    }

    // Bullet list: lines starting with `- ` or `* `.
    if (_isBulletLine(line)) {
      final items = <List<SafeMarkdownInline>>[];
      while (i < lines.length && _isBulletLine(lines[i])) {
        items.add(_parseInline(_stripBullet(lines[i])));
        i++;
      }
      blocks.add(SafeMarkdownBulletList(items));
      continue;
    }

    // Ordered list: lines starting with `\d+. `.
    if (_isOrderedLine(line)) {
      final items = <List<SafeMarkdownInline>>[];
      while (i < lines.length && _isOrderedLine(lines[i])) {
        items.add(_parseInline(_stripOrdered(lines[i])));
        i++;
      }
      blocks.add(SafeMarkdownOrderedList(items));
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-fenced, non-list lines.
    final paragraphLines = <String>[line];
    i++;
    while (i < lines.length &&
        lines[i].trim().isNotEmpty &&
        !lines[i].trimLeft().startsWith('```') &&
        !_isBulletLine(lines[i]) &&
        !_isOrderedLine(lines[i])) {
      paragraphLines.add(lines[i]);
      i++;
    }
    blocks.add(SafeMarkdownParagraph(_parseInline(paragraphLines.join('\n'))));
  }

  return SafeMarkdownDocument(
    blocks: List<SafeMarkdownBlock>.unmodifiable(blocks),
  );
}

bool _isBulletLine(String line) {
  if (line.isEmpty) return false;
  return line.startsWith('- ') || line.startsWith('* ');
}

String _stripBullet(String line) {
  if (line.startsWith('- ')) return line.substring(2);
  if (line.startsWith('* ')) return line.substring(2);
  return line;
}

bool _isOrderedLine(String line) {
  final match = RegExp(r'^(\d+)\.\s').firstMatch(line);
  return match != null;
}

String _stripOrdered(String line) {
  final match = RegExp(r'^\d+\.\s').firstMatch(line);
  if (match == null) return line;
  return line.substring(match.end);
}

/// Inline parser. Walks the string once and emits emphasis, code spans,
/// links, and text. Unmatched markers are emitted as literal characters.
List<SafeMarkdownInline> _parseInline(String source) {
  final out = <SafeMarkdownInline>[];
  final buffer = StringBuffer();
  var i = 0;

  void flushText() {
    if (buffer.isEmpty) return;
    out.add(SafeMarkdownText(buffer.toString()));
    buffer.clear();
  }

  while (i < source.length) {
    final ch = source[i];

    // Backtick code span.
    if (ch == '`') {
      final end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        final code = source.substring(i + 1, end);
        flushText();
        out.add(SafeMarkdownInlineCode(code));
        i = end + 1;
        continue;
      }
    }

    // Escape: `\*` etc. produces a literal marker.
    if (ch == r'\' &&
        i + 1 < source.length &&
        const {'*', '_', '`', '[', ']', '(', ')'}.contains(source[i + 1])) {
      buffer.write(source[i + 1]);
      i += 2;
      continue;
    }

    // Bold: **text**
    if (ch == '*' && i + 1 < source.length && source[i + 1] == '*') {
      final end = _findCloser(source, i + 2, '**');
      if (end > i + 2) {
        final inner = source.substring(i + 2, end);
        flushText();
        out.add(
          SafeMarkdownEmphasis(
            kind: SafeMarkdownEmphasisKind.bold,
            children: _parseInline(inner),
          ),
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: _text_ or *text* (single marker, not adjacent to another marker).
    if ((ch == '_' || ch == '*') &&
        !(ch == '*' && i + 1 < source.length && source[i + 1] == '*')) {
      final marker = ch;
      final end = _findCloser(source, i + 1, marker);
      if (end > i + 1) {
        final inner = source.substring(i + 1, end);
        if (inner.isNotEmpty) {
          flushText();
          out.add(
            SafeMarkdownEmphasis(
              kind: SafeMarkdownEmphasisKind.italic,
              children: _parseInline(inner),
            ),
          );
          i = end + 1;
          continue;
        }
      }
    }

    // Link: [text](url)
    if (ch == '[') {
      final closeBracket = _findUnescaped(source, i + 1, ']');
      if (closeBracket != -1 &&
          closeBracket + 1 < source.length &&
          source[closeBracket + 1] == '(') {
        final closeParen = _findUnescaped(source, closeBracket + 2, ')');
        if (closeParen != -1) {
          final text = source.substring(i + 1, closeBracket);
          final rawUrl = source.substring(closeBracket + 2, closeParen).trim();
          final safeUrl = _safeUrl(rawUrl);
          flushText();
          if (safeUrl != null) {
            out.add(
              SafeMarkdownLink(children: _parseInline(text), url: safeUrl),
            );
          } else {
            // Drop the link wrapper but keep the visible text so the user
            // still sees what the model meant to link, plus the literal
            // URL in parentheses for transparency.
            out.addAll(_parseInline(text));
            out.add(SafeMarkdownText(' ($rawUrl)'));
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    buffer.write(ch);
    i++;
  }

  flushText();
  return out;
}

/// Returns the index of the next occurrence of [marker], or -1 if not found.
int _findCloser(String source, int start, String marker) {
  final idx = source.indexOf(marker, start);
  return idx;
}

/// Returns the index of the next [target] that is not preceded by `\`.
int _findUnescaped(String source, int start, String target) {
  var i = start;
  while (i < source.length) {
    final idx = source.indexOf(target, i);
    if (idx == -1) return -1;
    if (idx > 0 && source[idx - 1] == r'\') {
      i = idx + 1;
      continue;
    }
    return idx;
  }
  return -1;
}

/// Returns the URL if it is a safe http/https URL, otherwise null. Safe
/// means:
///
///   * the scheme is exactly `http` or `https`,
///   * the URL parses via [Uri.tryParse],
///   * the URL has a non-empty host.
String? _safeUrl(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  final parsed = Uri.tryParse(trimmed);
  if (parsed == null) return null;
  if (parsed.scheme != 'http' && parsed.scheme != 'https') return null;
  if (parsed.host.isEmpty) return null;
  return parsed.toString();
}

/// Public hook for tests and the renderer: returns true when the given URL
/// would be kept by the safe-Markdown parser.
bool isSafeMarkdownUrl(String raw) => _safeUrl(raw) != null;

/// Callback invoked when the user activates a safe link. The URL is
/// guaranteed to be an http/https URL with a non-empty host.
typedef SafeMarkdownLinkTap = void Function(String url);

/// Renders a [SafeMarkdownDocument] as a Flutter widget tree.
///
/// Each block becomes its own widget; paragraphs use [Text.rich] so the
/// renderer can attach [TapGestureRecognizer]s for links. The function is
/// pure: it does not attach any state and does not wrap the result in a
/// scrollable. The presentation widget is responsible for that.
List<Widget> buildSafeMarkdownWidgets(
  SafeMarkdownDocument document, {
  TextStyle? baseStyle,
  TextStyle? codeStyle,
  TextStyle? linkStyle,
  required Color blockBackground,
  SafeMarkdownLinkTap? onLinkTap,
}) {
  InlineSpan buildInline(SafeMarkdownInline inline) {
    switch (inline) {
      case SafeMarkdownText(:final text):
        return TextSpan(text: text, style: baseStyle);
      case SafeMarkdownInlineCode(:final code):
        return TextSpan(
          text: code,
          style: codeStyle ?? const TextStyle(fontFamily: 'monospace'),
        );
      case SafeMarkdownEmphasis(:final kind, :final children):
        final merged = switch (kind) {
          SafeMarkdownEmphasisKind.bold =>
            (baseStyle ?? const TextStyle()).copyWith(
              fontWeight: FontWeight.bold,
            ),
          SafeMarkdownEmphasisKind.italic =>
            (baseStyle ?? const TextStyle()).copyWith(
              fontStyle: FontStyle.italic,
            ),
        };
        return TextSpan(
          style: merged,
          children: children
              .map(
                (child) => buildInlineSafeMarkdownInline(
                  child,
                  baseStyle: merged,
                  codeStyle: codeStyle,
                  linkStyle: linkStyle,
                  onLinkTap: onLinkTap,
                ),
              )
              .toList(growable: false),
        );
      case SafeMarkdownLink(:final children, :final url):
        final style =
            (linkStyle ??
                    (baseStyle ?? const TextStyle()).copyWith(
                      color: Colors.blue,
                      decoration: TextDecoration.underline,
                    ))
                .copyWith(
                  color: Colors.blue,
                  decoration: TextDecoration.underline,
                );
        return TextSpan(
          style: style,
          children: children
              .map(
                (child) => buildInlineSafeMarkdownInline(
                  child,
                  baseStyle: style,
                  codeStyle: codeStyle,
                  linkStyle: style,
                  onLinkTap: onLinkTap,
                ),
              )
              .toList(growable: false),
          recognizer: onLinkTap == null
              ? null
              : (TapGestureRecognizer()..onTap = () => onLinkTap(url)),
        );
    }
  }

  return document.blocks
      .map(
        (block) => _renderBlock(
          block,
          baseStyle: baseStyle,
          blockBackground: blockBackground,
          buildInline: buildInline,
        ),
      )
      .toList(growable: false);
}

/// Inline-build helper. Recursively descends into children while preserving
/// the active style. Extracted from [buildSafeMarkdownWidgets] so tests can
/// unit-test the recursive descent without instantiating Flutter widgets.
InlineSpan buildInlineSafeMarkdownInline(
  SafeMarkdownInline inline, {
  TextStyle? baseStyle,
  TextStyle? codeStyle,
  TextStyle? linkStyle,
  SafeMarkdownLinkTap? onLinkTap,
}) {
  switch (inline) {
    case SafeMarkdownText(:final text):
      return TextSpan(text: text, style: baseStyle);
    case SafeMarkdownInlineCode(:final code):
      return TextSpan(
        text: code,
        style: codeStyle ?? const TextStyle(fontFamily: 'monospace'),
      );
    case SafeMarkdownEmphasis(:final kind, :final children):
      final merged = switch (kind) {
        SafeMarkdownEmphasisKind.bold =>
          (baseStyle ?? const TextStyle()).copyWith(
            fontWeight: FontWeight.bold,
          ),
        SafeMarkdownEmphasisKind.italic =>
          (baseStyle ?? const TextStyle()).copyWith(
            fontStyle: FontStyle.italic,
          ),
      };
      return TextSpan(
        style: merged,
        children: children
            .map(
              (child) => buildInlineSafeMarkdownInline(
                child,
                baseStyle: merged,
                codeStyle: codeStyle,
                linkStyle: linkStyle,
                onLinkTap: onLinkTap,
              ),
            )
            .toList(growable: false),
      );
    case SafeMarkdownLink(:final children, :final url):
      final style =
          (linkStyle ??
                  (baseStyle ?? const TextStyle()).copyWith(
                    color: Colors.blue,
                    decoration: TextDecoration.underline,
                  ))
              .copyWith(
                color: Colors.blue,
                decoration: TextDecoration.underline,
              );
      return TextSpan(
        style: style,
        children: children
            .map(
              (child) => buildInlineSafeMarkdownInline(
                child,
                baseStyle: style,
                codeStyle: codeStyle,
                linkStyle: style,
                onLinkTap: onLinkTap,
              ),
            )
            .toList(growable: false),
        recognizer: onLinkTap == null
            ? null
            : (TapGestureRecognizer()..onTap = () => onLinkTap(url)),
      );
  }
}

Widget _renderBlock(
  SafeMarkdownBlock block, {
  TextStyle? baseStyle,
  required Color blockBackground,
  required InlineSpan Function(SafeMarkdownInline inline) buildInline,
}) {
  switch (block) {
    case SafeMarkdownParagraph(:final children):
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
        child: Text.rich(
          TextSpan(
            style: baseStyle,
            children: children.map(buildInline).toList(growable: false),
          ),
        ),
      );
    case SafeMarkdownCodeBlock(:final code, :final language):
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
        child: Container(
          padding: const EdgeInsets.all(PiSpacing.sm),
          decoration: BoxDecoration(
            color: blockBackground,
            borderRadius: BorderRadius.circular(PiRadius.sm),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (language != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: PiSpacing.xs),
                  child: Text(
                    language,
                    style: const TextStyle(
                      fontSize: 11,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              Text(code, style: const TextStyle(fontFamily: 'monospace')),
            ],
          ),
        ),
      );
    case SafeMarkdownBulletList(:final items):
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(
                  left: PiSpacing.sm,
                  bottom: PiSpacing.xs,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('•  '),
                    Expanded(
                      child: Text.rich(
                        TextSpan(
                          style: baseStyle,
                          children: item
                              .map(buildInline)
                              .toList(growable: false),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
    case SafeMarkdownOrderedList(:final items):
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var idx = 0; idx < items.length; idx++)
              Padding(
                padding: const EdgeInsets.only(
                  left: PiSpacing.sm,
                  bottom: PiSpacing.xs,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${idx + 1}.  '),
                    Expanded(
                      child: Text.rich(
                        TextSpan(
                          style: baseStyle,
                          children: items[idx]
                              .map(buildInline)
                              .toList(growable: false),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
  }
}
