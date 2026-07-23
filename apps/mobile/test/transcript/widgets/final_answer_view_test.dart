import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/widgets/final_answer_view.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/final_answer_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/safe_markdown.dart';

Widget _app(Widget child) => MaterialApp(home: Scaffold(body: child));

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
