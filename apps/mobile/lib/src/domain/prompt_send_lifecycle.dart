/// Typed lifecycle for one explicit prompt-send intent.
///
/// Bridge connectivity, controller ownership, command admission, and Pi turn
/// execution are separate facts. This model keeps the composer from treating
/// a healthy socket as proof that a prompt was delivered.
library;

enum PromptSendPhase {
  ready,
  acquiringControl,
  submitting,
  accepted,
  running,
  failed,
  indeterminate,
}

enum PromptFailureAction {
  retry,
  takeControl,
  reconnect,
  approveWorkspace,
  discardUncertain,
}

final class PromptSendFailure {
  const PromptSendFailure({
    required this.code,
    required this.message,
    required this.action,
  });

  final String code;
  final String message;
  final PromptFailureAction action;
}

final class PromptSendStatus {
  const PromptSendStatus({required this.phase, this.failure});

  const PromptSendStatus.ready()
    : phase = PromptSendPhase.ready,
      failure = null;

  final PromptSendPhase phase;
  final PromptSendFailure? failure;

  bool get isBusy =>
      phase == PromptSendPhase.acquiringControl ||
      phase == PromptSendPhase.submitting;
}
