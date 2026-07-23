import 'dart:io';

/// Loads a text asset from disk for unit tests. The test suite runs from
/// the `apps/mobile/` package directory, but the canonical fixture corpus
/// lives under `packages/protocol-fixtures/corpus/`. This loader resolves
/// both the in-package and repository-relative paths so the Dart and
/// TypeScript suites consume the exact same bytes.
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
