import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('iOS gallery picker declares a non-empty photo-library purpose', () {
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    expect(plist, contains('<key>NSPhotoLibraryUsageDescription</key>'));
    expect(plist, contains('Images are sanitized before private upload.'));
  });

  test(
    'Android picker relies on system picker without broad media permission',
    () {
      final manifest = File(
        'android/app/src/main/AndroidManifest.xml',
      ).readAsStringSync();
      expect(manifest, isNot(contains('READ_EXTERNAL_STORAGE')));
      expect(manifest, isNot(contains('READ_MEDIA_IMAGES')));
    },
  );
}
