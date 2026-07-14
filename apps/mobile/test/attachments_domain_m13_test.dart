import 'dart:typed_data';

import 'package:cross_file/cross_file.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:pi_mob/src/attachments/image_attachment_picker.dart';
import 'package:pi_mob/src/domain/attachments.dart';

class FakePicker implements ImagePickerPort {
  FakePicker(this.file);
  final XFile? file;
  @override
  Future<XFile?> pickImage() async => file;
}

AttachmentRef ref(
  String id,
  int bytes, {
  AttachmentStatus status = AttachmentStatus.ready,
}) => AttachmentRef(
  id: id,
  kind: AttachmentKind.imagePng,
  filename: '$id.png',
  sizeBytes: bytes,
  mimeType: 'image/png',
  status: status,
  createdAt: DateTime.utc(2026),
  expiresAt: DateTime.utc(2026, 1, 2),
);

void main() {
  test('protocol attachment limits are four, 10 MiB each, 25 MiB total', () {
    expect(AttachmentLimits.maxCount, 4);
    expect(AttachmentLimits.maxSingleBytes, 10 * 1024 * 1024);
    expect(AttachmentLimits.maxTotalBytes, 25 * 1024 * 1024);
  });

  test('registry rejects fifth and total overflow, ready ids only', () {
    var registry = AttachmentRegistry();
    for (var i = 0; i < 4; i++) {
      registry = registry.add(ref('a$i', 1024)).registry;
    }
    expect(registry.add(ref('fifth', 1)).rejection, isNotNull);
    expect(registry.idsReady(), ['a0', 'a1', 'a2', 'a3']);
  });

  test('picker re-encodes image pixels and normalizes filename/mime', () async {
    final source = img.Image(width: 32, height: 16)
      ..setPixelRgb(0, 0, 255, 0, 0);
    final bytes = Uint8List.fromList(img.encodePng(source));
    final picker = ImageAttachmentPicker(
      FakePicker(
        XFile.fromData(bytes, name: 'gps-metadata.png', mimeType: 'image/png'),
      ),
    );
    final selected = await picker.pickAndSanitize();
    expect(selected?.mimeType, 'image/png');
    expect(selected?.fileName, 'image.png');
    expect(selected?.width, 32);
    expect(selected?.height, 16);
    expect(img.decodePng(selected!.bytes), isNotNull);
  });

  test('picker cancellation remains a no-op', () async {
    expect(
      await ImageAttachmentPicker(FakePicker(null)).pickAndSanitize(),
      isNull,
    );
  });
}
