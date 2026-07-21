/// Durable projection of multi-agent supervision state reconstructed from the
/// existing transcript journal.
///
/// Pi core does not expose a native subagent RPC; the [Agent],
/// [get_subagent_result], and [steer_subagent] tools are surfaced through
/// extensions as ordinary tool lifecycle events. This module reuses that
/// authoritative event stream to build a read-only projection that the
/// mobile UI can show. The projection is intentionally narrow:
///
///   * task text, model, requested background mode, lifecycle state,
///     elapsed, originating chat and turn, latest bounded output, and a
///     blocked / error / completion summary,
///   * plus the official `agent_id` reported by the tool result when
///     present.
///
/// Anything that would require inventing data — control capabilities that
/// no protocol message confirms, the contents of a subagent's worktree,
/// or the result of a steer/cancel that was never issued — stays out of
/// the projection. The reducer records explicit blockers when an
/// authoritative capability contract is missing.
library;

import 'dart:collection';

/// Tool names the supervision projection recognises. Anything else is
/// ignored so the reducer stays fast on long transcripts.
class SupervisionToolNames {
  const SupervisionToolNames._();

  /// Tool name used to launch a subagent. The extension-mediated Agent
  /// tool is the only authoritative source for `task`, `model`, and
  /// background mode.
  static const String agent = 'Agent';

  /// Tool name used to poll or fetch a previously-launched subagent
  /// result. The reducer keys `agent_id` reported here back onto the
  /// originating Agent run so a global sheet can address runs by either
  /// the tool-call id or the returned id.
  static const String getSubagentResult = 'get_subagent_result';

  /// Tool name used to steer an existing subagent. The reducer surfaces
  /// the most recent direction message but does not invent a control
  /// surface — steer/cancel/adopt affordances remain gated on a
  /// reported capability contract.
  static const String steerSubagent = 'steer_subagent';
}

/// Lifecycle status of a single supervised agent run.
///
/// Mirrors the `tool.*` event vocabulary so the same label grammar the
/// transcript already uses can be reused without re-mapping.
enum AgentRunStatus { running, completed, error, cancelled }

/// Compact presentation extension for [AgentRunStatus].
extension AgentRunStatusPresentation on AgentRunStatus {
  String get label => switch (this) {
    AgentRunStatus.running => 'Running',
    AgentRunStatus.completed => 'Completed',
    AgentRunStatus.error => 'Error',
    AgentRunStatus.cancelled => 'Cancelled',
  };
}

/// One supervised agent invocation, normalised from tool events.
///
/// A run begins when the bridge emits `tool.started` for the Agent tool
/// and ends when the bridge emits `tool.completed`, `tool.failed`, or
/// `tool.cancelled` for the same `toolCallId`. If the tool result
/// contains a stable `agent_id`, that id becomes the canonical handle
/// for cross-referencing `get_subagent_result` and `steer_subagent`
/// events back to the originating run.
///
/// All fields are immutable. The reducer produces a new
/// [AgentRun] every time the projection advances.
class AgentRun {
  const AgentRun({
    required this.toolCallId,
    required this.task,
    required this.subagentType,
    required this.model,
    required this.thinkingLevel,
    required this.backgroundRequested,
    required this.status,
    required this.startedAt,
    this.agentId,
    this.endedAt,
    this.originChatId,
    this.originTurnId,
    this.assistantStepId,
    this.latestOutput,
    this.latestOutputCapturedAt,
    this.errorMessage,
    this.blockedReason,
    this.lastSteerDirection,
    this.lastSteerAt,
    this.caps,
  });

  /// The Agent tool's `toolCallId`. Always present — the reducer
  /// never produces a run without an originating tool call.
  final String toolCallId;

  /// Bounded task description from the Agent tool arguments. The
  /// reducer caps the value to keep memory predictable.
  final String task;

  /// Extension-reported subagent type (for example
  /// `general-purpose` or `statusline-setup`). Opaque to the mobile
  /// layer — surfaced verbatim.
  final String? subagentType;

  /// Model identifier requested for the subagent, if any. Opaque.
  final String? model;

  /// Extension-reported thinking level, if any. Opaque.
  final String? thinkingLevel;

  /// True when the parent prompt asked the subagent to run in the
  /// background. False when foreground.
  final bool backgroundRequested;

  /// Lifecycle status.
  final AgentRunStatus status;

  /// When the run started (first `tool.started` observed for the
  /// originating call).
  final DateTime startedAt;

  /// Canonical agent id reported by the tool result, when the
  /// extension populates one. Null while the tool is still running
  /// or for runs whose extension does not return an id.
  final String? agentId;

  /// When the run ended, if it has.
  final DateTime? endedAt;

  /// Chat that initiated the run. Carried over from the
  /// `turn.started` event that bracketed the Agent tool call.
  final String? originChatId;

