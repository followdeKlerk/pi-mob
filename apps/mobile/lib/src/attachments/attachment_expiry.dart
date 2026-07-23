import 'package:flutter/material.dart';

import 'attachment_view_data.dart';

/// Expiry countdown + replacement eligibility for a single attachment.
///
/// The widget is read-only: it surfaces state from [AttachmentViewData] and
/// exposes a semantics label so VoiceOver/TalkBack can announce remaining
/// time or an already-expired status.
class AttachmentExpiryIndicator extends StatelessWidget {
  const AttachmentExpiryIndicator({
    required this.data,
    required this.now,
    this.onExpireAcknowledged,
    super.key,
  });

  final AttachmentViewData data;
  final DateTime now;
  final VoidCallback? onExpireAcknowledged;

  static Duration _remaining(AttachmentViewData data, DateTime now) {
    final expires = data.expiresAt;
    if (expires == null) return Duration.zero;
    final remaining = expires.difference(now);
    return remaining.isNegative ? Duration.zero : remaining;
  }

  String _format(Duration remaining) {
    final seconds = remaining.inSeconds;
    if (seconds <= 0) return 'Expired';
    if (seconds < 60) return 'Expires in ${seconds}s';
    final minutes = seconds ~/ 60;
    if (minutes < 60) {
      final rest = seconds % 60;
      return rest == 0
          ? 'Expires in ${minutes}m'
          : 'Expires in ${minutes}m ${rest}s';
    }
    final hours = minutes ~/ 60;
    final restMinutes = minutes % 60;
    return restMinutes == 0
        ? 'Expires in ${hours}h'
        : 'Expires in ${hours}h ${restMinutes}m';
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remaining(data, now);
    final expired =
        remaining <= Duration.zero || data.phase == AttachmentPhase.expired;
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Attachment expiry for ${data.fileName}. ${_format(remaining)}',
      child: Row(
        key: ValueKey('attachment-expiry-${data.id}'),
        children: [
          Icon(
            expired ? Icons.timer_off_outlined : Icons.schedule,
            color: expired ? theme.colorScheme.error : null,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _format(remaining),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: expired ? theme.colorScheme.error : null,
              ),
            ),
          ),
          if (expired && onExpireAcknowledged != null)
            TextButton(
              key: ValueKey('attachment-expiry-ack-${data.id}'),
              onPressed: onExpireAcknowledged,
              child: const Text('Dismiss'),
            ),
        ],
      ),
    );
  }
}

/// Helper to compute whether an attachment is still safe to send.
bool attachmentIsSendable(AttachmentViewData data, DateTime now) {
  if (data.removed) return false;
  if (data.phase == AttachmentPhase.expired) return false;
  if (data.phase == AttachmentPhase.uploading &&
      data.progressFraction == null) {
    return false;
  }
  if (data.byteSize <= 0) return false;
  final expires = data.expiresAt;
  if (expires != null && !expires.isAfter(now)) return false;
  return true;
}
