import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/tool_call_view_data.dart';

void main() {
  group('native Pi tool-result compatibility', () {
    test('redacted read and ls paths remain renderable', () {
      final read = ReadToolArgs.fromMap(const <String, Object?>{
        'offset': 5210,
        'limit': 75,
      });
      final ls = LsToolArgs.fromMap(const <String, Object?>{});

      expect(read.path, '<path redacted>');
      expect(read.offset, 5210);
      expect(read.limit, 75);
      expect(ls.path, '<path redacted>');
    });

    test('read accepts Pi content blocks and derives metadata', () {
      final result = ReadToolResult.fromMap(const <String, Object?>{
        'content': <Object?>[
          <String, Object?>{'type': 'text', 'text': 'alpha\nbeta'},
        ],
      });

      expect(result.content, 'alpha\nbeta');
      expect(result.byteCount, 10);
      expect(result.totalLines, 2);
    });

    test('bash accepts Pi content blocks without false parse failures', () {
      final result = BashToolResult.fromMap(const <String, Object?>{
        'content': <Object?>[
          <String, Object?>{
            'type': 'text',
            'text': 'apps/mobile/lib/main.dart:1',
          },
        ],
      });

      expect(result.stdout, 'apps/mobile/lib/main.dart:1');
      expect(result.stderr, isEmpty);
      expect(result.exitCode, 0);
    });

    test('native text output is adapted for grep, find, and ls', () {
      final grep = GrepToolResult.fromMap(const <String, Object?>{
        'content': <Object?>[
          <String, Object?>{
            'type': 'text',
            'text': 'lib/main.dart:12: frame callback',
          },
        ],
      });
      final find = FindToolResult.fromMap(const <String, Object?>{
        'content': <Object?>[
          <String, Object?>{'type': 'text', 'text': 'lib/a.dart\nlib/b.dart'},
        ],
      });
      final ls = LsToolResult.fromMap(const <String, Object?>{
        'content': <Object?>[
          <String, Object?>{'type': 'text', 'text': 'lib\ntest'},
        ],
      });

      expect(grep.matches.single.path, 'lib/main.dart');
      expect(grep.matches.single.lineNumber, 12);
      expect(grep.matches.single.line, 'frame callback');
      expect(
        find.matches.map((match) => match.path),
        <String>['lib/a.dart', 'lib/b.dart'],
      );
      expect(
        ls.entries.map((entry) => entry.name),
        <String>['lib', 'test'],
      );
    });
  });
}
