import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'control_view_data.dart';
import 'unsupported_control_state.dart';

/// Retry state, host-supplied countdown, abort, and auto-retry control.
///
/// This widget does not create a timer: the coordinator-independent caller
/// supplies updated [RetryViewData.remaining] values from authoritative state.
class RetryControls extends StatelessWidget {
  const RetryControls({required this.data, required this.callbacks, super.key});

  final RetryViewData data;
  final RetryCallbacks callbacks;

  String _remaining(Duration value) {
    final seconds = value.inSeconds.clamp(0, 359999);
    final minutes = seconds ~/ 60;
    final rest = seconds % 60;
    return minutes == 0
        ? '${rest}s'
        : '${minutes}m ${rest.toString().padLeft(2, '0')}s';
  }

  String get _status => switch (data.phase) {
    RetryPhase.idle => 'No retry pending',
    RetryPhase.scheduled =>
      data.remaining == null
          ? 'Retry scheduled'
          : 'Retrying in ${_remaining(data.remaining!)}',
    RetryPhase.retrying => 'Retry in progress',
    RetryPhase.aborting => 'Stopping retry',
    RetryPhase.unavailable => 'Retry state unavailable',
  };

  @override
  Widget build(BuildContext context) {
    if (data.phase == RetryPhase.unavailable && data.autoRetry == null) {
      return const UnsupportedControlState(
        feature: 'Retry controls',
        explanation: 'This host does not expose retry state for the session.',
      );
    }
    final attempts = data.attempt == null
        ? null
        : data.maximumAttempts == null
        ? 'Attempt ${data.attempt}'
        : 'Attempt ${data.attempt} of ${data.maximumAttempts}';
    return Semantics(
      container: true,
      liveRegion: data.phase != RetryPhase.idle,
      label: 'Retry controls. $_status${attempts == null ? '' : '. $attempts'}',
      child: Card(
        key: const Key('retry-controls'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            PiSpacing.sm,
            PiSpacing.sm,
            PiSpacing.sm,
            PiSpacing.md,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile(
                key: const Key('auto-retry-toggle'),
                title: const Text('Auto retry'),
                subtitle: const Text('Retry eligible provider failures'),
                value: data.autoRetry ?? false,
                onChanged: data.autoRetry == null
                    ? null
                    : callbacks.onAutoRetryChanged,
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: PiSpacing.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      data.phase == RetryPhase.idle
                          ? Icons.check_circle_outline
                          : Icons.refresh,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_status, key: const Key('retry-status')),
                          if (attempts != null) Text(attempts),
                          if (data.failureMessage case final message?)
                            Text(message),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (data.canAbort) ...[
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  key: const Key('abort-retry'),
                  onPressed: callbacks.onAbort,
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: const Text('Abort retry'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