  /// Originating user turn identifier, same source.
  final String? originTurnId;

  /// Assistant step that bracketed the Agent tool call. Useful when
  /// the same user turn triggers multiple parallel agent runs.
  final String? assistantStepId;

  /// Most recent bounded meaningful output for the run. Fed from
  /// `tool.output` deltas and the final tool result text. Always
  /// already-trimmed; the widget renders the value verbatim.
  final String? latestOutput;

  /// When [latestOutput] was last refreshed. Null until the first
  /// non-empty output arrives.
  final DateTime? latestOutputCapturedAt;

  /// Short error message when [status] is [AgentRunStatus.error].
  final String? errorMessage;

  /// One-line human-readable reason the run is considered blocked
  /// (for example because the parent prompt was rejected, because
  /// the run was blocked by an extension, or because the result was
  /// never delivered). Null when no blocking condition was reported.
  final String? blockedReason;

  /// Most recent steer direction sent to the run, when a
  /// `steer_subagent` tool call observed an `agent_id` matching
  /// this run.
  final String? lastSteerDirection;

  /// When [lastSteerDirection] was captured.
  final DateTime? lastSteerAt;

  /// Reported control capabilities for this run. Defaults to all
  /// false; the reducer only flips a flag to true when an
  /// authoritative capability event is observed.
  final AgentRunCapabilities? caps;

  /// True while the run is still in flight.
  bool get isRunning => status == AgentRunStatus.running;

  /// True once the run reached any terminal state.
  bool get isTerminal => !isRunning;

  /// Elapsed duration since [startedAt] when the reducer built the
  /// projection. The UI clamps the value so a long-running run
  /// does not overflow the available space.
  Duration elapsedAt(DateTime now) {
    final end = endedAt ?? now;
    final delta = end.difference(startedAt);
    return delta.isNegative ? Duration.zero : delta;
  }

