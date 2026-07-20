import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'image_attachment_picker.dart';

class UploadedAttachment {
  const UploadedAttachment({
    required this.attachmentId,
    required this.sha256,
    required this.mimeType,
    required this.bytes,
    required this.width,
    required this.height,
    required this.expiresAt,
  });
  final String attachmentId;
  final String sha256;
  final String mimeType;
  final int bytes;
  final int width;
  final int height;
  final DateTime expiresAt;
}

class PrivateBinaryTransport {
  PrivateBinaryTransport({HttpClient? client})
    : _client = client ?? HttpClient();
  final HttpClient _client;

  Future<UploadedAttachment> upload({
    required Uri hostOrigin,
    required String installationId,
    required String clientUploadId,
    required SanitizedPickedImage image,
    String? intendedSessionId,
    void Function(int sent, int total)? onProgress,
  }) async {
    _requirePrivateOrigin(hostOrigin);
    final boundary = 'pi-mob-${DateTime.now().microsecondsSinceEpoch}';
    final fields = <String, String>{
      'installationId': installationId,
      'clientUploadId': clientUploadId,
      'intendedSessionId': ?intendedSessionId,
    };
    final prefix = BytesBuilder();
    for (final entry in fields.entries) {
      prefix.add(
        utf8.encode(
          '--$boundary\r\nContent-Disposition: form-data; name="${entry.key}"\r\n\r\n${entry.value}\r\n',
        ),
      );
    }
    prefix.add(
      utf8.encode(
        '--$boundary\r\nContent-Disposition: form-data; name="content"; filename="${image.fileName}"\r\nContent-Type: ${image.mimeType}\r\n\r\n',
      ),
    );
    final suffix = Uint8List.fromList(utf8.encode('\r\n--$boundary--\r\n'));
    final total = prefix.length + image.bytes.length + suffix.length;
    final request = await _client.postUrl(
      hostOrigin.resolve('/v1/attachments'),
    );
    request.headers.contentType = ContentType(
      'multipart',
      'form-data',
      parameters: {'boundary': boundary},
    );
    request.contentLength = total;
    var sent = 0;
    void add(List<int> chunk) {
      request.add(chunk);
      sent += chunk.length;
      onProgress?.call(sent, total);
    }

    add(prefix.takeBytes());
    const chunkSize = 64 * 1024;
    for (var offset = 0; offset < image.bytes.length; offset += chunkSize) {
      add(
        image.bytes.sublist(
          offset,
          (offset + chunkSize).clamp(0, image.bytes.length),
        ),
      );
    }
    add(suffix);
    final response = await request.close();
    final body = await utf8.decoder.bind(response).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException('Attachment upload failed (${response.statusCode})');
    }
    final json = jsonDecode(body) as Map<String, Object?>;
    return UploadedAttachment(
      attachmentId: json['attachmentId'] as String,
      sha256: json['sha256'] as String,
      mimeType: json['mimeType'] as String,
      bytes: json['bytes'] as int,
      width: json['width'] as int,
      height: json['height'] as int,
      expiresAt: DateTime.parse(json['expiresAt'] as String).toUtc(),
    );
  }

  Future<String> downloadExport({
    required Uri hostOrigin,
    required String exportId,
    void Function(int received, int? total)? onProgress,
  }) async {
    _requirePrivateOrigin(hostOrigin);
    if (!RegExp(r'^[0-9a-f-]{36}$').hasMatch(exportId)) {
      throw const FormatException('Invalid export ID');
    }
    final request = await _client.getUrl(
      hostOrigin.resolve('/v1/exports/$exportId'),
    );
    final response = await request.close();
    if (response.statusCode != 200) {
      throw HttpException('Export unavailable (${response.statusCode})');
    }
    final directory = await getTemporaryDirectory();
    final file = File(
      p.join(directory.path, 'pi-session-${exportId.substring(0, 8)}.html'),
    );
    final sink = file.openWrite();
    var received = 0;
    await for (final chunk in response) {
      sink.add(chunk);
      received += chunk.length;
      onProgress?.call(
        received,
        response.contentLength < 0 ? null : response.contentLength,
      );
    }
    await sink.close();
    return file.path;
  }

  void close() => _client.close(force: true);

  void _requirePrivateOrigin(Uri origin) {
    if (origin.scheme != 'https' ||
        origin.path != '' ||
        origin.hasQuery ||
        origin.hasFragment ||
        origin.userInfo.isNotEmpty) {
      throw const FormatException('A clean paired HTTPS origin is required');
    }
  }
}
