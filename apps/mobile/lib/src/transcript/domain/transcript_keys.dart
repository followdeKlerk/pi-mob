/// Stable, deterministic keys for transcript entities.
///
/// Widget keys, jump anchors, history-paging records, and reconnect/replay
/// reconciliation all rely on these values being identical across rebuilds,
/// reconnects, and replays. The functions in this file never inspect host
/// secrets or path-like fields; they only consume protocol-level identifiers
/// and content-block ids that the bridge has already vetted.
///
/// All keys are pure functions of the inputs: calling [userTurnKey] with the
/// same [turnId] always returns the same string, so [Map] and [Set] lookups
/// behave as expected even after the reducer rebuilds the transcript from
/// scratch on every event.
library;

class TranscriptKeys {
  const TranscriptKeys._();

  /// Key for a user-initiated turn. Derived from the bridge `turnId` so the
  /// same turn keeps its widget key even after a reconnect that reuses the
  /// originating command id.
  static String userTurnKey(String turnId) => 'turn:user:$turnId';

  /// Key for an assistant turn. The assistant turn reuses the bridge
  /// `turnId` so the user/assistant pair stays aligned.
  static String assistantTurnKey(String turnId) => 'turn:assistant:$turnId';

  /// Key for a system turn (e.g. `turn.aborted`, `turn.failed`). The kind
  /// participates in the key so the same `turnId` can carry both a
  /// `waitingForInput` system turn and a later `failed` system turn without
  /// colliding.
  static String systemTurnKey(String turnId, String kind) =>
      'turn:system:$turnId:$kind';

  /// Key for a reasoning item. Stable across reconnects because reasoning
  /// blocks carry their own identifier in the protocol payload.
  static String reasoningKey(String reasoningId) =>
      'item:reasoning:$reasoningId';

  /// Key for a final-answer item.
  static String finalAnswerKey(String answerId) => 'item:answer:$answerId';

  /// Key for a tool item.
  static String toolKey(String toolCallId) => 'item:tool:$toolCallId';

  /// Key for an unknown / diagnostic item. Falls back to the cursor when the
  /// event does not expose a content block id, so the widget can still keep
  /// the same anchor across rebuilds.
  static String unknownKey(String fallbackId) => 'item:unknown:$fallbackId';

  /// Key for a parallel tool group. All tool items started within the same
  /// assistant step share this key, so the widget can group them under a
  /// single parallel card without flattening their outputs.
  static String parallelGroupKey(String assistantStepId) =>
      'parallel:$assistantStepId';
}
