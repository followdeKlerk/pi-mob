import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import '../domain/attachments.dart' as domain;

class SanitizedPickedImage {
  const SanitizedPickedImage({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
    required this.width,
    required this.height,
  });
  final Uint8List bytes;
  final String fileName;
  final String mimeType;
  final int width;
  final int height;
}

abstract interface class ImagePickerPort {
  Future<XFile?> pickImage();
}

class PlatformImagePicker implements ImagePickerPort {
  PlatformImagePicker([ImagePicker? picker])
    : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;
  @override
  Future<XFile?> pickImage() => _picker.pickImage(
    source: ImageSource.gallery,
    requestFullMetadata: false,
  );
}

class ImageAttachmentPicker {
  const ImageAttachmentPicker(this.port);
  final ImagePickerPort port;

  Future<SanitizedPickedImage?> pickAndSanitize() async {
    final selected = await port.pickImage();
    if (selected == null) return null;
    final source = await selected.readAsBytes();
    if (source.length > domain.AttachmentLimits.maxSingleBytes * 2) {
      throw const FormatException(
        'Selected image is too large to decode safely',
      );
    }
    var decoded = img.decodeImage(source);
    if (decoded == null) {
      throw const FormatException(
        'Selected file is not a decodable JPEG or PNG',
      );
    }
    if (decoded.width * decoded.height > 40 * 1000 * 1000) {
      throw const FormatException(
        'Selected image exceeds the pixel decode limit',
      );
    }
    final maxDimension = domain.AttachmentLimits.maxDimension;
    if (decoded.width > maxDimension || decoded.height > maxDimension) {
      decoded = decoded.width >= decoded.height
          ? img.copyResize(
              decoded,
              width: maxDimension,
              interpolation: img.Interpolation.average,
            )
          : img.copyResize(
              decoded,
              height: maxDimension,
              interpolation: img.Interpolation.average,
            );
    }
    // Detect source format from the raw bytes' magic header rather than the
    // XFile name: cross_file's fromData drops the supplied name, and the
    // declared mime is untrustworthy. PNG: 89 50 4E 47, JPEG: FF D8 FF.
    final png =
        source.length >= 4 &&
        source[0] == 0x89 &&
        source[1] == 0x50 &&
        source[2] == 0x4E &&
        source[3] == 0x47;
    // Re-encoding from decoded pixels strips EXIF/GPS/comments and normalizes
    // the compressed representation before upload.
    final encoded = Uint8List.fromList(
      png
          ? img.encodePng(decoded, level: 6)
          : img.encodeJpg(decoded, quality: 85),
    );
    if (encoded.length > domain.AttachmentLimits.maxSingleBytes) {
      throw const FormatException('Sanitized image still exceeds 10 MiB');
    }
    return SanitizedPickedImage(
      bytes: encoded,
      fileName: png ? 'image.png' : 'image.jpg',
      mimeType: png ? 'image/png' : 'image/jpeg',
      width: decoded.width,
      height: decoded.height,
    );
  }
}
