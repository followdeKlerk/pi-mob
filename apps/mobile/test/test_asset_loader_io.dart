import 'dart:io';

/// Loads a text asset from disk using the dart:io file system. The Dart test
/// suite uses this loader because `rootBundle.loadString` is not available
/// outside the widget tester. The path is resolved relative to the
/// repository root, so the test reads the exact same bytes consumed by the
/// TypeScript fixture suite.
class TestAssetLoader {
  static Future<String> loadString(String relativePath) async {
    final candidates = <String>[relativePath, '../../$relativePath'];
    for (final candidate in candidates) {
      final file = File(candidate);
      if (file.existsSync()) {
        return file.readAsString();
      }
    }
    throw StateError('test asset not found: $relativePath');
  }
}