  AgentRun copyWith({
    String? toolCallId,
    String? task,
    Object? subagentType = _sentinel,
    Object? model = _sentinel,
    Object? thinkingLevel = _sentinel,
    bool? backgroundRequested,
    AgentRunStatus? status,
    DateTime? startedAt,
    Object? agentId = _sentinel,
    Object? endedAt = _sentinel,
    Object? originChatId = _sentinel,
    Object? originTurnId = _sentinel,
    Object? assistantStepId = _sentinel,
    Object? latestOutput = _sentinel,
    Object? latestOutputCapturedAt = _sentinel,
    Object? errorMessage = _sentinel,
    Object? blockedReason = _sentinel,
    Object? lastSteerDirection = _sentinel,
    Object? lastSteerAt = _sentinel,
    AgentRunCapabilities? caps,
  }) {
    return AgentRun(
      toolCallId: toolCallId ?? this.toolCallId,
      task: task ?? this.task,
      subagentType: identical(subagentType, _sentinel)
          ? this.subagentType
          : subagentType as String?,
      model: identical(model, _sentinel) ? this.model : model as String?,
      thinkingLevel: identical(thinkingLevel, _sentinel)
          ? this.thinkingLevel
          : thinkingLevel as String?,
      backgroundRequested: backgroundRequested ?? this.backgroundRequested,
      status: status ?? this.status,
      startedAt: startedAt ?? this.startedAt,
      agentId: identical(agentId, _sentinel)
          ? this.agentId
          : agentId as String?,
      endedAt: identical(endedAt, _sentinel)
          ? this.endedAt
          : endedAt as DateTime?,
      originChatId: identical(originChatId, _sentinel)
          ? this.originChatId
          : originChatId as String?,
      originTurnId: identical(originTurnId, _sentinel)
          ? this.originTurnId
          : originTurnId as String?,
      assistantStepId: identical(assistantStepId, _sentinel)
          ? this.assistantStepId
          : assistantStepId as String?,
      latestOutput: identical(latestOutput, _sentinel)
          ? this.latestOutput
          : latestOutput as String?,
      latestOutputCapturedAt: identical(latestOutputCapturedAt, _sentinel)
          ? this.latestOutputCapturedAt
          : latestOutputCapturedAt as DateTime?,
      errorMessage: identical(errorMessage, _sentinel)
          ? this.errorMessage
          : errorMessage as String?,
      blockedReason: identical(blockedReason, _sentinel)
          ? this.blockedReason
          : blockedReason as String?,
      lastSteerDirection: identical(lastSteerDirection, _sentinel)
          ? this.lastSteerDirection
          : lastSteerDirection as String?,
      lastSteerAt: identical(lastSteerAt, _sentinel)
          ? this.lastSteerAt
          : lastSteerAt as DateTime?,
      caps: caps ?? this.caps,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AgentRun &&
      other.toolCallId == toolCallId &&
      other.task == task &&
      other.subagentType == subagentType &&
      other.model == model &&
      other.thinkingLevel == thinkingLevel &&
      other.backgroundRequested == backgroundRequested &&
      other.status == status &&
      other.startedAt == startedAt &&
      other.agentId == agentId &&
      other.endedAt == endedAt &&
      other.originChatId == originChatId &&
      other.originTurnId == originTurnId &&
      other.assistantStepId == assistantStepId &&
      other.latestOutput == latestOutput &&
      other.latestOutputCapturedAt == latestOutputCapturedAt &&
      other.errorMessage == errorMessage &&
      other.blockedReason == blockedReason &&
      other.lastSteerDirection == lastSteerDirection &&
      other.lastSteerAt == lastSteerAt &&
      other.caps == caps;

  @override
  int get hashCode => Object.hash(
    toolCallId,
    task,
    subagentType,
    model,
    thinkingLevel,
    backgroundRequested,
    status,
    startedAt,
    agentId,
    endedAt,
    originChatId,
    originTurnId,
    assistantStepId,
    latestOutput,
    latestOutputCapturedAt,
    errorMessage,
    blockedReason,
    lastSteerDirection,
    lastSteerAt,
    caps,
  );
}

/// Reported control capabilities for a single run. Every field is
/// false by default and only flips when an authoritative event — for
/// example an extension capability advertisement — proves the
/// capability exists. The UI surfaces `unavailable` whenever a flag
/// is false so users see the truth instead of a silently disabled
/// affordance.
class AgentRunCapabilities {
  const AgentRunCapabilities({
    this.canSteer = false,
    this.canCancel = false,
    this.canAdopt = false,
    this.contractSource,
  });

  /// True when an authoritative contract proves this run can be
  /// steered mid-flight.
  final bool canSteer;

  /// True when an authoritative contract proves this run can be
  /// cancelled.
  final bool canCancel;

  /// True when an authoritative contract proves the parent chat
  /// can adopt the run's result.
  final bool canAdopt;

  /// Short, opaque description of where the capability contract
  /// came from. Useful for the UI's blocker tooltip and for tests.
  final String? contractSource;

  AgentRunCapabilities copyWith({
    bool? canSteer,
    bool? canCancel,
    bool? canAdopt,
    Object? contractSource = _sentinel,
  }) {
    return AgentRunCapabilities(
      canSteer: canSteer ?? this.canSteer,
      canCancel: canCancel ?? this.canCancel,
      canAdopt: canAdopt ?? this.canAdopt,
      contractSource: identical(contractSource, _sentinel)
          ? this.contractSource
          : contractSource as String?,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AgentRunCapabilities &&
      other.canSteer == canSteer &&
      other.canCancel == canCancel &&
      other.canAdopt == canAdopt &&
      other.contractSource == contractSource;

  @override
  int get hashCode =>
      Object.hash(canSteer, canCancel, canAdopt, contractSource);
}

/// One blocker the reducer observed while reconstructing a run.
/// Blockers are surfaced verbatim so the UI can tell users why an
/// affordance is unavailable without inventing a reason.
class AgentSupervisionBlocker {
  const AgentSupervisionBlocker({
    required this.toolCallId,
    required this.kind,
    required this.detail,
  });

  /// The originating Agent run's toolCallId.
  final String toolCallId;

  /// The class of blocker. Currently one of:
  ///   * `no_steer_contract`
  ///   * `no_cancel_contract`
  ///   * `no_adopt_contract`
  final String kind;

  /// One-line human-readable detail explaining the blocker.
  final String detail;
}

/// Summary entry produced when a run reaches a terminal state. The
/// mobile sheet renders these as compact compare summaries; the
/// underlying transcript card remains the source of truth.
class AgentRunSummary {
  const AgentRunSummary({
    required this.toolCallId,
    required this.status,
    required this.startedAt,
    required this.endedAt,
    required this.task,
    required this.model,
    required this.subagentType,
    required this.backgroundRequested,
    required this.errorMessage,
    required this.blockedReason,
    required this.latestOutput,
    required this.originChatId,
    required this.originTurnId,
  });

  final String toolCallId;
  final AgentRunStatus status;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String task;
  final String? model;
  final String? subagentType;
  final bool backgroundRequested;
  final String? errorMessage;
  final String? blockedReason;
  final String? latestOutput;
  final String? originChatId;
  final String? originTurnId;
}

/// Whole-session agent supervision projection.
///
/// The reducer produces one [AgentSupervisionState] per applied
/// journal event. The widget layer holds the latest projection for
/// the currently-selected chat and renders a compact sheet from it.
class AgentSupervisionState {
  AgentSupervisionState({
    Iterable<AgentRun> runs = const <AgentRun>[],
    Iterable<AgentSupervisionBlocker> blockers =
        const <AgentSupervisionBlocker>[],
    this.currentTurnId,
    this.currentChatId,
  }) : _runsByToolCallId = LinkedHashMap<String, AgentRun>.fromIterable(
         runs,
         key: (run) => (run as AgentRun).toolCallId,
         value: (run) => run as AgentRun,
       ),
       _runsByAgentId = _indexByAgentId(runs),
       _blockers = List<AgentSupervisionBlocker>.unmodifiable(blockers);

  /// Empty projection. Used by the widget when the journal is empty
  /// or when no Agent tool has been seen yet.
  factory AgentSupervisionState.empty() => AgentSupervisionState();

  /// Most recently observed turn id. Used by the reducer to attach
  /// an origin turn id to runs whose `tool.started` event arrived
  /// after the matching `turn.started` event.
  final String? currentTurnId;

  /// Chat id derived from the most recent stream id the reducer
  /// processed. Lets the projection survive `turn.started` events
  /// that omit chat metadata.
  final String? currentChatId;

  final LinkedHashMap<String, AgentRun> _runsByToolCallId;
  final Map<String, AgentRun> _runsByAgentId;
  final List<AgentSupervisionBlocker> _blockers;

  /// All runs in insertion order. The reducer appends in the order
  /// the originating `tool.started` events arrive, so the visible
  /// sheet matches the transcript order.
  List<AgentRun> get runs =>
      List<AgentRun>.unmodifiable(_runsByToolCallId.values);

  /// All observed blockers, in arrival order.
  List<AgentSupervisionBlocker> get blockers =>
      List<AgentSupervisionBlocker>.unmodifiable(_blockers);

  /// Number of currently-running agent runs. The UI uses this to
  /// decide whether to show a count badge.
  int get runningCount =>
      _runsByToolCallId.values.where((run) => run.isRunning).length;

  /// Returns the run keyed by Agent tool `toolCallId`, or null.
  AgentRun? runByToolCallId(String toolCallId) => _runsByToolCallId[toolCallId];

  /// Returns the run keyed by the extension-reported `agent_id`,
  /// or null when the run has not yet reported an id.
  AgentRun? runByAgentId(String agentId) => _runsByAgentId[agentId];

  /// Internal mutable view used by the reducer to build the next
  /// projection without copying the public [runs] list.
  LinkedHashMap<String, AgentRun> get runsByToolCallId => _runsByToolCallId;

  AgentSupervisionState copyWith({
    LinkedHashMap<String, AgentRun>? runsByToolCallId,
    Map<String, AgentRun>? runsByAgentId,
    List<AgentSupervisionBlocker>? blockers,
    Object? currentTurnId = _sentinel,
    Object? currentChatId = _sentinel,
  }) {
    final next = AgentSupervisionState._emptyInternal(
      runsByToolCallId ?? _runsByToolCallId,
      runsByAgentId ?? _runsByAgentId,
      blockers ?? _blockers,
      identical(currentTurnId, _sentinel)
          ? this.currentTurnId
          : currentTurnId as String?,
      identical(currentChatId, _sentinel)
          ? this.currentChatId
          : currentChatId as String?,
    );
    return next;
  }

  AgentSupervisionState._emptyInternal(
    this._runsByToolCallId,
    this._runsByAgentId,
    this._blockers,
    this.currentTurnId,
    this.currentChatId,
  );

  static Map<String, AgentRun> _indexByAgentId(Iterable<AgentRun> runs) {
    final index = <String, AgentRun>{};
    for (final run in runs) {
      final id = run.agentId;
      if (id != null && id.isNotEmpty) index[id] = run;
    }
    return index;
  }

  @override
  bool operator ==(Object other) {
    if (other is! AgentSupervisionState) return false;
    if (other.currentTurnId != currentTurnId) return false;
    if (other.currentChatId != currentChatId) return false;
    if (other._runsByToolCallId.length != _runsByToolCallId.length) {
      return false;
    }
    for (final entry in _runsByToolCallId.entries) {
      final otherEntry = other._runsByToolCallId[entry.key];
      if (otherEntry != entry.value) return false;
    }
    if (other._runsByAgentId.length != _runsByAgentId.length) return false;
    for (final entry in _runsByAgentId.entries) {
      if (other._runsByAgentId[entry.key] != entry.value) return false;
    }
    if (other._blockers.length != _blockers.length) return false;
    for (var i = 0; i < _blockers.length; i++) {
      if (other._blockers[i] != _blockers[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    currentTurnId,
    currentChatId,
    Object.hashAll(_runsByToolCallId.values),
    Object.hashAll(_runsByAgentId.values),
    Object.hashAll(_blockers),
  );
}

/// Sentinel used by [AgentRun.copyWith] to distinguish "leave
/// unchanged" from "set to null". Without this, callers could not
/// clear a value (such as `latestOutput`) by passing null.
const Object _sentinel = Object();
