import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/widgets/final_answer_view.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/final_answer_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/safe_markdown.dart';

Widget _app(Widget child, {TextScaler textScaler = TextScaler.noScaling}) =>
    MaterialApp(
      home: Scaffold(
        body: MediaQuery(
          data: MediaQueryData(textScaler: textScaler),
          child: child,
        ),
      ),
    );

Iterable<TextSpan> _spans(InlineSpan span) sync* {
  if (span is TextSpan) {
    yield span;
    for (final child in span.children ?? const <InlineSpan>[]) {
      yield* _spans(child);
    }
  }
}

void main() {
  test('safe Markdown URL policy allows only hosted HTTPS/HTTP', () {
    expect(isSafeMarkdownUrl('https://example.com/docs'), isTrue);
    expect(isSafeMarkdownUrl('http://example.com'), isTrue);
    for (final value in [
      'javascript:alert(1)',
      'file:///tmp/x',
      'data:text/html,x',
      'mailto:a@b.com',
      'https:///missing-host',
    ]) {
      expect(isSafeMarkdownUrl(value), isFalse, reason: value);
    }
  });
  test(
    'parses ATX and setext headings without treating hashtags as headings',
    () {
      final document = parseSafeMarkdown(
        '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n\n'
        'Setext one\n===\nSetext two\n---\n\n'
        '#hashtag\n####### literal',
      );

      final headings = document.blocks
          .whereType<SafeMarkdownHeading>()
          .toList();
      expect(headings.map((heading) => heading.level), [
        1,
        2,
        3,
        4,
        5,
        6,
        1,
        2,
      ]);
      expect(document.blocks.last, isA<SafeMarkdownParagraph>());
      final literal = document.blocks.last as SafeMarkdownParagraph;
      expect(
        literal.children.whereType<SafeMarkdownText>().single.text,
        '#hashtag\n####### literal',
      );
    },
  );

  test('parses block quotes and horizontal rules as distinct blocks', () {
    final document = parseSafeMarkdown('> Quoted **text**\n>\n> Next\n\n***');

    expect(document.blocks, hasLength(2));
    final quote = document.blocks.first as SafeMarkdownBlockQuote;
    expect(quote.blocks, hasLength(2));
    expect(document.blocks.last, isA<SafeMarkdownHorizontalRule>());
  });

  testWidgets('renders H1-H6, quotes, and rules with block formatting', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        FinalAnswerView.forViewData(
          const FinalAnswerViewData(
            answerId: 'blocks',
            markdown:
                '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n\n'
                '> Quoted text\n\n---\n\nBody',
          ),
        ),
        textScaler: const TextScaler.linear(2),
      ),
    );

    for (final marker in ['# One', '## Two', '### Three']) {
      expect(find.text(marker), findsNothing);
    }
    for (final text in ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      expect(find.text(text), findsOneWidget);
    }
    expect(find.byType(Divider), findsOneWidget);
    expect(tester.takeException(), isNull);

    final heading = tester.widget<RichText>(
      find.byWidgetPredicate(
        (widget) => widget is RichText && widget.text.toPlainText() == 'Three',
      ),
    );
    final body = tester.widget<RichText>(
      find.byWidgetPredicate(
        (widget) => widget is RichText && widget.text.toPlainText() == 'Body',
      ),
    );
    final headingFontSize = _spans(heading.text)
        .map((span) => span.style?.fontSize)
        .whereType<double>()
        .reduce((largest, size) => size > largest ? size : largest);
    expect(headingFontSize, greaterThan(body.text.style!.fontSize!));
  });

  testWidgets('renders selectable styled blocks and safe link recognizers', (
    tester,
  ) async {
    final tapped = <String>[];
    await tester.pumpWidget(
      _app(
        FinalAnswerView.forViewData(
          const FinalAnswerViewData(
            answerId: 'answer',
            markdown:
                'Hello **bold** [docs](https://example.com)\n\n```dart\nvoid main() {}\n```',
          ),
          onLinkTap: tapped.add,
        ),
      ),
    );
    expect(
      find.byType(SelectionArea),
      findsNothing,
    ); // parent transcript owns selection
    expect(find.byType(RichText), findsWidgets);
    expect(find.textContaining('void main'), findsOneWidget);
    final spans = find
        .byType(RichText)
        .evaluate()
        .map((e) => (e.widget as RichText).text)
        .expand(_spans)
        .toList();
    final link = spans.firstWhere(
      (span) => span.recognizer is TapGestureRecognizer,
    );
    (link.recognizer as TapGestureRecognizer).onTap!();
    expect(tapped, ['https://example.com']);
  });

  testWidgets('unsafe links remain inert visible text', (tester) async {
    final tapped = <String>[];
    await tester.pumpWidget(
      _app(
        FinalAnswerView.forViewData(
          const FinalAnswerViewData(
            answerId: 'unsafe',
            markdown: '[do not open](javascript:alert(1))',
          ),
          onLinkTap: tapped.add,
        ),
      ),
    );
    final spans = find
        .byType(RichText)
        .evaluate()
        .map((e) => (e.widget as RichText).text)
        .expand(_spans)
        .toList();
    expect(spans.where((span) => span.recognizer != null), isEmpty);
    expect(
      spans.map((span) => span.toPlainText()).join(),
      contains('do not open'),
    );
    expect(tapped, isEmpty);
  });

  testWidgets('answer has an accessible semantic label', (tester) async {
    await tester.pumpWidget(
      _app(
        FinalAnswerView.forViewData(
          const FinalAnswerViewData(answerId: 'a', markdown: 'answer'),
        ),
      ),
    );
    expect(find.bySemanticsLabel('Assistant answer'), findsOneWidget);
  });
}
