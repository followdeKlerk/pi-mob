import 'package:flutter/foundation.dart';

@immutable
class FollowUpItem {
  const FollowUpItem({
    required this.queueItemId,
    required this.position,
    required this.message,
    this.attachmentIds = const [],
  });
  final String queueItemId;
  final int position;
  final String message;
  final List<String> attachmentIds;
  factory FollowUpItem.fromWire(Map<String, Object?> value) => FollowUpItem(
    queueItemId: value['queueItemId']?.toString() ?? '',
    position: value['position'] is int ? value['position']! as int : 0,
    message: value['message']?.toString() ?? '',
    attachmentIds: (value['attachmentIds'] as List<Object?>? ?? const [])
        .whereType<String>()
        .toList(growable: false),
  );
}

enum ExtensionDialogMethod { select, confirm, input, editor }

@immutable
class ExtensionDialogState {
  const ExtensionDialogState({
    required this.dialogId,
    required this.method,
    required this.title,
    required this.expiresAt,
    this.options = const [],
    this.message = '',
    this.placeholder = '',
    this.prefill = '',
  });
  final String dialogId;
  final ExtensionDialogMethod method;
  final String title;
  final DateTime expiresAt;
  final List<String> options;
  final String message;
  final String placeholder;
  final String prefill;
  bool isExpired(DateTime now) => !expiresAt.isAfter(now.toUtc());
  factory ExtensionDialogState.fromWire(Map<String, Object?> value) =>
      ExtensionDialogState(
        dialogId: value['dialogId']?.toString() ?? '',
        method: ExtensionDialogMethod.values.firstWhere(
          (m) => m.name == value['method'],
          orElse: () => ExtensionDialogMethod.input,
        ),
        title: value['title']?.toString() ?? '',
        expiresAt:
            DateTime.tryParse(value['expiresAt']?.toString() ?? '')?.toUtc() ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        options: (value['options'] as List<Object?>? ?? const [])
            .whereType<String>()
            .take(100)
            .toList(growable: false),
        message: value['message']?.toString() ?? '',
        placeholder: value['placeholder']?.toString() ?? '',
        prefill: value['prefill']?.toString() ?? '',
      );
}
