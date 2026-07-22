import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';

import '../../protocol_fixture.dart';
import '../attachments/attachment_transport.dart';
import '../attachments/image_attachment_picker.dart';
import '../data/app_database.dart' hide StreamCursor;
import '../domain/attachments.dart';
import '../domain/controller_lease.dart';
import '../domain/interaction_state.dart';
import '../domain/mobile_state.dart';
import '../domain/prompt_send_lifecycle.dart';
import '../domain/process_domain.dart';
import '../git/git_domain.dart' show GitState, reduceGit;
import '../plans/plan_domain.dart' show PlanState, reducePlan;
import '../domain/session_controls.dart';
import '../domain/session_directory.dart';
import '../domain/session_subscriptions.dart';
import '../controls/control_view_data.dart';
import '../domain/session_tree.dart';
import '../sync/event_reducer.dart';
import 'bridge_transport.dart';

enum ConnectionPhase {
  unpaired,
  probing,
  connecting,
  handshaking,
  synchronizing,
  ready,
  degraded,
  disconnected,
  hostUnreachable,
  incompatible,
  hostDraining,
  background,
}

enum SessionCreationPhase { idle, creating, created, failed }

@immutable
final class SessionCreationState {
  const SessionCreationState._({
    required this.phase,
    this.commandId,
    this.workspaceId,
    this.sessionId,
    this.error,
  });

  const SessionCreationState.idle() : this._(phase: SessionCreationPhase.idle);

  const SessionCreationState.creating({
    required String commandId,
    required String workspaceId,
  }) : this._(
         phase: SessionCreationPhase.creating,
         commandId: commandId,
         workspaceId: workspaceId,
       );

  const SessionCreationState.created({
    required String commandId,
    required String workspaceId,
    required String sessionId,
  }) : this._(
         phase: SessionCreationPhase.created,
         commandId: commandId,
         workspaceId: workspaceId,
         sessionId: sessionId,
       );

  const SessionCreationState.failed({
    required String commandId,
    required String workspaceId,
    required String error,
  }) : this._(
         phase: SessionCreationPhase.failed,
         commandId: commandId,
         workspaceId: workspaceId,
         error: error,
       );

  final SessionCreationPhase phase;
  final String? commandId;
  final String? workspaceId;
  final String? sessionId;
  final String? error;

  bool get isCreating => phase == SessionCreationPhase.creating;
}

/// Server-reported workspace entry. Kept here as a re-export of the domain
/// type so existing callers continue to compile.
typedef WorkspaceInfo = WorkspaceEntry;

/// In-flight bookkeeping for a `session.history.page` round trip. The
/// coordinator pairs the request id with the connection epoch at the time of
/// send so a response that arrives after a socket teardown is dropped
/// instead of silently overwriting a fresh page.
class _HistoryRequest {
  const _HistoryRequest({required this.sessionId, required this.epoch});

  final String sessionId;
  final int epoch;
}

/// D-039 binds a session-less process snapshot result to the connection that
/// requested it. Results are consumed once so a delayed duplicate can never
/// clear a newer projection.
class _ProcessSnapshotRequest {
  const _ProcessSnapshotRequest({
    required this.sessionId,
    required this.epoch,
  });

  final String sessionId;
  final int epoch;
}

/// Tracks an in-flight `git.summary.request` so the response can be
/// correlated by request ID. Results are consumed once so a delayed
/// duplicate cannot apply a stale Git/CI surface to a new connection
/// epoch, mirroring the D-039 process snapshot correlation.
class _GitSummaryRequest {
  const _GitSummaryRequest({
    required this.workspaceId,
    required this.epoch,
  });

  final String workspaceId;
  final int epoch;
}

/// R2 — Tracks an in-flight `plan.summary.request` so the response can be
/// correlated by request ID and connection epoch. Mirrors the D-039
/// pattern used by process snapshots and git summary.
class _PlanSummaryRequest {
  const _PlanSummaryRequest({
    required this.sessionId,
    required this.turnId,
    required this.epoch,
  });

  final String sessionId;
  final String turnId;
  final int epoch;
}

class _PendingPrompt {
  _PendingPrompt({
    required this.sessionId,
    required this.commandId,
    required this.payload,
    required this.state,
  });

  final String sessionId;
  final String commandId;
  final Map<String, Object?> payload;
  String state;
}

class _TranscriptEventsCache {
  const _TranscriptEventsCache({
    required this.history,
    required this.live,
    required this.result,
  });
  final List<StreamEventState> history;
  final List<StreamEventState> live;
  final List<StreamEventState> result;
}

/// Owns the foreground bridge socket and the durable one-session M5 state.
///
/// The transport is injected so synchronization, lost-receipt recovery, and
/// lifecycle behavior are deterministic in tests. A pending prompt is written
/// before it is sent. Reconnect only asks `command.current`; it never resends.
final class ConnectionCoordinator extends ChangeNotifier
    with WidgetsBindingObserver {
  ConnectionCoordinator({
    required BridgeTransport transport,
    required AppDatabase database,
    Uuid uuid = const Uuid(),
    DateTime Function()? now,
  }) : // Public parameter names keep this boundary ergonomic while these
       // assignments retain private fields.
       // ignore: prefer_initializing_formals
       _transport = transport,
       // ignore: prefer_initializing_formals
       _database = database,
       // ignore: prefer_initializing_formals
       _uuid = uuid,
       _now = now ?? (() => DateTime.now().toUtc());

  String installationId = '';
  static const _acceptedOrLater = <String>{
    'accepted',
    'dispatched',
    'running',
    'completed',
    'succeeded',
  };

  // Sentinel returned by firstWhere/orElse to keep workspace lookups
  // non-throwing. Equality is identity-based so it cannot accidentally match
  // any real entry.
  static final WorkspaceEntry _missingWorkspace = WorkspaceEntry(
    workspaceId: '',
    displayName: '',
    rootLabel: '',
    relativePath: '',
    repositoryMarker: null,
    lastUsedAt: null,
    availability: WorkspaceAvailability.unavailable,
    trustState: WorkspaceTrustState.unknown,
    fingerprint: '',
    policyVersion: '',
    manifest: const <WorkspaceResource>[],
  );

  final BridgeTransport _transport;
  final AppDatabase _database;
  final Uuid _uuid;
  final DateTime Function() _now;
  final OrderedEventReducer _reducer = const OrderedEventReducer();
  final Map<String, StreamViewState> _streams = {};
  final Map<String, SnapshotAssembler> _snapshots = {};
  final Map<String, String> _snapshotStreams = {};
  final Map<String, SessionState> _sessions = {};
  final Set<String> _locallyDeletedSessionIds = {};
  final Map<String, SessionControlState> _sessionControls = {};
  final List<ModelOption> _models = [];
  Completer<void>? _modelListCompleter;
  Future<void>? _modelListFuture;
  String? _modelListRequestId;
  final Map<String, SessionHistoryState> _history = {};
  final Map<String, _TranscriptEventsCache> _transcriptEventsCache = {};
  // In-flight `session.history.page` requests. The host may take several
  // seconds to return a large page; without bookkeeping we could apply a
  // response from a stale epoch after the user has reconnected.
  final Map<String, _HistoryRequest> _historyRequests = {};
  final Map<String, _ProcessSnapshotRequest> _processSnapshotRequests = {};
  ProcessDomainState _processes = const ProcessDomainState();
  final Map<String, _GitSummaryRequest> _gitSummaryRequests = {};
  GitState _git = const GitState();
  final Map<String, _PlanSummaryRequest> _planSummaryRequests = {};
  PlanState _plans = const PlanState();
  final List<String> _historySyncQueue = [];
  final Map<String, String?> _historySyncLocalRevisions = {};
  String? _historySyncCurrentSessionId;
  int _historySyncTotal = 0;
  int _historySyncCompleted = 0;
  bool _historyGateComplete = false;
  String? _historyGateError;
  Completer<void>? _pairingCompleter;
  final List<WorkspaceEntry> _workspaces = [];
  final List<String> _rawEvents = [];
  final Set<String> _syncPending = {};
  final Set<String> _forceSnapshot = {};
  String? _deferredAutoSelectSessionId;
  SessionCreationState _sessionCreation = const SessionCreationState.idle();
  Completer<void>? _sessionCreationCompleter;
  Timer? _sessionCreationTimer;
  String? _creationSelectingSessionId;
  WorkspaceSearchState _workspaceSearch = WorkspaceSearchState.idle();
  int _workspaceSearchEpoch = 0;
  String? _workspaceTrustRequiredFor;
  // M11 multi-session support. The set holds at most one full
  // subscription and at most five summary subscriptions; each cursor
  // advances independently so a gap on one background session cannot
  // stall the foreground session.
  SessionSubscriptionSet _subscriptionSet = SessionSubscriptionSet.empty();
  final ControllerBook _controllers = ControllerBook();
  final Map<String, Completer<void>> _controllerWaiters = {};
  final Map<String, _PendingPrompt> _pendingPromptsBySession = {};
  final Map<String, String> _pendingCurrentRequestCommand = {};
  final Map<String, PromptSendStatus> _promptSendBySession = {};
  final Map<String, String> _lastPromptCommandBySession = {};
  bool _sendRecoveryInFlight = false;
  final Map<String, SessionAttentionState> _attention = {};
  final Map<String, String> _attentionWire = {};
  final Map<String, int> _unreadCount = {};
  // Per-session draft map: the active session's draft is mirrored into
  // this map on select so an observer session's draft survives a fast
  // switch and is preserved across takeover/release transitions.
  final Map<String, String> _draftBySession = {};
  final Map<String, DeliveryMode> _deliveryModeBySession = {};
  // M13 — draft attachment references per session. The on-disk source of
  // truth is `local_attachments`; this in-memory mirror is what the prompt
  // submit path and the UI affordances read. Mirroring here means a fast
  // session switch never shows the wrong attachment list.
  final Map<String, List<AttachmentRef>> _attachmentsBySession = {};
  final Map<String, List<FollowUpItem>> _followUpsBySession = {};
  final Map<String, ExtensionDialogState> _dialogsBySession = {};
  final Map<String, String> _expiredDialogInput = {};
  String? editorPrefill;
  String? extensionStatus;
  String? extensionTitle;
  String? extensionWidgetText;
  String? latestExtensionNotice;
  String? latestExportId;
  String? latestExportState;
  int? latestExportBytes;
  final SessionTreeProjection _sessionTree = SessionTreeProjection();

  BridgeSocket? _socket;
  StreamSubscription<String>? _socketSubscription;
  Timer? _reconnectTimer;
  Timer? _ackTimer;
  Timer? _leaseTimer;
  Future<void> _messageTail = Future.value();
  int _connectionEpoch = 0;
  int _eventsSinceAck = 0;
  bool _foreground = true;
  bool _carryDraftAfterGeneration = false;
  bool _hostReadinessRecoveryInFlight = false;
  bool _notifyScheduled = false;
  bool _initialized = false;
  bool _disposed = false;

  ConnectionPhase phase = ConnectionPhase.unpaired;
  Uri? endpoint;
  EndpointProbe? readiness;
  String? errorMessage;
  String? connectionId;
  String? hostId;
  String? hostGeneration;
  String? hostDisplayName;
  String? bridgeVersion;
  String? piVersion;
  String protocolVersion = '1.0';
  String? selectedWorkspaceId;
  String? selectedSessionId;
  String? leaseId;
  String draft = '';
  String? pendingCommandId;
  Map<String, Object?>? pendingPayload;
  String? pendingState;
  DeliveryMode selectedDeliveryMode = DeliveryMode.immediate;

  PromptSendStatus get promptSendStatus {
    final sessionId = selectedSessionId;
    if (sessionId == null) return const PromptSendStatus.ready();
    return _promptSendBySession[sessionId] ?? const PromptSendStatus.ready();
  }

  bool get isReady => phase == ConnectionPhase.ready && _socket != null;
  bool get historyGateComplete => _historyGateComplete;
  bool get historyGateRunning =>
      !_historyGateComplete && _historySyncCurrentSessionId != null;
  String? get historyGateError => _historyGateError;
  int get historySyncTotal => _historySyncTotal;
  int get historySyncCompleted => _historySyncCompleted;
  String? get historySyncCurrentSessionId => _historySyncCurrentSessionId;
  double get historySyncProgress => _historySyncTotal == 0
      ? (_historyGateComplete ? 1 : 0)
      : _historySyncCompleted / _historySyncTotal;

  /// Stream identifiers still awaiting an authoritative sync-complete frame.
  /// Exposed for Host diagnostics; callers receive an immutable snapshot.
  List<String> get pendingSynchronizationStreams =>
      List<String>.unmodifiable(_syncPending);

  /// True when the composer can submit the current draft. In addition to the
  /// connection / session prerequisites, the selected [DeliveryMode] must be
  /// compatible with the current session runtime state:
  ///
  /// - `immediate` is only valid while the session is idle or stopped (or
  ///   when the state is still unknown).
  /// - `steer` and `followUp` require the session to be running.
  ///
  /// Read-only sessions are still allowed to send prompts here because the
  /// host enforces the tool hook; the mobile client must not block authoring.
  bool get _selectedHasActiveTurnEvidence {
    final sessionId = selectedSessionId;
    if (sessionId == null) return false;
    final events = _streams['session:$sessionId']?.events;
    if (events == null) return false;
    for (final event in events.reversed) {
      switch (event.type) {
        case 'turn.settled':
        case 'turn.aborted':
        case 'turn.failed':
        case 'turn.indeterminate':
        case 'turn.interrupted':
          return false;
        case 'turn.started':
        case 'turn.waiting_for_input':
        case 'turn.retrying':
        case 'turn.compacting':
          return true;
      }
    }
    return false;
  }

  String? get _effectiveRuntimeState {
    final state = selectedRuntimeState;
    if (const {
          'running',
          'waiting_for_input',
          'retrying',
          'finishing',
        }.contains(state) &&
        !_selectedHasActiveTurnEvidence) {
      return 'idle';
    }
    return state;
  }

  DeliveryMode get _effectiveDeliveryMode {
    if (_effectiveRuntimeState != 'running') return DeliveryMode.immediate;
    return selectedDeliveryMode == DeliveryMode.immediate
        ? DeliveryMode.followUp
        : selectedDeliveryMode;
  }

  bool get canAttemptSend {
    final sessionId = selectedSessionId;
    final selected = sessionId == null ? null : _sessions[sessionId];
    final lifecycle = sessionId == null
        ? null
        : _sessionTree[sessionId]?.lifecycle;
    if (_sendRecoveryInFlight ||
        !isReady ||
        sessionId == null ||
        selected == null ||
        _locallyDeletedSessionIds.contains(sessionId) ||
        lifecycle == SessionLifecycleState.softDeleted ||
        lifecycle == SessionLifecycleState.purged ||
        draft.trim().isEmpty ||
        pendingCommandId != null ||
        requiresTrustApproval) {
      return false;
    }
    return _deliveryModeMatchesRuntime(
      _effectiveDeliveryMode,
      _effectiveRuntimeState,
    );
  }

  bool get canSend {
    if (!isReady ||
        selectedSessionId == null ||
        leaseId == null ||
        draft.trim().isEmpty ||
        pendingCommandId != null ||
        requiresTrustApproval) {
      return false;
    }
    return _deliveryModeMatchesRuntime(
      _effectiveDeliveryMode,
      _effectiveRuntimeState,
    );
  }

  /// Human-readable explanation of why [canSend] is false, or `null` when the
  /// composer is sendable. The UI binds this to the disabled affordance.
  String? get composerDisabledReason {
    if (requiresTrustApproval) {
      return 'Approve workspace trust before sending.';
    }
    if (!isReady) return 'Bridge is not ready.';
    if (selectedSessionId == null) return 'Select a session.';
    if (leaseId == null) return 'Acquire the controller lease.';
    if (draft.trim().isEmpty) return 'Compose a message before sending.';
    if (pendingCommandId != null) return 'A command is already in flight.';
    final state = _effectiveRuntimeState;
    if (!_deliveryModeMatchesRuntime(_effectiveDeliveryMode, state)) {
      return _deliveryModeMismatchReason(_effectiveDeliveryMode, state);
    }
    return null;
  }

  WorkspaceEntry? get selectedWorkspace {
    final id = selectedWorkspaceId;
    if (id == null) return null;
    for (final w in _workspaces) {
      if (w.workspaceId == id) return w;
    }
    return null;
  }

  bool get canRetry {
    final sessionId = selectedSessionId;
    final prompt = sessionId == null
        ? null
        : _pendingPromptsBySession[sessionId];
    return isReady &&
        prompt != null &&
        prompt.commandId == pendingCommandId &&
        promptSendStatus.phase == PromptSendPhase.failed;
  }

  bool get canAbort =>
      isReady &&
      selectedSessionId != null &&
      leaseId != null &&
      _selectedHasActiveTurnEvidence &&
      const {
        'running',
        'waiting_for_input',
        'retrying',
        'finishing',
      }.contains(selectedRuntimeState);
  String? get selectedRuntimeState => selectedSessionId == null
      ? null
      : _sessions[selectedSessionId]?.runtimeState;
  bool get canRetrySession {
    final session = selectedSessionId == null
        ? null
        : _sessions[selectedSessionId];
    return isReady &&
        leaseId != null &&
        session != null &&
        const {
          'crashed',
          'crash_loop',
          'provider_interrupted',
          'indeterminate',
        }.contains(session.runtimeState);
  }

  List<WorkspaceInfo> get workspaces => List.unmodifiable(_workspaces);
  WorkspaceSearchState get workspaceSearch => _workspaceSearch;
  String? get workspaceTrustRequiredFor => _workspaceTrustRequiredFor;
  SessionCreationState get sessionCreation => _sessionCreation;

  /// True while the active workspace is missing an approved trust record, a
  /// fingerprint change invalidated the previous approval, or the workspace is
  /// marked unavailable. The composer must not send prompts while this holds.
  bool get requiresTrustApproval {
    final selected = selectedWorkspaceId;
    if (selected == null) return false;
    final entry = _workspaces.firstWhere(
      (w) => w.workspaceId == selected,
      orElse: () => _missingWorkspace,
    );
    if (entry == _missingWorkspace) return true;
    if (entry.availability != WorkspaceAvailability.available) return true;
    return entry.trustState != WorkspaceTrustState.approved;
  }

  /// The active policy on the currently selected session. Defaults to Full
  /// because Pi sessions are created Full unless the user explicitly demotes.
  SessionPolicyMode get activePolicyMode {
    final id = selectedSessionId;
    if (id == null) return SessionPolicyMode.full;
    final mode = _sessions[id]?.policyMode;
    if (mode == 'read_only') return SessionPolicyMode.readOnly;
    return SessionPolicyMode.full;
  }

  /// Selects the composer delivery mode. The selection is sticky per session
  /// and persists with the draft so reconnecting after a host generation
  /// reset does not silently re-arm `immediate` against a still-running turn.
  Future<void> setSelectedDeliveryMode(DeliveryMode mode) async {
    if (selectedDeliveryMode == mode) return;
    selectedDeliveryMode = mode;
    _notify();
    await _persistDraft();
  }

  /// True when [mode] is a valid delivery choice for a session whose current
  /// runtime [state] is reported by the host. Used by [canSend] and the UI
  /// affordance gating.
  static bool _deliveryModeMatchesRuntime(DeliveryMode mode, String? state) {
    switch (mode) {
      case DeliveryMode.immediate:
        // Session is eligible for an immediate prompt when idle, stopped, or
        // when the state has not yet been reported. Anything else means a
        // turn is already in flight or has crashed and the bridge cannot
        // dispatch directly.
        return state == null || state == 'idle' || state == 'stopped';
      case DeliveryMode.steer:
      case DeliveryMode.followUp:
        return state == 'running';
    }
  }

  static String _deliveryModeMismatchReason(DeliveryMode mode, String? state) {
    final shown = state ?? 'unknown';
    switch (mode) {
      case DeliveryMode.immediate:
        return 'Session is $shown; switch to Steer or Queue follow-up.';
      case DeliveryMode.steer:
        return 'Steer is only available while the session is running.';
      case DeliveryMode.followUp:
        return 'Follow-ups are only available while the session is running.';
    }
  }

  bool _isActiveChat(String sessionId) {
    if (!_sessions.containsKey(sessionId) ||
        _locallyDeletedSessionIds.contains(sessionId)) {
      return false;
    }
    final lifecycle = _sessionTree[sessionId]?.lifecycle;
    return lifecycle != SessionLifecycleState.softDeleted &&
        lifecycle != SessionLifecycleState.purged;
  }

  List<SessionState> get _activeChats => _sessions.values
      .where((session) => _isActiveChat(session.sessionId))
      .toList(growable: false);

  List<SessionState> get sessions => List.unmodifiable(_activeChats);
  List<FollowUpItem> get selectedFollowUps =>
      List.unmodifiable(_followUpsBySession[selectedSessionId] ?? const []);
  ExtensionDialogState? get selectedDialog =>
      selectedSessionId == null ? null : _dialogsBySession[selectedSessionId!];
  String? expiredDialogInput(String dialogId) => _expiredDialogInput[dialogId];
  List<ModelOption> get configuredModels => List.unmodifiable(_models);

  /// Commands and skills the bridge has published for the active host.
  ///
  /// M16-03 surfaces this list through a discoverable command palette
  /// (see `apps/mobile/lib/src/ui/shell/app_shell.dart`). The list is null
  /// before the first host handshake completes and stays an empty list
  /// while the bridge is reconnecting. The mobile UI uses null/empty to
  /// render a calm fallback that still explains the gap.
  List<SupportedCommandData>? get supportedCommands => null;

  /// Display name shown in the chat header and command palette. Falls
  /// back to the host endpoint when no display name has been published.
  String get displayName => hostDisplayName ?? '';
  SessionControlState? get selectedControls => selectedSessionId == null
      ? null
      : (_sessionControls[selectedSessionId!] ??
            SessionControlState.empty(selectedSessionId!));
  List<String> get rawEvents => List.unmodifiable(_rawEvents);
  Map<String, StreamViewState> get streams => Map.unmodifiable(_streams);

  SessionHistoryState historyFor(String sessionId) =>
      _history[sessionId] ?? SessionHistoryState.empty(sessionId);

  bool isHistorySyncing(String sessionId) {
    final state = historyFor(sessionId);
    return state.isLoading || state.hasOlder;
  }

  int historyEventCount(String sessionId) => historyFor(sessionId).items.length;

  ProcessDomainState get processes => _processes;
  GitState get git => _git;
  PlanState get plans => _plans;

  /// Sends a bounded `git.summary.request` for [workspaceId] and tracks the
  /// request ID so the matching `git.summary.result` (or stream `git.summary`)
  /// can be correlated. When the host advertised `git.v1`, this is the only
  /// path to a per-workspace Git/CI surface. When the service reports
  /// `git.unavailable`, the host emits the stream event directly and the
  /// response throws `unsupported_capability`; this method surfaces that as
  /// a thrown error so the UI can distinguish "host has no Git" from
  /// "workspace unreachable".
  Future<void> requestGitSummary(String workspaceId) async {
    final epoch = _connectionEpoch;
    final requestId = _id();
    _gitSummaryRequests[requestId] = _GitSummaryRequest(
      workspaceId: workspaceId,
      epoch: epoch,
    );
    _git = _git.copyWith(refreshing: true);
    notifyListeners();
    try {
      await _sendControl('git.summary.request', <String, Object?>{
        'workspaceId': workspaceId,
        'requestId': requestId,
      }, requestId: requestId);
    } catch (_) {
      _gitSummaryRequests.remove(requestId);
      _git = _git.copyWith(refreshing: false);
      notifyListeners();
      rethrow;
    }
  }

  /// R2 — Sends a bounded `plan.summary.request` for the session/turn pair
  /// and tracks the request ID so the matching `plan.snapshot.result` (or
  /// host-stream `plan.snapshot` / `plan.unavailable`) can be correlated.
  /// When the host advertised `plans.v1`, this is the only path to a
  /// structured plan surface. When the service truthfully reports
  /// `plan.unavailable`, the host emits the stream event directly and the
  /// response throws `unsupported_capability`; this method surfaces that
  /// as a thrown error so the UI can distinguish "host has no plans" from
  /// "session unreachable".
  Future<void> requestPlanSummary(String sessionId, String turnId) async {
    final epoch = _connectionEpoch;
    final requestId = _id();
    _planSummaryRequests[requestId] = _PlanSummaryRequest(
      sessionId: sessionId,
      turnId: turnId,
      epoch: epoch,
    );
    _plans = _plans.copyWith(refreshing: true);
    notifyListeners();
    try {
      await _sendControl('plan.summary.request', <String, Object?>{
        'sessionId': sessionId,
        'turnId': turnId,
        'requestId': requestId,
      }, requestId: requestId);
    } catch (_) {
      _planSummaryRequests.remove(requestId);
      _plans = _plans.copyWith(refreshing: false);
      notifyListeners();
      rethrow;
    }
  }

  /// R2 — Cancels the in-flight `plan.summary.request` identified by
  /// [requestId] by sending `plan.summary.cancel` with the tracked
  /// `targetRequestId`. No-op when no in-flight request exists.
  Future<void> cancelPlanSummary(String requestId) async {
    final tracked = _planSummaryRequests.remove(requestId);
    if (tracked == null) {
      _plans = _plans.copyWith(refreshing: false);
      notifyListeners();
      return;
    }
    try {
      await _sendControl('plan.summary.cancel', <String, Object?>{
        'targetRequestId': requestId,
      }, requestId: _id());
    } catch (_) { /* socket may be closed; nothing to do */ }
    _plans = _plans.copyWith(refreshing: false);
    notifyListeners();
  }

  /// Cancels the in-flight `git.summary.request` for [workspaceId] by sending
  /// `git.summary.cancel` with the tracked `targetRequestId`. No-op when no
  /// in-flight request exists for the workspace.
  Future<void> cancelGitSummary(String workspaceId) async {
    final entry = _gitSummaryRequests.entries
        .where((e) => e.value.workspaceId == workspaceId && e.value.epoch == _connectionEpoch)
        .toList();
    for (final e in entry) {
      _gitSummaryRequests.remove(e.key);
    }
    if (entry.isEmpty) {
      _git = _git.copyWith(refreshing: false);
      notifyListeners();
      return;
    }
    for (final e in entry) {
      try {
        await _sendControl('git.summary.cancel', <String, Object?>{
          'targetRequestId': e.key,
        }, requestId: _id());
      } catch (_) { /* socket may be closed; nothing to do */ }
    }
    _git = _git.copyWith(refreshing: false);
    notifyListeners();
  }

  Future<void> requestProcessSnapshot(String sessionId) async {
    final epoch = _connectionEpoch;
    final requestId = _id();
    // Register before write: a fast local socket may receive the response
    // before `_sendControl` completes.
    _processSnapshotRequests[requestId] = _ProcessSnapshotRequest(
      sessionId: sessionId,
      epoch: epoch,
    );
    try {
      await _sendControl('process.snapshot.request', <String, Object?>{
        'sessionId': sessionId,
      }, requestId: requestId);
    } catch (_) {
      _processSnapshotRequests.remove(requestId);
      rethrow;
    }
  }

  List<StreamEventState> transcriptEvents(String sessionId) {
    final history = _history[sessionId]?.items ?? const <StreamEventState>[];
    final live =
        _streams['session:$sessionId']?.events ?? const <StreamEventState>[];
    final cached = _transcriptEventsCache[sessionId];
    if (cached != null &&
        identical(cached.history, history) &&
        identical(cached.live, live)) {
      return cached.result;
    }
    final byId = <String, StreamEventState>{};
    for (final event in history) {
      byId[event.eventId] = event;
    }
    for (final event in live) {
      byId[event.eventId] = event;
    }
    final result = byId.values.where((event) {
      final family = event.type.split('.').first;
      if (!const <String>{
        'turn',
        'assistant',
        'reasoning',
        'tool',
      }.contains(family)) {
        return false;
      }
      // Reasoning and tool lifecycle records are part of the durable
      // conversation. Keep imported and locally-created activity so
      // session switches, reconnects, and app restarts reconstruct
      // the same transcript instead of silently dropping work.
      return true;
    }).toList()..sort((a, b) => a.cursor.compareTo(b.cursor));
    final immutable = List<StreamEventState>.unmodifiable(result);
    _transcriptEventsCache[sessionId] = _TranscriptEventsCache(
      history: history,
      live: live,
      result: immutable,
    );
    return immutable;
  }

  bool hasOlderHistory(String sessionId) {
    final state = _history[sessionId];
    return state == null || state.hasOlder;
  }

  Future<void> retryHistoryGate() async {
    if (!isReady) return;
    _historyGateComplete = false;
    _historyGateError = null;
    await _startHistoryGate();
  }

  Future<void> _startHistoryGate() async {
    if (!isReady || _historySyncCurrentSessionId != null) return;
    _historyGateError = null;
    final subscriptionsRepaired = _pruneInactiveSubscriptions();
    if (subscriptionsRepaired) await _persistSubscriptionSet();
    final activeIds = _activeChats
        .map((session) => session.sessionId)
        .toList(growable: false);
    _historySyncQueue
      ..clear()
      ..addAll(activeIds);
    _historySyncTotal = _historySyncQueue.length;
    _historySyncCompleted = 0;
    _historySyncLocalRevisions.clear();
    final selected = selectedSessionId;
    _deferredAutoSelectSessionId = selected != null && _isActiveChat(selected)
        ? selected
        : (activeIds.isEmpty ? null : activeIds.first);
    selectedSessionId = null;
    leaseId = null;
    if (activeIds.isEmpty) {
      _clearSelectedChatProjection();
    }
    _notify();
    await _syncNextHistorySession();
  }

  Future<void> _syncNextHistorySession() async {
    if (!isReady) return;
    while (_historySyncQueue.isNotEmpty &&
        !_isActiveChat(_historySyncQueue.first)) {
      _historySyncQueue.removeAt(0);
      if (_historySyncTotal > 0) _historySyncTotal -= 1;
    }
    if (_historySyncQueue.isEmpty) {
      _historySyncCurrentSessionId = null;
      _historyGateComplete = true;
      _historyGateError = null;
      final deferredSessionId = _deferredAutoSelectSessionId;
      _deferredAutoSelectSessionId = null;
      if (deferredSessionId != null && _isActiveChat(deferredSessionId)) {
        final creation = _sessionCreation;
        if (creation.isCreating &&
            _creationSelectingSessionId == deferredSessionId) {
          await _selectCreatedSession(creation.commandId!, deferredSessionId);
        } else {
          await selectPrimarySession(deferredSessionId);
        }
        return;
      }
      if (_activeChats.isEmpty) {
        _historySyncTotal = 0;
        _historySyncCompleted = 0;
        _subscriptionSet = SessionSubscriptionSet.empty();
        await _persistSubscriptionSet();
        _clearSelectedChatProjection();
        phase = ConnectionPhase.ready;
        errorMessage = null;
      }
      _notify();
      return;
    }
    final sessionId = _historySyncQueue.removeAt(0);
    _historySyncCurrentSessionId = sessionId;
    final cached = historyFor(sessionId);
    _historySyncLocalRevisions[sessionId] = hostId == null
        ? null
        : await _database.historySyncRevision(hostId!, sessionId);
    _history[sessionId] = cached.copyWith(
      snapshotRevision: null,
      nextPageToken: null,
      isLoading: false,
      error: null,
    );
    _notify();
    await loadOlderHistory(sessionId);
  }

  Future<void> loadOlderHistory(
    String sessionId, {
    int pageSize = kSessionHistoryPageSize,
  }) async {
    if (!isReady) return;
    if (pageSize < 1 || pageSize > kSessionHistoryPageSize) {
      throw RangeError.range(pageSize, 1, kSessionHistoryPageSize, 'pageSize');
    }
    final current = historyFor(sessionId);
    if (current.isLoading ||
        (current.snapshotRevision != null && !current.hasOlder)) {
      return;
    }
    _history[sessionId] = current.copyWith(isLoading: true, error: null);
    _notify();
    try {
      final requestId =
          await _sendControl('session.history.page', <String, Object?>{
            'sessionId': sessionId,
            'pageSize': pageSize,
            'pageToken': current.nextPageToken,
          });
      _historyRequests[requestId] = _HistoryRequest(
        sessionId: sessionId,
        epoch: _connectionEpoch,
      );
    } on Object catch (error) {
      _history[sessionId] = current.copyWith(
        isLoading: false,
        error: error.toString(),
      );
      _notify();
    }
  }

  Future<void> loadSessionControlData() async {
    final sessionId = selectedSessionId;
    if (!isReady || sessionId == null) return;
    await _ensureControllerForMutation(sessionId);
    await _sendCommand(
      type: 'session.activate',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId},
      requiresLease: true,
    );
    await requestModels();
  }

  Future<void> requestModels() {
    final pending = _modelListFuture;
    if (pending != null) return pending;

    final completer = Completer<void>();
    final requestId = _id();
    _modelListCompleter = completer;
    _modelListRequestId = requestId;
    final future = () async {
      try {
        await _sendControl('model.list', <String, Object?>{
          if (selectedSessionId != null) 'sessionId': selectedSessionId,
        }, requestId: requestId);
        await completer.future.timeout(
          const Duration(seconds: 8),
          onTimeout: () => throw TimeoutException(
            'Timed out waiting for the configured agent list.',
          ),
        );
      } finally {
        if (identical(_modelListCompleter, completer)) {
          _modelListCompleter = null;
          _modelListFuture = null;
          _modelListRequestId = null;
        }
      }
    }();
    _modelListFuture = future;
    return future;
  }

  Future<void> setModel(String modelId) {
    ModelOption? selected;
    for (final model in _models) {
      if (model.id == modelId) {
        selected = model;
        break;
      }
    }
    return _sendSessionControl('model.set', <String, Object?>{
      'modelId': modelId,
      if (selected?.provider != null) 'provider': selected!.provider,
    }, idleOnly: true);
  }

  Future<void> setThinking(String level) => _sendSessionControl(
    'thinking.set',
    <String, Object?>{'level': level},
    idleOnly: true,
  );
  Future<void> setAutoRetry(bool enabled) => _sendSessionControl(
    'retry.auto.set',
    <String, Object?>{'enabled': enabled},
  );
  Future<void> abortRetry() =>
      _sendSessionControl('retry.abort', const <String, Object?>{});
  Future<void> compactNow() =>
      _sendSessionControl('compaction.start', const <String, Object?>{});
  Future<void> setAutoCompaction(bool enabled) => _sendSessionControl(
    'compaction.auto.set',
    <String, Object?>{'enabled': enabled},
  );
  Future<void> setSteeringEnabled(bool enabled) => _sendSessionControl(
    'steering_mode.set',
    <String, Object?>{'enabled': enabled},
  );
  Future<void> setFollowUpEnabled(bool enabled) => _sendSessionControl(
    'follow_up_mode.set',
    <String, Object?>{'enabled': enabled},
  );

  Future<void> _sendSessionControl(
    String type,
    Map<String, Object?> values, {
    bool idleOnly = false,
  }) async {
    final sessionId = selectedSessionId;
    if (!isReady || sessionId == null || leaseId == null) {
      throw StateError('Controller and online session required');
    }
    if (idleOnly &&
        selectedRuntimeState != 'idle' &&
        selectedRuntimeState != 'stopped') {
      throw StateError('$type requires an idle session');
    }
    await _sendCommand(
      type: type,
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId, ...values},
      requiresLease: true,
    );
  }

  Future<void> initialize({bool autoConnect = true}) async {
    if (_initialized) return;
    _initialized = true;
    WidgetsBinding.instance.addObserver(this);
    installationId = await _database.installationIdentifier();

    final hosts = await _database.allHosts();
    if (hosts.isNotEmpty) {
      final host = hosts.reduce((a, b) {
        final aSeen = a.lastSeenAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        final bSeen = b.lastSeenAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        return aSeen.isAfter(bSeen) ? a : b;
      });
      endpoint = Uri.tryParse(host.endpoint);
      hostId = host.hostId;
      hostGeneration = host.generation;
      hostDisplayName = host.displayName;
      bridgeVersion = host.bridgeVersion;
      piVersion = host.piVersion;
      protocolVersion = host.protocolVersion ?? protocolVersion;
    }

    for (final session in await _database.allSessions()) {
      _sessions[session.sessionId] = _sessionFromEntry(session);
    }
    final currentHost = hostId;
    if (currentHost != null) {
      for (final node in await _database.sessionTreeNodes(currentHost)) {
        _sessionTree.upsert(node);
      }
    }
    final drafts = await _database.allDrafts();
    final hostDrafts = hostId == null
        ? const <DraftEntry>[]
        : drafts.where((entry) => entry.hostId == hostId).toList();
    final activeHostDrafts = hostDrafts
        .where((entry) => _isActiveChat(entry.sessionId))
        .toList(growable: false);
    for (final saved in activeHostDrafts) {
      _restorePendingPrompt(saved);
    }
    if (activeHostDrafts.isNotEmpty) {
      final saved = activeHostDrafts.reduce(
        (a, b) => a.updatedAt.isAfter(b.updatedAt) ? a : b,
      );
      selectedSessionId = saved.sessionId;
      _restoreDraft(saved);
    } else if (_activeChats.isNotEmpty && hostId != null) {
      selectedSessionId = _activeChats.first.sessionId;
    }

    if (hostId != null) await _loadCachedStreams(hostId!);
    _notify();
    if (autoConnect && endpoint != null && _foreground) {
      unawaited(connect(endpoint.toString()));
    }
  }

  Future<void> connect(String endpointText, {bool force = false}) async {
    if (!_foreground || _disposed) return;
    final normalized = normalizeHttpsEndpoint(endpointText);
    if (!force &&
        _socket != null &&
        connectionId != null &&
        endpoint == normalized &&
        const {
          ConnectionPhase.handshaking,
          ConnectionPhase.synchronizing,
          ConnectionPhase.ready,
        }.contains(phase)) {
      return;
    }
    final int epoch = ++_connectionEpoch;
    _cancelReconnect();
    await _closeSocket();
    leaseId = null;
    connectionId = null;
    errorMessage = null;
    // History requests are connection-epoch bound. Never carry a loading
    // latch or an HMAC page token across reconnects/bridge restarts.
    _historyRequests.clear();
    _processSnapshotRequests.clear();
    _gitSummaryRequests.clear();
    _git = _git.copyWith(refreshing: false);
    _planSummaryRequests.clear();
    _plans = _plans.copyWith(refreshing: false);
    _pendingCurrentRequestCommand.clear();
    if (!_historyGateComplete) {
      _historySyncCurrentSessionId = null;
      _historySyncQueue.clear();
      _historySyncLocalRevisions.clear();
    }
    for (final entry in _history.entries.toList()) {
      if (entry.value.isLoading) {
        _history[entry.key] = entry.value.copyWith(
          isLoading: false,
          snapshotRevision: null,
          nextPageToken: null,
        );
      }
    }
    _deferredAutoSelectSessionId = null;
    _failSessionCreation('The connection changed before the chat was created.');
    _hostReadinessRecoveryInFlight = false;

    try {
      endpoint = normalized;
      phase = ConnectionPhase.probing;
      _notify();
      final probe = await _transport.probe(endpoint!);
      if (epoch != _connectionEpoch || !_foreground) return;
      readiness = probe;
      if (!probe.ready) {
        phase = ConnectionPhase.hostUnreachable;
        errorMessage = _probeError(probe);
        _notify();
        _scheduleReconnect();
        return;
      }

      phase = ConnectionPhase.connecting;
      _notify();
      final socket = await _transport.connect(endpoint!);
      if (epoch != _connectionEpoch || !_foreground) {
        await socket.close();
        return;
      }
      _socket = socket;
      _socketSubscription = socket.messages.listen(
        (raw) {
          _messageTail = _messageTail
              .then((_) => _receive(raw, epoch))
              .catchError(
                (Object error, StackTrace stack) {
                  return _protocolFailure(error, epoch);
                },
              );
        },
        onError: (Object error, StackTrace stack) {
          _socketEnded(error, epoch);
        },
        onDone: () {
          _socketEnded(null, epoch);
        },
        cancelOnError: false,
      );
      phase = ConnectionPhase.handshaking;
      _notify();
      await socket.send(
        _envelope(
          'hello',
          <String, Object?>{
            if (hostId != null) 'expectedHostId': hostId,
            'mobileVersion': '0.0.0',
            'platform': 'mobile',
            'installationId': installationId,
            'requiredCapabilities': const [
              'streams.v1',
              'commands.v1',
              'controller_leases.v1',
            ],
            'optionalCapabilities': const <String>[],
          },
          requestId: _id(),
          includeConnection: false,
        ),
      );
    } on Object catch (error) {
      if (epoch != _connectionEpoch) return;
      phase = ConnectionPhase.hostUnreachable;
      errorMessage = error.toString();
      _notify();
      _scheduleReconnect();
    }
  }

  /// Connects and waits until the bridge has accepted hello and supplied its
  /// durable host identity. Manual pairing must not report success merely
  /// because the WebSocket hello frame was sent.
  Future<void> pairAndWait(
    String endpointText, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    await connect(endpointText);
    if (hostId != null) return;
    final completer = Completer<void>();
    _pairingCompleter = completer;
    late VoidCallback listener;
    listener = () {
      if (hostId != null && !completer.isCompleted) {
        completer.complete();
        return;
      }
      if (!completer.isCompleted &&
          const {
            ConnectionPhase.hostUnreachable,
            ConnectionPhase.incompatible,
            ConnectionPhase.hostDraining,
            ConnectionPhase.degraded,
          }.contains(phase)) {
        completer.completeError(
          StateError(errorMessage ?? 'Host pairing failed (${phase.name})'),
        );
      }
    };
    addListener(listener);
    listener();
    try {
      await completer.future.timeout(
        timeout,
        onTimeout: () => throw TimeoutException(
          'Host did not complete the pairing handshake within ${timeout.inSeconds} seconds',
        ),
      );
    } finally {
      if (identical(_pairingCompleter, completer)) {
        _pairingCompleter = null;
      }
      removeListener(listener);
    }
  }

  Future<void> retryConnection() async {
    final target = endpoint;
    if (target != null) await connect(target.toString(), force: true);
  }

  /// Forget the currently paired host and return to the unpaired state.
  ///
  /// Uses the existing durable APIs to clear cached host records, cursors,
  /// snapshots, normalized events, and session summaries for this host. Draft
  /// text is intentionally retained so a deliberate re-pair can be followed
  /// by the user resubmitting their pending work. The public connection is
  /// closed, the connection epoch is advanced, and the phase is forced to
  /// [ConnectionPhase.unpaired] regardless of the previous state.
  Future<void> forgetHost() async {
    final String? previousHostId = hostId;
    ++_connectionEpoch;
    _cancelReconnect();
    await _closeSocket();
    _ackTimer?.cancel();
    _ackTimer = null;
    _leaseTimer?.cancel();
    _leaseTimer = null;
    if (previousHostId != null) {
      await _database.resetHostCaches(previousHostId);
      await _database.deleteHost(previousHostId);
    }
    endpoint = null;
    readiness = null;
    connectionId = null;
    hostId = null;
    hostGeneration = null;
    hostDisplayName = null;
    bridgeVersion = null;
    piVersion = null;
    selectedWorkspaceId = null;
    selectedSessionId = null;
    leaseId = null;
    pendingCommandId = null;
    pendingPayload = null;
    pendingState = null;
    selectedDeliveryMode = DeliveryMode.immediate;
    errorMessage = null;
    _streams.clear();
    _sessions.clear();
    _locallyDeletedSessionIds.clear();
    _sessionControls.clear();
    _models.clear();
    _history.clear();
    _historyRequests.clear();
    _processSnapshotRequests.clear();
    _gitSummaryRequests.clear();
    _git = _git.copyWith(refreshing: false);
    _planSummaryRequests.clear();
    _plans = _plans.copyWith(refreshing: false);
    _historyGateComplete = false;
    _historySyncCurrentSessionId = null;
    _historySyncQueue.clear();
    _historySyncLocalRevisions.clear();
    _historyGateError = null;
    _subscriptionSet = SessionSubscriptionSet.empty();
    for (final sessionId in _controllers.sessions.toList()) {
      _controllers.drop(sessionId);
    }
    _pendingPromptsBySession.clear();
    _pendingCurrentRequestCommand.clear();
    _promptSendBySession.clear();
    _lastPromptCommandBySession.clear();
    _attention.clear();
    _attentionWire.clear();
    _unreadCount.clear();
    _workspaces.clear();
    _workspaceSearch = WorkspaceSearchState.idle();
    _workspaceSearchEpoch += 1;
    _workspaceTrustRequiredFor = null;
    _rawEvents.clear();
    _forceSnapshot.clear();
    _syncPending.clear();
    _deferredAutoSelectSessionId = null;
    _failSessionCreation('The host was forgotten before the chat was created.');
    phase = ConnectionPhase.unpaired;
    _notify();
  }

  Future<void> selectWorkspaceEntry(WorkspaceEntry workspace) async {
    final index = _workspaces.indexWhere(
      (item) => item.workspaceId == workspace.workspaceId,
    );
    if (index < 0) {
      _workspaces.add(workspace);
    } else {
      _workspaces[index] = workspace;
    }
    await selectWorkspace(workspace.workspaceId);
  }

  Future<void> selectWorkspace(String workspaceId) async {
    selectedWorkspaceId = workspaceId;
    _workspaceTrustRequiredFor = _needsApproval(_workspaces, workspaceId)
        ? workspaceId
        : null;
    _notify();
  }

  Future<void> createSession({
    String? name,
    String? modelId,
    String? provider,
  }) async {
    if (_sessionCreation.isCreating) {
      throw StateError('A chat is already being created.');
    }
    final workspace = selectedWorkspace;
    if (!isReady || workspace == null) {
      throw StateError(
        'Connect and choose a workspace before creating a chat.',
      );
    }
    final commandId = _id();
    final completion = Completer<void>();
    _sessionCreation = SessionCreationState.creating(
      commandId: commandId,
      workspaceId: workspace.workspaceId,
    );
    _sessionCreationCompleter = completion;
    _creationSelectingSessionId = null;
    errorMessage = null;
    _notify();
    try {
      await _sendCommand(
        type: 'session.create',
        commandId: commandId,
        payload: <String, Object?>{
          'workspaceId': workspace.workspaceId,
          'workspaceRelativePath': workspace.relativePath,
          'policyMode': 'full',
          'name': name != null && name.trim().isNotEmpty
              ? name.trim()
              : workspace.displayName,
          'modelId': ?modelId,
          'provider': ?provider,
        },
        requiresLease: false,
      );
    } on Object catch (error) {
      _failSessionCreation(
        _cleanError(error, 'Could not send the new chat request.'),
        commandId: commandId,
      );
    }
    if (_sessionCreation.commandId == commandId &&
        _sessionCreation.isCreating) {
      _sessionCreationTimer?.cancel();
      _sessionCreationTimer = Timer(const Duration(seconds: 20), () {
        _failSessionCreation(
          'Timed out waiting for the new chat.',
          commandId: commandId,
        );
      });
    }
    await completion.future;
  }

  void _clearSelectedChatProjection() {
    selectedSessionId = null;
    leaseId = null;
    draft = '';
    pendingCommandId = null;
    pendingPayload = null;
    pendingState = null;
    selectedDeliveryMode = DeliveryMode.immediate;
  }

  bool _pruneInactiveSubscriptions() {
    var next = _subscriptionSet;
    for (final item in _subscriptionSet.items) {
      if (!_isActiveChat(item.sessionId)) {
        next = next.remove(item.sessionId);
      }
    }
    if (identical(next, _subscriptionSet)) return false;
    _subscriptionSet = next;
    return true;
  }

  Future<void> _pruneSessionReferences(String sessionId) async {
    if (_isActiveChat(sessionId)) return;
    final removedSelection = selectedSessionId == sessionId;
    final removedDeferred = _deferredAutoSelectSessionId == sessionId;
    if (removedSelection) _clearSelectedChatProjection();
    if (removedDeferred) _deferredAutoSelectSessionId = null;

    final removedQueued = _historySyncQueue
        .where((id) => id == sessionId)
        .length;
    _historySyncQueue.removeWhere((id) => id == sessionId);
    final removedCurrent = _historySyncCurrentSessionId == sessionId;
    if (removedCurrent) _historySyncCurrentSessionId = null;
    final removedFromGate = removedQueued + (removedCurrent ? 1 : 0);
    if (removedFromGate > 0) {
      final reducedTotal = _historySyncTotal - removedFromGate;
      _historySyncTotal = reducedTotal < _historySyncCompleted
          ? _historySyncCompleted
          : reducedTotal;
    }
    _historyRequests.removeWhere(
      (_, request) => request.sessionId == sessionId,
    );
    _historySyncLocalRevisions.remove(sessionId);
    _history.remove(sessionId);
    _transcriptEventsCache.remove(sessionId);
    _streams.remove('session:$sessionId');
    _syncPending.remove('session:$sessionId');
    _forceSnapshot.remove('session:$sessionId');
    _controllers.drop(sessionId);

    final subscriptionChanged = _subscriptionSet.contains(sessionId);
    _subscriptionSet = _subscriptionSet.remove(sessionId);
    if (subscriptionChanged) await _persistSubscriptionSet();

    final activeChats = _activeChats;
    final replacement = activeChats.isEmpty ? null : activeChats.first;
    if (!_historyGateComplete) {
      if ((removedSelection || removedDeferred) && replacement != null) {
        _deferredAutoSelectSessionId = replacement.sessionId;
      }
      _notify();
      if (removedCurrent || _historySyncQueue.isEmpty) {
        await _syncNextHistorySession();
      }
      return;
    }
    if ((removedSelection || removedDeferred) && replacement != null) {
      await selectPrimarySession(replacement.sessionId);
      return;
    }
    if (_activeChats.isEmpty) {
      _clearSelectedChatProjection();
      _deferredAutoSelectSessionId = null;
      _historySyncCurrentSessionId = null;
      _historySyncQueue.clear();
      _historySyncTotal = 0;
      _historySyncCompleted = 0;
      _historyGateComplete = true;
    }
    _notify();
    if (subscriptionChanged && _socket != null && connectionId != null) {
      await _pushSubscriptions();
    }
  }

  void _failSessionCreation(String message, {String? commandId}) {
    final creation = _sessionCreation;
    if (!creation.isCreating ||
        (commandId != null && creation.commandId != commandId)) {
      return;
    }
    _sessionCreationTimer?.cancel();
    _sessionCreationTimer = null;
    _creationSelectingSessionId = null;
    _sessionCreation = SessionCreationState.failed(
      commandId: creation.commandId!,
      workspaceId: creation.workspaceId!,
      error: message,
    );
    final completer = _sessionCreationCompleter;
    _sessionCreationCompleter = null;
    if (completer != null && !completer.isCompleted) {
      completer.completeError(StateError(message));
    }
    _notify();
  }

  Future<void> _selectCreatedSession(String commandId, String sessionId) async {
    final creation = _sessionCreation;
    if (!creation.isCreating || creation.commandId != commandId) return;
    try {
      await selectPrimarySession(sessionId);
      if (!_sessionCreation.isCreating ||
          _sessionCreation.commandId != commandId) {
        return;
      }
      if (selectedSessionId != sessionId || !_isActiveChat(sessionId)) {
        throw StateError('The new chat could not be selected.');
      }
      _sessionCreationTimer?.cancel();
      _sessionCreationTimer = null;
      _sessionCreation = SessionCreationState.created(
        commandId: commandId,
        workspaceId: creation.workspaceId!,
        sessionId: sessionId,
      );
      _creationSelectingSessionId = null;
      final completer = _sessionCreationCompleter;
      _sessionCreationCompleter = null;
      if (completer != null && !completer.isCompleted) completer.complete();
      _notify();
    } on Object catch (error) {
      _failSessionCreation(
        _cleanError(error, 'The new chat could not be selected.'),
        commandId: commandId,
      );
    }
  }

  SessionTreeProjection get sessionTree => _sessionTree;

  Future<void> renameSession(String sessionId, String name) async {
    await _ensureControllerForMutation(sessionId);
    await _sendSessionLifecycle('session.rename', sessionId, <String, Object?>{
      'name': name.trim(),
    });
  }

  Future<void> forkSession(String sessionId, String entryId) =>
      _sendSessionLifecycle('session.fork', sessionId, <String, Object?>{
        'entryId': entryId,
      });
  Future<void> cloneSession(String sessionId) =>
      _sendSessionLifecycle('session.clone', sessionId);

  Future<void> requestSessionExport() async {
    final sessionId = selectedSessionId;
    if (sessionId == null) return;
    await _ensureControllerForMutation(sessionId);
    latestExportState = 'pending';
    _notify();
    await _sendSessionLifecycle(
      'session.export',
      sessionId,
      const <String, Object?>{'format': 'html'},
    );
  }

  Future<String> downloadLatestExport() async {
    final origin = endpoint;
    final exportId = latestExportId;
    if (origin == null ||
        exportId == null ||
        latestExportState != 'completed') {
      throw StateError('No completed export is available');
    }
    return PrivateBinaryTransport().downloadExport(
      hostOrigin: origin,
      exportId: exportId,
    );
  }

  Future<void> deleteSession(String sessionId) async {
    // Hide immediately, but keep the current selection intact until the wire
    // send succeeds so a transport failure can roll back without losing its
    // draft. Once sent, prune the deleted stream from the subscription set;
    // deleting the last chat must leave a healthy host-only subscription.
    final wasSelected = selectedSessionId == sessionId;
    _locallyDeletedSessionIds.add(sessionId);
    _notify();
    try {
      await _sendSessionLifecycle(
        'session.delete',
        sessionId,
        const <String, Object?>{'abortActive': true, 'cancelQueued': true},
        false,
      );
    } on Object {
      _locallyDeletedSessionIds.remove(sessionId);
      _notify();
      rethrow;
    }

    _subscriptionSet = _subscriptionSet.remove(sessionId);
    await _persistSubscriptionSet();
    if (wasSelected) {
      final replacements = sessions;
      if (replacements.isNotEmpty) {
        await selectPrimarySession(replacements.first.sessionId);
        return;
      }
      selectedSessionId = null;
      leaseId = null;
      draft = '';
      pendingCommandId = null;
      pendingPayload = null;
      pendingState = null;
      selectedDeliveryMode = DeliveryMode.immediate;
    }
    errorMessage = null;
    _notify();
    await _pushSubscriptions();
  }

  Future<void> restoreSession(String sessionId) =>
      _sendSessionLifecycle('session.restore', sessionId);
  Future<void> purgeSession(String sessionId, {required bool confirmed}) {
    if (!confirmed) {
      throw StateError('Permanent delete requires explicit confirmation');
    }
    return _sendSessionLifecycle('session.purge', sessionId);
  }

  Future<void> _ensureControllerForMutation(String sessionId) async {
    if (sessionId.isEmpty) throw ArgumentError.value(sessionId, 'sessionId');
    if (!isReady) throw StateError('Host is not ready');
    if (selectedSessionId == sessionId && leaseId != null) return;

    final waiter = _controllerWaiters.putIfAbsent(
      sessionId,
      Completer<void>.new,
    );
    try {
      await takeControl(sessionId);
      if (selectedSessionId == sessionId && leaseId != null) {
        if (!waiter.isCompleted) waiter.complete();
      }
      await waiter.future.timeout(
        const Duration(seconds: 15),
        onTimeout: () => throw StateError(
          'Could not acquire control of this chat. Select it and try again.',
        ),
      );
    } finally {
      if (identical(_controllerWaiters[sessionId], waiter)) {
        _controllerWaiters.remove(sessionId);
      }
    }
  }

  Future<void> _sendSessionLifecycle(
    String type,
    String sessionId, [
    Map<String, Object?> extra = const <String, Object?>{},
    bool requiresLease = true,
  ]) async {
    if (sessionId.isEmpty) throw ArgumentError.value(sessionId, 'sessionId');
    await _sendCommand(
      type: type,
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId, ...extra},
      requiresLease: requiresLease,
    );
  }

  /// Issues a bounded-depth directory-name search against the host. The result
  /// is cancellable: any in-flight request becomes a no-op the moment a newer
  /// search starts or [cancelWorkspaceSearch] is called.
  Future<void> searchWorkspaces(String query) async {
    final trimmed = query.trim();
    final epoch = ++_workspaceSearchEpoch;
    if (trimmed.isEmpty) {
      _workspaceSearch = WorkspaceSearchState.idle();
      _notify();
      return;
    }
    _workspaceSearch = _workspaceSearch.copyWith(
      query: trimmed,
      phase: WorkspaceSearchPhase.searching,
      hits: const <WorkspaceSearchHit>[],
      clearError: true,
    );
    _notify();
    if (!isReady) {
      _workspaceSearch = _workspaceSearch.copyWith(
        phase: WorkspaceSearchPhase.error,
        error: 'Offline. Reconnect to search workspaces.',
      );
      _notify();
      return;
    }
    try {
      await _sendControl('workspace.search', <String, Object?>{
        'query': trimmed,
      });
    } on Object catch (error) {
      if (epoch != _workspaceSearchEpoch) return;
      _workspaceSearch = _workspaceSearch.copyWith(
        phase: WorkspaceSearchPhase.error,
        error: error.toString(),
      );
      _notify();
    }
  }

  /// Cancels any pending workspace search. Safe to call multiple times.
  void cancelWorkspaceSearch() {
    _workspaceSearchEpoch += 1;
    if (_workspaceSearch.phase == WorkspaceSearchPhase.searching) {
      _workspaceSearch = _workspaceSearch.copyWith(
        phase: WorkspaceSearchPhase.cancelled,
      );
      _notify();
    }
  }

  /// Sends `workspace.trust.approve` for the given workspace. The host will
  /// return a `workspace.trust_state` event after the new fingerprint is
  /// recorded, which then flips the entry to approved.
  Future<void> approveWorkspaceTrust(String workspaceId) async {
    final entry = _workspaces.firstWhere(
      (w) => w.workspaceId == workspaceId,
      orElse: () => _missingWorkspace,
    );
    if (entry == _missingWorkspace) return;
    if (!isReady) {
      errorMessage = 'Cannot approve trust while offline.';
      _notify();
      return;
    }
    await _sendCommand(
      type: 'workspace.trust.approve',
      commandId: _id(),
      payload: <String, Object?>{
        'workspaceId': workspaceId,
        'fingerprint': entry.fingerprint,
      },
      requiresLease: false,
    );
    // The durable host-stream event remains authoritative. Also refresh the
    // advertised workspace list on the same ordered socket so the root trust
    // banner clears even if a live event was delayed while the app transitioned.
    await _sendControl('workspace.list', const <String, Object?>{});
  }

  /// Sends `session.policy.set` to demote the active session to Read-only.
  /// Read-only is a product guardrail enforced through Pi tool hooks. It is
  /// not an OS sandbox and never claims to be one in the UI.
  Future<void> setSessionPolicy(SessionPolicyMode mode) async {
    final sessionId = selectedSessionId;
    if (sessionId == null) return;
    if (!isReady) {
      errorMessage = 'Cannot change policy while offline.';
      _notify();
      return;
    }
    await _sendCommand(
      type: 'session.policy.set',
      commandId: _id(),
      payload: <String, Object?>{
        'sessionId': sessionId,
        'policyMode': sessionPolicyModeWire(mode),
      },
      requiresLease: true,
    );
  }

  /// Test-only helper: seeds the workspace list from a synthetic server
  /// payload without going through the wire. The production code path uses
  /// [_workspaceList] (driven by `workspace.list.result`).
  @visibleForTesting
  void debugSeedWorkspaces(List<Map<String, Object?>> items) {
    _workspaces
      ..clear()
      ..addAll(
        items.whereType<Map>().map(
          (raw) => _decodeWorkspaceEntry(Map<String, Object?>.from(raw)),
        ),
      );
    if (_workspaces.isNotEmpty &&
        !_workspaces.any((item) => item.workspaceId == selectedWorkspaceId)) {
      selectedWorkspaceId = _workspaces.first.workspaceId;
    }
    _workspaceTrustRequiredFor =
        _needsApproval(_workspaces, selectedWorkspaceId)
        ? selectedWorkspaceId
        : null;
    _notify();
  }

  /// Test-only helper: selects a workspace id and recomputes the
  /// trust-required flag without driving a UI tap.
  @visibleForTesting
  void debugSelectWorkspace(String workspaceId) {
    selectedWorkspaceId = workspaceId;
    _workspaceTrustRequiredFor = _needsApproval(_workspaces, workspaceId)
        ? workspaceId
        : null;
    _notify();
  }

  Future<void> selectSession(String sessionId) async {
    if (!_historyGateComplete || !_isActiveChat(sessionId)) return;
    if (selectedSessionId == sessionId && isReady) return;
    selectedSessionId = sessionId;
    leaseId = null;
    final saved = hostId == null
        ? null
        : await _database.draft(hostId!, sessionId);
    if (saved == null) {
      if (!_carryDraftAfterGeneration) {
        draft = '';
        selectedDeliveryMode = DeliveryMode.immediate;
      }
      pendingCommandId = null;
      pendingPayload = null;
      pendingState = null;
      _promptSendBySession.putIfAbsent(sessionId, PromptSendStatus.ready);
      // No saved draft for this host/session pair; clear any stale
      // in-memory attachment list so the next composer edit starts clean.
      _attachmentsBySession.remove(sessionId);
      if (_carryDraftAfterGeneration) {
        _carryDraftAfterGeneration = false;
        await _persistDraft();
      }
    } else {
      _restorePendingPrompt(saved);
      _restoreDraft(saved);
      final stored = await _database.localAttachmentsFor(
        hostId: hostId!,
        sessionId: sessionId,
      );
      _attachmentsBySession[sessionId] = List<AttachmentRef>.of(stored);
    }
    _notify();
    if (_socket != null && connectionId != null) await _subscribe();
  }

  Future<void> updateDraft(String value) async {
    draft = value;
    _notify();
    await _persistDraft();
  }

  /// User-facing send path. One explicit tap creates and persists one frozen
  /// command intent before controller acquisition or any prompt wire write.
  /// Recovery always resumes that same command id and semantic payload.
  Future<PromptSendStatus> submitPromptWithRecovery() async {
    if (!canAttemptSend) {
      return _failPromptBeforeIntent(
        composerDisabledReason ?? 'Sending is unavailable right now.',
      );
    }
    final prompt = await _preparePromptIntent();
    final sessionId = prompt.sessionId;
    _sendRecoveryInFlight = true;
    errorMessage = null;
    _notify();
    try {
      if (leaseId == null) {
        prompt.state = 'acquiring_control';
        _setPromptStatus(
          sessionId,
          const PromptSendStatus(phase: PromptSendPhase.acquiringControl),
        );
        await _persistSelectedPrompt(prompt);
        await _ensureControllerForMutation(sessionId);
      }
      if (selectedSessionId != sessionId) {
        throw StateError('The selected chat changed before Send completed.');
      }
      if (leaseId == null) {
        throw StateError('Could not acquire control of this chat.');
      }
      await _sendPreparedPrompt(prompt);
    } on Object catch (error) {
      await _markPromptFailure(
        prompt,
        code: isReady ? 'control_unavailable' : 'disconnected',
        message: isReady
            ? _cleanError(error, 'Could not acquire control of this chat.')
            : 'The bridge disconnected before control was acquired.',
        action: isReady
            ? PromptFailureAction.takeControl
            : PromptFailureAction.reconnect,
      );
    } finally {
      _sendRecoveryInFlight = false;
      _notify();
    }
    return _promptSendBySession[sessionId] ?? const PromptSendStatus.ready();
  }

  /// Controlled-session entry point retained for tests and non-composer
  /// callers. Unlike the former implementation it never silently returns.
  Future<PromptSendStatus> submitPrompt() async {
    if (!canSend) {
      return _failPromptBeforeIntent(
        composerDisabledReason ?? 'Sending is unavailable right now.',
      );
    }
    final prompt = await _preparePromptIntent();
    await _sendPreparedPrompt(prompt);
    return _promptSendBySession[prompt.sessionId] ??
        const PromptSendStatus.ready();
  }

  Future<_PendingPrompt> _preparePromptIntent() async {
    final sessionId = selectedSessionId!;
    final commandId = _id();
    final payload = Map<String, Object?>.unmodifiable(<String, Object?>{
      'sessionId': sessionId,
      'deliveryMode': deliveryModeWire(_effectiveDeliveryMode),
      'message': draft,
      'attachmentIds': _activeReadyAttachmentIds(),
    });
    final prompt = _PendingPrompt(
      sessionId: sessionId,
      commandId: commandId,
      payload: payload,
      state: leaseId == null ? 'acquiring_control' : 'created',
    );
    _pendingPromptsBySession[sessionId] = prompt;
    _lastPromptCommandBySession[sessionId] = commandId;
    _projectSelectedPrompt(prompt);
    _setPromptStatus(
      sessionId,
      PromptSendStatus(
        phase: leaseId == null
            ? PromptSendPhase.acquiringControl
            : PromptSendPhase.submitting,
      ),
    );
    // Durability barrier: command id and exact payload exist on disk before
    // controller acquisition and before prompt.submit can reach the socket.
    await _persistDraft();
    _notify();
    return prompt;
  }

  Future<void> _sendPreparedPrompt(_PendingPrompt prompt) async {
    if (!_isCurrentPrompt(prompt)) return;
    if (selectedSessionId != prompt.sessionId || leaseId == null || !isReady) {
      await _markPromptFailure(
        prompt,
        code: !isReady ? 'disconnected' : 'controller_required',
        message: !isReady
            ? 'The bridge disconnected before the message was sent.'
            : 'Could not acquire control of this chat.',
        action: !isReady
            ? PromptFailureAction.reconnect
            : PromptFailureAction.takeControl,
      );
      return;
    }
    prompt.state = 'submitting';
    _projectSelectedPrompt(prompt);
    _setPromptStatus(
      prompt.sessionId,
      const PromptSendStatus(phase: PromptSendPhase.submitting),
    );
    await _persistSelectedPrompt(prompt);
    try {
      await _sendCommand(
        type: 'prompt.submit',
        commandId: prompt.commandId,
        payload: Map<String, Object?>.from(prompt.payload),
        requiresLease: true,
      );
      if (_pendingPromptsBySession[prompt.sessionId]?.commandId ==
          prompt.commandId) {
        prompt.state = 'sent';
        _projectSelectedPrompt(prompt);
        await _persistSelectedPrompt(prompt);
        _notify();
      }
    } on Object catch (error) {
      // A response can accept this command while the socket write future is
      // still unwinding. Never let that stale continuation overwrite a newer
      // prompt for the same session.
      if (!_isCurrentPrompt(prompt)) return;
      // A socket write failure cannot prove whether the bridge durably saw the
      // command. Preserve the frozen intent and never resend automatically.
      prompt.state = 'indeterminate';
      _projectSelectedPrompt(prompt);
      _setPromptStatus(
        prompt.sessionId,
        PromptSendStatus(
          phase: PromptSendPhase.indeterminate,
          failure: PromptSendFailure(
            code: 'completion_uncertain',
            message:
                'The connection changed while sending. Check status before '
                'trying anything again.',
            action: PromptFailureAction.discardUncertain,
          ),
        ),
      );
      await _persistSelectedPrompt(prompt);
      errorMessage = _cleanError(error, 'Connection changed while sending.');
      _notify();
    }
  }

  /// Explicit retry of the same persisted command id and byte-equivalent
  /// payload. Reconnect itself only calls command.current and never invokes
  /// this method.
  Future<PromptSendStatus> retryPending() async {
    final sessionId = selectedSessionId;
    final prompt = sessionId == null
        ? null
        : _pendingPromptsBySession[sessionId];
    if (prompt == null) {
      return _failPromptBeforeIntent('There is no message available to retry.');
    }
    if (!isReady) {
      await _markPromptFailure(
        prompt,
        code: 'disconnected',
        message: 'Reconnect to the bridge before retrying.',
        action: PromptFailureAction.reconnect,
      );
      return promptSendStatus;
    }
    _sendRecoveryInFlight = true;
    try {
      if (leaseId == null) {
        prompt.state = 'acquiring_control';
        _setPromptStatus(
          sessionId!,
          const PromptSendStatus(phase: PromptSendPhase.acquiringControl),
        );
        await _persistSelectedPrompt(prompt);
        await _ensureControllerForMutation(sessionId);
      }
      await _sendPreparedPrompt(prompt);
    } on Object catch (error) {
      await _markPromptFailure(
        prompt,
        code: isReady ? 'control_unavailable' : 'disconnected',
        message: isReady
            ? _cleanError(error, 'Could not acquire control of this chat.')
            : 'The bridge disconnected before control was acquired.',
        action: isReady
            ? PromptFailureAction.takeControl
            : PromptFailureAction.reconnect,
      );
    } finally {
      _sendRecoveryInFlight = false;
      _notify();
    }
    return promptSendStatus;
  }

  Future<void> reconnectForPrompt() async {
    final target = endpoint;
    if (target == null) return;
    await connect(target.toString(), force: true);
  }

  PromptSendStatus _failPromptBeforeIntent(String message) {
    final sessionId = selectedSessionId;
    final action = requiresTrustApproval
        ? PromptFailureAction.approveWorkspace
        : !isReady
        ? PromptFailureAction.reconnect
        : leaseId == null
        ? PromptFailureAction.takeControl
        : PromptFailureAction.retry;
    final status = PromptSendStatus(
      phase: PromptSendPhase.failed,
      failure: PromptSendFailure(
        code: 'send_unavailable',
        message: message,
        action: action,
      ),
    );
    if (sessionId != null) _promptSendBySession[sessionId] = status;
    _notify();
    return status;
  }

  void _setPromptStatus(String sessionId, PromptSendStatus status) {
    _promptSendBySession[sessionId] = status;
    _notify();
  }

  bool _isCurrentPrompt(_PendingPrompt prompt) =>
      _pendingPromptsBySession[prompt.sessionId]?.commandId == prompt.commandId;

  void _projectSelectedPrompt(_PendingPrompt prompt) {
    if (selectedSessionId != prompt.sessionId || !_isCurrentPrompt(prompt)) {
      return;
    }
    pendingCommandId = prompt.commandId;
    pendingPayload = prompt.payload;
    pendingState = prompt.state;
  }

  Future<void> _markPromptFailure(
    _PendingPrompt prompt, {
    required String code,
    required String message,
    required PromptFailureAction action,
  }) async {
    if (!_isCurrentPrompt(prompt)) return;
    prompt.state = code;
    _projectSelectedPrompt(prompt);
    _setPromptStatus(
      prompt.sessionId,
      PromptSendStatus(
        phase: code == 'indeterminate'
            ? PromptSendPhase.indeterminate
            : PromptSendPhase.failed,
        failure: PromptSendFailure(
          code: code,
          message: message,
          action: action,
        ),
      ),
    );
    await _persistSelectedPrompt(prompt);
    _notify();
  }

  Future<void> _persistSelectedPrompt(_PendingPrompt prompt) async {
    if (_disposed || !_isCurrentPrompt(prompt)) return;
    if (selectedSessionId == prompt.sessionId) {
      _projectSelectedPrompt(prompt);
      await _persistDraft();
      return;
    }
    final currentHost = hostId;
    if (currentHost == null) return;
    final saved = await _database.draft(currentHost, prompt.sessionId);
    if (_disposed || !_isCurrentPrompt(prompt) || saved == null) return;
    if (saved.pendingCommandId != null &&
        saved.pendingCommandId != prompt.commandId) {
      return;
    }
    await _database.saveDraft(
      hostId: currentHost,
      sessionId: prompt.sessionId,
      text: saved.draftText,
      pendingCommandId: prompt.commandId,
      pendingPayloadJson: jsonEncode(prompt.payload),
      pendingState: prompt.state,
      selectedDeliveryMode:
          deliveryModeFromWire(saved.selectedDeliveryMode) ??
          DeliveryMode.immediate,
      updatedAt: _now(),
      localAttachmentRefsJson: _decodeAttachmentIds(
        saved.localAttachmentRefsJson,
      ),
    );
  }

  static List<String> _decodeAttachmentIds(String encoded) {
    try {
      final decoded = jsonDecode(encoded);
      return decoded is List
          ? decoded.whereType<String>().toList(growable: false)
          : const <String>[];
    } on FormatException {
      return const <String>[];
    }
  }

  static String _cleanError(Object error, String fallback) {
    final text = error.toString().replaceFirst(RegExp(r'^StateError:\s*'), '');
    return text.trim().isEmpty ? fallback : text;
  }

  static PromptSendFailure _promptFailureFromBridge(
    String code,
    String? fallback,
  ) => switch (code) {
    'controller_conflict' => const PromptSendFailure(
      code: 'controller_conflict',
      message: 'Another controller still owns this chat.',
      action: PromptFailureAction.takeControl,
    ),
    'controller_required' || 'stale_controller' => PromptSendFailure(
      code: code,
      message: 'Control of this chat was lost before the message was accepted.',
      action: PromptFailureAction.takeControl,
    ),
    'workspace_trust_required' || 'workspace_not_allowed' => PromptSendFailure(
      code: code,
      message: 'Approve workspace trust before sending this message.',
      action: PromptFailureAction.approveWorkspace,
    ),
    'host_not_ready' ||
    'host_draining' ||
    'session_not_found' => PromptSendFailure(
      code: code,
      message: 'The selected chat is not available for messages right now.',
      action: PromptFailureAction.retry,
    ),
    'database_unavailable' || 'storage_full' => PromptSendFailure(
      code: code,
      message: 'The bridge could not durably accept this message.',
      action: PromptFailureAction.reconnect,
    ),
    _ => PromptSendFailure(
      code: code,
      message: fallback?.trim().isNotEmpty == true
          ? fallback!.trim()
          : 'The bridge rejected this message.',
      action: PromptFailureAction.retry,
    ),
  };

  /// Explicitly abandons local retry tracking for an uncertain prompt and
  /// restarts the Pi session without resending that prompt. The submitted
  /// draft is cleared so a duplicate cannot be sent accidentally.
  Future<void> discardIndeterminateAndContinue() async {
    if (pendingState != 'indeterminate' &&
        selectedRuntimeState != 'indeterminate') {
      return;
    }
    final submittedText = pendingPayload?['message'];
    if (draft == submittedText || pendingState == 'indeterminate') draft = '';
    final sessionId = selectedSessionId;
    if (sessionId != null) {
      _pendingPromptsBySession.remove(sessionId);
      _promptSendBySession[sessionId] = const PromptSendStatus.ready();
    }
    pendingCommandId = null;
    pendingPayload = null;
    pendingState = null;
    selectedDeliveryMode = DeliveryMode.immediate;
    await _persistDraft();
    _notify();
    await retrySession();
  }

  Future<void> retrySession() async {
    if (!canRetrySession) return;
    await _sendCommand(
      type: 'session.activate',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': selectedSessionId!},
      requiresLease: true,
    );
  }

  Future<void> abort() async {
    if (!canAbort) return;
    await _sendCommand(
      type: 'turn.abort',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': selectedSessionId!},
      requiresLease: true,
    );
  }

  Future<void> registerNotificationDevice({
    required String deviceId,
    required String platform,
    required String token,
    required String appVersion,
  }) async {
    await _sendCommand(
      type: 'notification.device.register',
      commandId: _id(),
      payload: <String, Object?>{
        'deviceId': deviceId,
        'installationId': installationId,
        'platform': platform,
        'token': token,
        'appVersion': appVersion,
      },
      requiresLease: false,
    );
  }

  Future<void> unregisterNotificationDevice(String deviceId) async {
    await _sendCommand(
      type: 'notification.device.unregister',
      commandId: _id(),
      payload: <String, Object?>{'deviceId': deviceId},
      requiresLease: false,
    );
  }

  Future<void> removeFollowUp(String queueItemId) async {
    final sessionId = selectedSessionId;
    if (sessionId == null) return;
    await _sendCommand(
      type: 'queue.remove',
      commandId: _id(),
      payload: <String, Object?>{
        'sessionId': sessionId,
        'queueItemId': queueItemId,
      },
      requiresLease: true,
    );
  }

  Future<void> clearFollowUps() async {
    final sessionId = selectedSessionId;
    if (sessionId == null) return;
    await _sendCommand(
      type: 'queue.clear',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId},
      requiresLease: true,
    );
  }

  Future<void> respondToDialog({
    required String dialogId,
    String? value,
    bool? confirmed,
    bool cancelled = false,
  }) async {
    final sessionId = selectedSessionId;
    final dialog = selectedDialog;
    if (sessionId == null || dialog == null || dialog.dialogId != dialogId) {
      return;
    }
    if (dialog.isExpired(_now())) {
      if (value != null) _expiredDialogInput[dialogId] = value;
      _notify();
      return;
    }
    final response = <String, Object?>{
      if (cancelled) 'cancelled': true,
      if (!cancelled && value != null) 'value': value,
      if (!cancelled && confirmed != null) 'confirmed': confirmed,
    };
    await _sendCommand(
      type: 'extension.respond',
      commandId: _id(),
      payload: <String, Object?>{
        'sessionId': sessionId,
        'dialogId': dialogId,
        'response': response,
      },
      requiresLease: true,
    );
    _dialogsBySession.remove(sessionId);
    _notify();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _foreground = true;
      if (_socket == null && endpoint != null) {
        unawaited(connect(endpoint.toString()));
      }
      return;
    }
    _foreground = false;
    // Inactive/hidden/paused are normal transient mobile states (system
    // sheets, notification shade, image picker, app switch). Keep the socket
    // and controller lease alive; the OS will close it if the process is
    // suspended, and resume reconnects only when that actually happened.
    if (state == AppLifecycleState.detached) {
      ++_connectionEpoch;
      _cancelReconnect();
      unawaited(_closeSocket());
      connectionId = null;
      leaseId = null;
      phase = ConnectionPhase.background;
      _notify();
    }
  }

  Future<void> _receive(String raw, int epoch) async {
    if (epoch != _connectionEpoch || _disposed) return;
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      throw const FormatException('Bridge message is not an object');
    }
    final message = Map<String, Object?>.from(decoded);
    // Reuse the executable protocol contract for correlated responses and
    // journal events. Unsolicited sync/snapshot frames intentionally omit a
    // requestId on the M4 wire and are validated by their handlers below.
    if (message['requestId'] != null || message['eventId'] != null) {
      ProtocolEnvelope.fromJson(message);
    }
    final type = message['type'];
    final payloadValue = message['payload'];
    if (type is! String || payloadValue is! Map) {
      throw const FormatException('Bridge message has an invalid envelope');
    }
    final payload = Map<String, Object?>.from(payloadValue);
    _appendRaw(message);

    // Every durable event must advance its stream cursor before any
    // type-specific projection runs. Handling selected event types directly
    // here used to skip their cursors, so the next sync completed with an
    // apparent gap and incorrectly marked the connection incompatible.
    if (message['eventId'] is String &&
        message['streamId'] is String &&
        message['cursor'] is String) {
      await _journalEvent(message, type, payload);
      // The durable host-stream events for the Git/CI surface must apply
      // their projection BEFORE the cursor advance notifies subscribers,
      // otherwise the UI sees an out-of-order summary then unavailable.
      if (type == 'git.summary' || type == 'git.unavailable') {
        _applyGitStreamEvent(type, payload);
      }
      // R2 — both plan.unavailable (host stream capability envelope) and
      // plan.snapshot (session stream authoritative projection) must apply
      // before the cursor advance notifies subscribers so the UI sees an
      // ordered plan projection rather than out-of-order transitions.
      if (type == 'plan.unavailable' || type == 'plan.snapshot') {
        _applyPlanStreamEvent(type, payload);
      }
      _notify();
      return;
    }

    switch (type) {
      case 'hello.accepted':
        await _helloAccepted(payload);
      case 'subscription.accepted':
        _subscriptionAccepted(payload);
      case 'stream.snapshot.begin':
        _snapshotBegin(payload);
      case 'stream.snapshot.part':
        _snapshotPart(payload);
      case 'stream.snapshot.end':
        await _snapshotEnd(payload);
      case 'stream.sync.complete':
        await _syncComplete(payload);
      case 'workspace.list.result':
        _workspaceList(payload);
      case 'workspace.search.result':
        _workspaceSearchResult(_workspaceSearchEpoch, payload);
      case 'model.list.result':
        _modelListResult(message, payload);
      case 'session.history.page.result':
        await _sessionHistoryPageResult(message, payload);
      case 'process.snapshot.result':
        _processSnapshotResult(message, payload);
      case 'git.summary.result':
        _gitSummaryResult(message, payload);
      case 'plan.snapshot.result':
        _planSnapshotResult(message, payload);
      case 'workspace.trust_state':
        _workspaceTrustStateEvent(payload);
      case 'command.current.result':
        await _commandCurrent(payload);
      case 'command.receipt':
        await _commandReceipt(message, payload);
      case 'error':
        await _serverError(message, payload);
      case 'host.state':
        if (payload['ready'] == false) {
          errorMessage = 'Host reported not ready';
        }
      case 'session.state':
        _mergeSession(payload);
      default:
        break;
    }
    _notify();
  }

  Future<void> _helloAccepted(Map<String, Object?> payload) async {
    final newConnectionId = payload['connectionId'];
    final newHostId = payload['hostId'];
    final newGeneration = payload['hostGeneration'];
    if (newConnectionId is! String ||
        newHostId is! String ||
        newGeneration is! String) {
      throw const FormatException('Incomplete hello.accepted');
    }

    final generationChanged =
        hostId == newHostId &&
        hostGeneration != null &&
        hostGeneration != newGeneration;
    if (hostId != null && hostId != newHostId) {
      throw StateError('Connected host identity changed');
    }
    hostId = newHostId;
    connectionId = newConnectionId;
    hostGeneration = newGeneration;
    if (_pairingCompleter case final pairing? when !pairing.isCompleted) {
      pairing.complete();
    }
    hostDisplayName = payload['hostDisplayName'] as String?;
    bridgeVersion = payload['bridgeVersion'] as String?;
    piVersion = payload['piVersion'] as String?;
    if (generationChanged) {
      await _database.resetHostCaches(newHostId);
      await _database.quarantinePendingCommands(newHostId);
      _carryDraftAfterGeneration = draft.isNotEmpty;
      selectedSessionId = null;
      pendingCommandId = null;
      pendingPayload = null;
      pendingState = _carryDraftAfterGeneration ? 'generation_changed' : null;
      leaseId = null;
      // Carry the explicit composer mode with the draft; default back to
      // immediate only when there is no draft worth carrying forward.
      if (!_carryDraftAfterGeneration) {
        selectedDeliveryMode = DeliveryMode.immediate;
      }
      _streams.clear();
      _sessions.clear();
      _locallyDeletedSessionIds.clear();
      _sessionControls.clear();
      _models.clear();
      _pendingPromptsBySession.clear();
      _pendingCurrentRequestCommand.clear();
      _promptSendBySession.clear();
      _lastPromptCommandBySession.clear();
      _history.clear();
      _historyRequests.clear();
      _historyGateComplete = false;
      _historySyncCurrentSessionId = null;
      _historySyncQueue.clear();
      _historySyncLocalRevisions.clear();
      _rawEvents.clear();
      _forceSnapshot.add('host:$newHostId');
    } else {
      await _loadCachedStreams(newHostId);
    }
    if (!_historyGateComplete) {
      // Initial connection is deliberately host-only. Session streams can
      // contain very large imported replays; history is fetched through the
      // bounded pager before a chat becomes selectable.
      final selected = selectedSessionId;
      if (selected != null && _isActiveChat(selected)) {
        _deferredAutoSelectSessionId ??= selected;
      }
      selectedSessionId = null;
      leaseId = null;
    }
    await _database.upsertHost(
      HostEntriesCompanion.insert(
        hostId: newHostId,
        endpoint: endpoint.toString(),
        displayName: hostDisplayName ?? newHostId,
        generation: newGeneration,
        connectionState: 'connected',
        bridgeVersion: Value(bridgeVersion),
        piVersion: Value(piVersion),
        protocolVersion: Value(protocolVersion),
        capabilitiesJson: jsonEncode(payload['capabilities'] ?? const []),
        lastSeenAt: Value(_now()),
      ),
    );
    await _subscribe();
  }

  Future<void> _subscribe() async {
    if (_socket == null || connectionId == null || hostId == null) return;
    var repaired = _pruneInactiveSubscriptions();
    final selected = selectedSessionId;
    if (selected != null && !_isActiveChat(selected)) {
      _clearSelectedChatProjection();
    } else if (_historyGateComplete &&
        selected != null &&
        !_subscriptionSet.isFull(selected)) {
      _subscriptionSet = _subscriptionSet.setFull(
        sessionId: selected,
        cursor: _cursorForSession(selected),
      );
      repaired = true;
    }
    final deferred = _deferredAutoSelectSessionId;
    if (deferred != null && !_isActiveChat(deferred)) {
      _deferredAutoSelectSessionId = null;
    }
    if (repaired) await _persistSubscriptionSet();
    final desired = <({String streamId, String detail})>[
      (streamId: 'host:$hostId', detail: 'full'),
      if (_historyGateComplete)
        for (final item in _subscriptionSet.items)
          (
            streamId: item.streamId,
            detail: item.detail == SubscriptionDetail.full ? 'full' : 'summary',
          ),
    ];
    _syncPending
      ..clear()
      ..addAll(desired.map((item) => item.streamId));
    phase = ConnectionPhase.synchronizing;
    final streams = <Map<String, Object?>>[];
    for (final item in desired) {
      final cursor =
          _streams[item.streamId]?.lastContiguousCursor.value ??
          await _database.cursor(item.streamId);
      streams.add(<String, Object?>{
        'streamId': item.streamId,
        'detail': item.detail,
        if (!_forceSnapshot.remove(item.streamId) && cursor != null)
          'afterCursor': cursor,
      });
    }
    _notify();
    await _sendControl('subscription.set', <String, Object?>{
      'streams': streams,
    });
  }

  void _subscriptionAccepted(Map<String, Object?> payload) {
    final accepted = (payload['streams'] as List? ?? const <Object?>[])
        .whereType<Map>()
        .map((item) => item['streamId'])
        .whereType<String>()
        .toSet();
    _syncPending.removeWhere((streamId) => !accepted.contains(streamId));
  }

  void _snapshotBegin(Map<String, Object?> payload) {
    final snapshotId = payload['snapshotId'] as String;
    final streamId = payload['streamId'] as String;
    final assembler = SnapshotAssembler();
    assembler.begin(
      snapshotId: snapshotId,
      streamId: streamId,
      baselineCursor: StreamCursor.parse(payload['baselineCursor'] as String),
    );
    _snapshots[snapshotId] = assembler;
    _snapshotStreams[snapshotId] = streamId;
  }

  void _snapshotPart(Map<String, Object?> payload) {
    final snapshotId = payload['snapshotId'] as String;
    final itemsValue = payload['items'];
    if (itemsValue is! List) {
      throw const FormatException('Snapshot items missing');
    }
    final items = itemsValue
        .map((item) => Map<String, Object?>.from(item as Map))
        .toList(growable: false);
    final assembler = _snapshots[snapshotId];
    if (assembler == null) throw StateError('Snapshot part without begin');
    assembler.addPart(
      snapshotId: snapshotId,
      part: payload['part'] as int,
      items: items,
    );
  }

  Future<void> _snapshotEnd(Map<String, Object?> payload) async {
    final snapshotId = payload['snapshotId'] as String;
    final assembler = _snapshots.remove(snapshotId);
    final streamId = _snapshotStreams.remove(snapshotId);
    if (assembler == null || streamId == null) {
      throw StateError('Snapshot end without begin');
    }
    final raw = assembler.finish(
      snapshotId: snapshotId,
      partCount: payload['partCount'] as int,
    );
    final snapshot = _decodeSnapshot(raw);
    final previous = _streams[streamId] ?? StreamViewState.initial(streamId);
    final replacement = _reducer.replaceWithSnapshot(previous, snapshot);
    await _database.replaceWithSnapshot(
      streamId: streamId,
      hostId: hostId!,
      baselineCursor: snapshot.baselineCursor.value,
      snapshotId: snapshot.snapshotId,
      payloadJson: jsonEncode(snapshot.items),
      receivedAt: _now(),
    );
    _streams[streamId] = replacement;
    _hydrateSnapshot(streamId, snapshot.items);
  }

  StreamSnapshot _decodeSnapshot(StreamSnapshot raw) {
    final chunks = raw.items.where((item) => item['json'] is String).toList()
      ..sort((a, b) => (a['index'] as int).compareTo(b['index'] as int));
    if (chunks.isEmpty) return raw;
    final decoded = jsonDecode(
      chunks.map((item) => item['json'] as String).join(),
    );
    final items = decoded is List
        ? decoded.whereType<Map>().map(
            (item) => Map<String, Object?>.from(item),
          )
        : decoded is Map
        ? <Map<String, Object?>>[Map<String, Object?>.from(decoded)]
        : const <Map<String, Object?>>[];
    return StreamSnapshot(
      snapshotId: raw.snapshotId,
      streamId: raw.streamId,
      baselineCursor: raw.baselineCursor,
      items: items,
    );
  }

  Future<void> _syncComplete(Map<String, Object?> payload) async {
    final streamId = payload['streamId'] as String;
    if (!_syncPending.contains(streamId)) return;
    final current = StreamCursor.parse(payload['currentCursor'] as String);
    final state = _streams[streamId] ?? StreamViewState.initial(streamId);
    if (state.lastContiguousCursor.compareTo(current) < 0) {
      throw StateError(
        'Stream $streamId completed with an unapplied cursor gap',
      );
    }
    _syncPending.remove(streamId);
    if (_syncPending.isEmpty) {
      final deferredSessionId = _deferredAutoSelectSessionId;
      if (_historyGateComplete &&
          deferredSessionId != null &&
          _isActiveChat(deferredSessionId) &&
          selectedSessionId != deferredSessionId) {
        _deferredAutoSelectSessionId = null;
        await selectPrimarySession(deferredSessionId);
        return;
      }
      _hostReadinessRecoveryInFlight = false;
      phase = ConnectionPhase.ready;
      errorMessage = null;
      _startAckTimer();
      await _sendControl('workspace.list', const <String, Object?>{});
      if (!_historyGateComplete) {
        unawaited(_startHistoryGate());
        return;
      }
      if (selectedSessionId != null) await _acquireController();
      await _reconcilePending();
    }
  }

  Future<void> _journalEvent(
    Map<String, Object?> wire,
    String type,
    Map<String, Object?> payload,
  ) async {
    final streamId = wire['streamId'] as String;
    final occurredAt =
        DateTime.tryParse(wire['sentAt'] as String? ?? '')?.toUtc() ?? _now();
    final event = StreamEventState(
      hostId: hostId!,
      streamId: streamId,
      cursor: StreamCursor.parse(wire['cursor'] as String),
      eventId: wire['eventId'] as String,
      type: type,
      payload: payload,
      occurredAt: occurredAt,
    );
    final current = _streams[streamId] ?? StreamViewState.initial(streamId);
    final reduction = _reducer.apply(current, event);
    switch (reduction.disposition) {
      case EventDisposition.applied:
        await _database.persistEvent(event);
        _streams[streamId] = reduction.state;
        _handleEventPayload(type, payload);
        _eventsSinceAck += 1;
        if (_eventsSinceAck >= 20) await _ackCursors();
      case EventDisposition.duplicate:
        break;
      case EventDisposition.gap:
        _streams[streamId] = StreamViewState(
          streamId: current.streamId,
          lastContiguousCursor: current.lastContiguousCursor,
          integrity: StreamIntegrity.healthy,
          events: current.events,
          snapshotItems: current.snapshotItems,
        );
        unawaited(_subscribe());
      case EventDisposition.conflict:
        _streams[streamId] = reduction.state;
        _forceSnapshot.add(streamId);
        unawaited(_subscribe());
      case EventDisposition.ignoredWhilePaused:
        break;
    }
  }

  void _handleEventPayload(String type, Map<String, Object?> payload) {
    if (type == 'host.state') {
      if (payload['ready'] == false) {
        errorMessage = 'Host reported not ready';
      }
    } else if (type == 'host.degraded') {
      phase = ConnectionPhase.degraded;
      errorMessage = payload['reason']?.toString() ?? 'Host degraded';
    } else if (type == 'host.draining') {
      phase = ConnectionPhase.hostDraining;
      errorMessage = 'Host is draining';
    } else if (type == 'model.state' ||
        type == 'context.state' ||
        type == 'retry.state' ||
        type == 'compaction.state') {
      final id = payload['sessionId'];
      if (id is String) {
        _sessionControls[id] =
            (_sessionControls[id] ?? SessionControlState.empty(id)).apply(
              type,
              payload,
            );
        if (type == 'model.state') {
          _mergeSession(<String, Object?>{
            ...payload,
            'modelSummary': payload['modelId'],
          });
        }
      }
    } else if (type == 'session.export') {
      final completion = payload['completion'];
      latestExportId = payload['exportId'] as String?;
      latestExportBytes = payload['bytes'] as int?;
      latestExportState = completion is Map
          ? completion['state']?.toString()
          : payload['state']?.toString();
    } else if (type == 'session.summary') {
      _mergeSession(payload);
      final id = payload['sessionId'];
      if (id is String) {
        final node = SessionTreeNode.fromWire(payload);
        _sessionTree.upsert(node);
        final currentHost = hostId;
        if (currentHost != null) {
          unawaited(
            _database.upsertSessionTreeNode(hostId: currentHost, node: node),
          );
        }
        final creation = _sessionCreation;
        if (!_historyGateComplete &&
            phase == ConnectionPhase.ready &&
            payload['change'] == 'added' &&
            _historySyncCurrentSessionId != id &&
            !_historySyncQueue.contains(id)) {
          _historySyncQueue.add(id);
          _historySyncTotal += 1;
        }
        final matchesCreation =
            creation.isCreating &&
            payload['change'] == 'added' &&
            payload['createdByCommandId'] == creation.commandId &&
            _isActiveChat(id);
        if (matchesCreation) {
          if (_creationSelectingSessionId == null) {
            _creationSelectingSessionId = id;
            if (_historyGateComplete) {
              unawaited(_selectCreatedSession(creation.commandId!, id));
            } else {
              _deferredAutoSelectSessionId = id;
            }
          }
        } else if (!creation.isCreating &&
            selectedSessionId == null &&
            _isActiveChat(id)) {
          if (phase == ConnectionPhase.synchronizing || !_historyGateComplete) {
            _deferredAutoSelectSessionId ??= id;
          } else {
            unawaited(selectPrimarySession(id));
          }
        } else if (!_isActiveChat(id)) {
          unawaited(_pruneSessionReferences(id));
        }
      }
    } else if (type == 'session.removed') {
      final id = payload['sessionId'];
      if (id is String) {
        _locallyDeletedSessionIds.add(id);
        if (payload['permanent'] == true) {
          _sessions.remove(id);
          _sessionTree.remove(id);
        } else {
          final existing = _sessionTree[id];
          final node = SessionTreeNode.fromWire(<String, Object?>{
            if (existing != null) ...existing.toWire(),
            ...payload,
            'sessionId': id,
            'lifecycleState': payload['deletionState'] ?? 'soft_deleted',
          });
          _sessionTree.upsert(node);
          final currentHost = hostId;
          if (currentHost != null) {
            unawaited(
              _database.upsertSessionTreeNode(hostId: currentHost, node: node),
            );
          }
        }
        unawaited(_pruneSessionReferences(id));
      }
    } else if (type == 'session.delete_failed') {
      final id = payload['sessionId'];
      if (id is String) {
        _locallyDeletedSessionIds.remove(id);
        final existing = _sessionTree[id];
        final node = SessionTreeNode.fromWire(<String, Object?>{
          if (existing != null) ...existing.toWire(),
          ...payload,
          'sessionId': id,
          'lifecycleState': 'delete_failed',
        });
        _sessionTree.upsert(node);
        final currentHost = hostId;
        if (currentHost != null) {
          unawaited(
            _database.upsertSessionTreeNode(hostId: currentHost, node: node),
          );
        }
      }
    } else if (type == 'session.restored') {
      final id = payload['sessionId'];
      if (id is String) {
        _locallyDeletedSessionIds.remove(id);
        final existing = _sessionTree[id];
        final node = SessionTreeNode.fromWire(<String, Object?>{
          if (existing != null) ...existing.toWire(),
          ...payload,
          'sessionId': id,
          'lifecycleState': 'active',
        });
        _sessionTree.upsert(node);
        final currentHost = hostId;
        if (currentHost != null) {
          unawaited(
            _database.upsertSessionTreeNode(hostId: currentHost, node: node),
          );
        }
      }
    } else if (type == 'workspace.trust_state') {
      _workspaceTrustStateEvent(payload);
    } else if (type == 'queue.snapshot' || type == 'turn.queued') {
      final id = payload['sessionId'];
      final items = payload['items'];
      if (id is String && items is List) {
        _followUpsBySession[id] = items
            .whereType<Map>()
            .map(
              (item) => FollowUpItem.fromWire(Map<String, Object?>.from(item)),
            )
            .toList(growable: false);
        _mergeSession(<String, Object?>{
          'sessionId': id,
          'queueCount': _followUpsBySession[id]!.length,
        });
      }
    } else if (type == 'extension.dialog') {
      final id = payload['sessionId'];
      if (id is String && payload['state'] != 'responded') {
        _dialogsBySession[id] = ExtensionDialogState.fromWire(payload);
      }
    } else if (type == 'extension.editor_prefill') {
      editorPrefill = payload['text']?.toString() ?? '';
      draft = editorPrefill!;
      unawaited(_persistDraft());
    } else if (type == 'extension.status') {
      extensionStatus = (payload['text'] ?? payload['status'])?.toString();
    } else if (type == 'extension.title') {
      extensionTitle = payload['title']?.toString();
    } else if (type == 'extension.widget') {
      extensionWidgetText =
          (payload['text'] ?? payload['content'] ?? payload['widget'])
              ?.toString();
    } else if (type == 'extension.notify') {
      latestExtensionNotice =
          (payload['message'] ?? payload['text'] ?? payload['title'])
              ?.toString();
    } else if (type == 'process.snapshot' ||
        type == 'process.output' ||
        type == 'process.output.page.result' ||
        type == 'process.unavailable' ||
        type == 'process.error') {
      _processes = reduceProcess(_processes, <String, Object?>{
        'type': type,
        'payload': payload,
      });
    } else if (type == 'git.summary' || type == 'git.unavailable') {
      _applyGitStreamEvent(type, payload);
    } else if (type == 'plan.snapshot' || type == 'plan.unavailable') {
      _applyPlanStreamEvent(type, payload);
    } else if (type == 'session.state' || type.startsWith('turn.')) {
      final eventSessionId = payload['sessionId'];
      final eventCommandId = payload['commandId'];
      if (eventSessionId is String) {
        final pending = _pendingPromptsBySession[eventSessionId];
        final expected =
            pending?.commandId ?? _lastPromptCommandBySession[eventSessionId];
        final eventMatchesPending =
            pending == null ||
            (eventCommandId is String && eventCommandId == pending.commandId);
        if (type == 'turn.started' &&
            eventMatchesPending &&
            (expected == null ||
                eventCommandId == null ||
                eventCommandId == expected)) {
          _promptSendBySession[eventSessionId] = const PromptSendStatus(
            phase: PromptSendPhase.running,
          );
        } else if ((type == 'turn.settled' || type == 'turn.aborted') &&
            pending == null) {
          _promptSendBySession[eventSessionId] = const PromptSendStatus.ready();
        } else if (type == 'turn.indeterminate' && eventMatchesPending) {
          _promptSendBySession[eventSessionId] = const PromptSendStatus(
            phase: PromptSendPhase.indeterminate,
            failure: PromptSendFailure(
              code: 'completion_uncertain',
              message: 'Pi stopped before completion could be confirmed.',
              action: PromptFailureAction.discardUncertain,
            ),
          );
        }
      }
      final runtimeState =
          type == 'turn.failed' &&
              (payload['errorCode'] == 'provider_interrupted' ||
                  payload['reason'] == 'provider_interrupted')
          ? 'provider_interrupted'
          : switch (type) {
              'turn.started' => 'running',
              'turn.waiting_for_input' => 'waiting_for_input',
              'turn.settled' || 'turn.aborted' => 'idle',
              'turn.failed' => 'failed',
              'turn.indeterminate' => 'indeterminate',
              _ => null,
            };
      _mergeSession(<String, Object?>{
        ...payload,
        'runtimeState': ?runtimeState,
      });
    } else if (type == 'controller.state') {
      adoptControllerEvent(payload);
      if (payload['sessionId'] == selectedSessionId &&
          payload['mode'] == 'controller') {
        _startLeaseRenewal();
      }
    } else if (type == 'session.attention' || type == 'session.background') {
      final id = payload['sessionId'];
      if (id is String) {
        final wire =
            payload['attentionState']?.toString() ??
            (type == 'session.background' ? 'background' : 'none');
        final state = sessionAttentionFromWire(wire);
        final count = payload['unreadCount'] is int
            ? payload['unreadCount'] as int
            : null;
        markAttention(sessionId: id, state: state, unreadCount: count);
      }
    } else if (type == 'command.state') {
      final state = payload['state'];
      if (payload['commandId'] == _sessionCreation.commandId &&
          state is String &&
          const {
            'failed',
            'rejected',
            'indeterminate',
            'cancelled',
          }.contains(state)) {
        _failSessionCreation(
          payload['message']?.toString() ??
              'The bridge could not create the chat.',
          commandId: _sessionCreation.commandId,
        );
      }
      final prompt = _pendingForCommand(payload['commandId']);
      if (prompt != null && state is String) {
        unawaited(_acceptPromptState(prompt, state));
      }
    }
  }

  void _mergeSession(Map<String, Object?> payload) {
    final id = payload['sessionId'];
    if (id is! String || hostId == null) return;
    final old = _sessions[id];
    final state = SessionState(
      sessionId: id,
      hostId: hostId!,
      workspaceId: payload['workspaceId'] as String? ?? old?.workspaceId,
      name: (payload['name'] as String?)?.trim().isNotEmpty == true
          ? (payload['name'] as String).trim()
          : old?.name.trim().isNotEmpty == true
          ? old!.name
          : '${payload['displayName'] as String? ?? 'Session'} #${id.substring(0, 6)}',
      runtimeState:
          payload['runtimeState'] as String? ?? old?.runtimeState ?? 'unknown',
      policyMode: payload['policyMode'] as String? ?? old?.policyMode,
      modelSummary: payload['modelSummary']?.toString() ?? old?.modelSummary,
      thinkingLevel: payload['thinkingLevel'] as String? ?? old?.thinkingLevel,
      queueCount: payload['queueCount'] as int? ?? old?.queueCount ?? 0,
      lastActivityAt:
          DateTime.tryParse(
            payload['lastActivityAt'] as String? ?? '',
          )?.toUtc() ??
          old?.lastActivityAt,
      unreadState: payload['attentionState'] as String? ?? old?.unreadState,
      controllerState:
          payload['controllerState'] as String? ?? old?.controllerState,
    );
    _sessions[id] = state;
    unawaited(_database.upsertSessionState(state));
  }

  void _failModelListRequest(String message) {
    final completer = _modelListCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.completeError(StateError(message));
    }
  }

  void _modelListResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) {
    final items = payload['items'];
    _models
      ..clear()
      ..addAll(
        items is List
            ? items
                  .whereType<Map>()
                  .map(
                    (item) =>
                        ModelOption.fromJson(Map<String, Object?>.from(item)),
                  )
                  .where((item) => item.id.isNotEmpty)
            : const <ModelOption>[],
      );
    final controls = selectedControls;
    if (controls?.modelId != null &&
        !_models.any((model) => model.id == controls!.modelId)) {
      final id = selectedSessionId!;
      _sessionControls[id] = controls!.apply('model.state', <String, Object?>{
        'modelUnavailable': true,
      });
    }
    final completer = _modelListCompleter;
    final responseRequestId = message['requestId'];
    if (completer != null &&
        !completer.isCompleted &&
        responseRequestId == _modelListRequestId) {
      completer.complete();
    }
  }

  Future<void> _sessionHistoryPageResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) async {
    final requestId = message['requestId'];
    if (requestId is! String) return;
    final request = _historyRequests.remove(requestId);
    if (request == null || request.epoch != _connectionEpoch) return;
    final existing = historyFor(request.sessionId);
    final items = payload['items'];
    final decoded = <StreamEventState>[];
    if (items is List) {
      for (final raw in items.whereType<Map>()) {
        final item = Map<String, Object?>.from(raw);
        final eventId = item['eventId'];
        final streamId = item['streamId'];
        final cursor = item['cursor'];
        final type = item['type'];
        final eventPayload = item['payload'];
        if (eventId is! String ||
            streamId != 'session:${request.sessionId}' ||
            cursor is! String ||
            type is! String ||
            eventPayload is! Map) {
          continue;
        }
        final createdAt = item['createdAt'];
        decoded.add(
          StreamEventState(
            hostId: hostId ?? '',
            streamId: streamId as String,
            cursor: StreamCursor.parse(cursor),
            eventId: eventId,
            type: type,
            payload: Map<String, Object?>.from(eventPayload),
            occurredAt: createdAt is int
                ? DateTime.fromMillisecondsSinceEpoch(createdAt, isUtc: true)
                : _now(),
          ),
        );
      }
    }
    for (final event in decoded) {
      if (const {
        'model.state',
        'context.state',
        'retry.state',
        'compaction.state',
      }.contains(event.type)) {
        _handleEventPayload(event.type, event.payload);
      }
    }
    final existingIds = existing.items.map((event) => event.eventId).toSet();
    final overlapsDurableCache = decoded.any(
      (event) => existingIds.contains(event.eventId),
    );
    await _database.insertHistoryEvents(decoded);
    final merged = <String, StreamEventState>{
      for (final event in existing.items) event.eventId: event,
      for (final event in decoded) event.eventId: event,
    }.values.toList()..sort((a, b) => a.cursor.compareTo(b.cursor));
    final responseRevision = payload['snapshotRevision'] is String
        ? payload['snapshotRevision'] as String
        : existing.snapshotRevision;
    final rawNextPageToken = payload['nextPageToken'] is String
        ? payload['nextPageToken'] as String
        : null;
    final localRevision = _historySyncLocalRevisions[request.sessionId];
    final alreadyFresh =
        localRevision != null &&
        localRevision == responseRevision &&
        existing.items.isNotEmpty;
    final reachedDurablePrefix = localRevision != null && overlapsDurableCache;
    final nextPageToken = alreadyFresh || reachedDurablePrefix
        ? null
        : rawNextPageToken;
    _history[request.sessionId] = existing.copyWith(
      items: merged,
      snapshotRevision: responseRevision,
      nextPageToken: nextPageToken,
      isLoading: false,
      error: null,
    );
    if (_historySyncCurrentSessionId == request.sessionId &&
        nextPageToken != null) {
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 150), () async {
          if (request.epoch == _connectionEpoch &&
              _historySyncCurrentSessionId == request.sessionId) {
            await loadOlderHistory(request.sessionId);
          }
        }),
      );
      return;
    }
    if (_historySyncCurrentSessionId == request.sessionId) {
      if (responseRevision != null && hostId != null) {
        await _database.advanceCursor(
          streamId: 'session:${request.sessionId}',
          hostId: hostId!,
          cursor: responseRevision,
        );
        await _database.saveHistorySyncRevision(
          hostId: hostId!,
          sessionId: request.sessionId,
          snapshotRevision: responseRevision,
        );
        _streams['session:${request.sessionId}'] = StreamViewState.initial(
          'session:${request.sessionId}',
          cursor: StreamCursor.parse(responseRevision),
        );
      }
      _historySyncCompleted += 1;
      _historySyncCurrentSessionId = null;
      _notify();
      unawaited(
        Future<void>.delayed(
          const Duration(milliseconds: 150),
          _syncNextHistorySession,
        ),
      );
    }
  }

  void _processSnapshotResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) {
    final requestId = message['requestId'];
    if (requestId is! String) return;
    final request = _processSnapshotRequests.remove(requestId);
    if (request == null || request.epoch != _connectionEpoch) return;
    _processes = reduceProcess(_processes, <String, Object?>{
      'type': 'process.snapshot.result',
      'payload': payload,
    }, requestedSessionId: request.sessionId);
  }

  /// Correlates `git.summary.result` by `requestId` and applies the closed
  /// GitSummary payload through `reduceGit`. Stale results from prior
  /// connection epochs are dropped so a delayed response cannot surface a
  /// stale Git/CI surface after reconnect.
  void _gitSummaryResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) {
    final requestId = message['requestId'];
    if (requestId is! String) return;
    final request = _gitSummaryRequests.remove(requestId);
    if (request == null || request.epoch != _connectionEpoch) return;
    _git = reduceGit(_git, 'git.summary.result', payload);
    notifyListeners();
  }

  /// R2 — Correlates `plan.snapshot.result` by request ID and applies the
  /// closed PlanSnapshot payload through `reducePlan`. Stale results from
  /// prior connection epochs are dropped so a delayed response cannot
  /// surface a stale plan after reconnect.
  void _planSnapshotResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) {
    final requestId = message['requestId'];
    if (requestId is! String) return;
    final request = _planSummaryRequests.remove(requestId);
    if (request == null || request.epoch != _connectionEpoch) return;
    _plans = reducePlan(_plans, 'plan.snapshot.result', payload);
    notifyListeners();
  }

  /// R2 — Applies the host-stream `plan.snapshot` (session stream) and
  /// `plan.unavailable` (host stream) events to the plan projection. The
  /// host emits these whenever the per-session plan surface changes; the
  /// coordinator reconciles them without requiring a new request tap.
  void _applyPlanStreamEvent(String type, Map<String, Object?> payload) {
    _plans = reducePlan(_plans, type, payload);
    notifyListeners();
  }

  /// Applies the host-stream `git.summary` and `git.unavailable` events to
  /// the Git projection. The host emits these whenever the per-workspace
  /// Git/CI surface changes; mobile reconciles them without requiring a
  /// new request tap.
  void _applyGitStreamEvent(String type, Map<String, Object?> payload) {
    final next = reduceGit(_git, type, payload);
    if (identical(next, _git)) return;
    _git = next;
    notifyListeners();
  }

  void _workspaceList(Map<String, Object?> payload) {
    final items = payload['items'];
    if (items is! List) return;
    final selected = selectedWorkspace;
    _workspaces
      ..clear()
      ..addAll(
        items.whereType<Map>().map(
          (raw) => _decodeWorkspaceEntry(Map<String, Object?>.from(raw)),
        ),
      );
    if (selected != null &&
        !_workspaces.any((item) => item.workspaceId == selected.workspaceId)) {
      _workspaces.add(selected);
    }
    final sessionWorkspaceId = selectedSessionId == null
        ? null
        : _sessions[selectedSessionId]?.workspaceId;
    if (sessionWorkspaceId != null &&
        _workspaces.any((item) => item.workspaceId == sessionWorkspaceId)) {
      selectedWorkspaceId = sessionWorkspaceId;
    } else if (_workspaces.isNotEmpty &&
        !_workspaces.any((item) => item.workspaceId == selectedWorkspaceId)) {
      selectedWorkspaceId = _workspaces.first.workspaceId;
    }
    _workspaceTrustRequiredFor =
        _needsApproval(_workspaces, selectedWorkspaceId)
        ? selectedWorkspaceId
        : null;
  }

  void _workspaceSearchResult(int epoch, Map<String, Object?> payload) {
    if (epoch != _workspaceSearchEpoch) {
      // A newer search has been issued; drop stale results so the UI never
      // surfaces an out-of-order hit list.
      return;
    }
    final items = payload['items'];
    if (items is! List) {
      _workspaceSearch = _workspaceSearch.copyWith(
        phase: WorkspaceSearchPhase.error,
        error: 'Malformed workspace search result',
      );
      _notify();
      return;
    }
    final hits = items
        .whereType<Map>()
        .map((raw) {
          final item = Map<String, Object?>.from(raw);
          return WorkspaceSearchHit(
            workspaceId: item['workspaceId'] as String,
            displayName: item['displayName'] as String? ?? 'Workspace',
            relativePath: item['relativePath'] as String? ?? '/',
            rootLabel: item['rootLabel'] as String? ?? '',
            availability: _parseAvailability(item['availability'] as String?),
            trustState: _parseTrustState(item['trustState'] as String?),
            fingerprint: item['fingerprint'] as String? ?? '',
            policyVersion: item['policyVersion'] as String? ?? '',
          );
        })
        .toList(growable: false);
    _workspaceSearch = _workspaceSearch.copyWith(
      phase: WorkspaceSearchPhase.results,
      hits: hits,
      clearError: true,
    );
    _notify();
  }

  void _workspaceTrustStateEvent(Map<String, Object?> payload) {
    final id = payload['workspaceId'] as String?;
    final state = _parseTrustState(payload['trustState'] as String?);
    final fingerprint = payload['fingerprint'] as String?;
    final policyVersion = payload['policyVersion'] as String?;
    if (id == null) return;
    final updated = <WorkspaceEntry>[];
    for (final w in _workspaces) {
      if (w.workspaceId != id) {
        updated.add(w);
        continue;
      }
      updated.add(
        WorkspaceEntry(
          workspaceId: w.workspaceId,
          displayName: w.displayName,
          rootLabel: w.rootLabel,
          relativePath: w.relativePath,
          repositoryMarker: w.repositoryMarker,
          lastUsedAt: w.lastUsedAt,
          availability: w.availability,
          trustState: state,
          fingerprint: fingerprint ?? w.fingerprint,
          policyVersion: policyVersion ?? w.policyVersion,
          manifest: w.manifest,
        ),
      );
    }
    _workspaces
      ..clear()
      ..addAll(updated);
    _workspaceTrustRequiredFor = _needsApproval(_workspaces, id) ? id : null;
    _notify();
  }

  WorkspaceEntry _decodeWorkspaceEntry(Map<String, Object?> item) {
    final manifestRaw = item['manifest'];
    final manifest = manifestRaw is List
        ? manifestRaw
              .whereType<Map>()
              .map((entry) {
                final asMap = Map<String, Object?>.from(entry);
                return WorkspaceResource(
                  relativePath: asMap['relativePath'] as String? ?? '',
                  kind: asMap['kind'] as String? ?? 'file',
                  sizeBytes: asMap['sizeBytes'] as int?,
                );
              })
              .toList(growable: false)
        : const <WorkspaceResource>[];
    return WorkspaceEntry(
      workspaceId: item['workspaceId'] as String,
      displayName: item['displayName'] as String? ?? 'Workspace',
      rootLabel: item['rootLabel'] as String? ?? '',
      relativePath: item['relativePath'] as String? ?? '/',
      repositoryMarker: item['repositoryMarker'] as String?,
      lastUsedAt: DateTime.tryParse(item['lastUsedAt'] as String? ?? ''),
      availability: _parseAvailability(item['availability'] as String?),
      trustState: _parseTrustState(item['trustState'] as String?),
      fingerprint: item['fingerprint'] as String? ?? '',
      policyVersion: item['policyVersion'] as String? ?? '',
      manifest: manifest,
    );
  }

  WorkspaceAvailability _parseAvailability(String? value) =>
      value == 'available'
      ? WorkspaceAvailability.available
      : WorkspaceAvailability.unavailable;

  WorkspaceTrustState _parseTrustState(String? value) => switch (value) {
    'approved' => WorkspaceTrustState.approved,
    'unapproved' => WorkspaceTrustState.unapproved,
    'fingerprint_changed' => WorkspaceTrustState.fingerprintChanged,
    _ => WorkspaceTrustState.unknown,
  };

  bool _needsApproval(List<WorkspaceEntry> entries, String? workspaceId) {
    if (workspaceId == null) return false;
    for (final w in entries) {
      if (w.workspaceId == workspaceId) {
        return w.availability != WorkspaceAvailability.available ||
            w.trustState != WorkspaceTrustState.approved;
      }
    }
    return true;
  }

  Future<void> _commandReceipt(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) async {
    final state = payload['state'];
    if (message['commandId'] == _sessionCreation.commandId &&
        state is String &&
        const {
          'failed',
          'rejected',
          'indeterminate',
          'cancelled',
        }.contains(state)) {
      _failSessionCreation(
        payload['message']?.toString() ??
            'The bridge could not create the chat.',
        commandId: _sessionCreation.commandId,
      );
      return;
    }
    final prompt = _pendingForCommand(message['commandId']);
    if (prompt != null && state is String) {
      await _acceptPromptState(prompt, state);
    }
  }

  Future<void> _commandCurrent(Map<String, Object?> payload) async {
    final prompt = _pendingForCommand(payload['commandId']);
    final state = payload['state'];
    if (prompt != null && state is String) {
      await _acceptPromptState(prompt, state);
    }
  }

  _PendingPrompt? _pendingForCommand(Object? commandId) {
    if (commandId is! String) return null;
    for (final prompt in _pendingPromptsBySession.values) {
      if (prompt.commandId == commandId) return prompt;
    }
    if (commandId == pendingCommandId &&
        selectedSessionId != null &&
        pendingPayload != null) {
      final current = _pendingPromptsBySession[selectedSessionId!];
      if (current != null && current.commandId != commandId) return null;
      final restored = _PendingPrompt(
        sessionId: selectedSessionId!,
        commandId: commandId,
        payload: Map<String, Object?>.unmodifiable(pendingPayload!),
        state: pendingState ?? 'unknown',
      );
      _pendingPromptsBySession[restored.sessionId] = restored;
      return restored;
    }
    return null;
  }

  Future<void> _acceptPromptState(_PendingPrompt prompt, String state) async {
    prompt.state = state;
    if (state == 'indeterminate') {
      _projectSelectedPrompt(prompt);
      _setPromptStatus(
        prompt.sessionId,
        const PromptSendStatus(
          phase: PromptSendPhase.indeterminate,
          failure: PromptSendFailure(
            code: 'completion_uncertain',
            message:
                'The bridge cannot confirm whether this message completed.',
            action: PromptFailureAction.discardUncertain,
          ),
        ),
      );
      await _persistSelectedPrompt(prompt);
      return;
    }
    if (!_acceptedOrLater.contains(state)) {
      _projectSelectedPrompt(prompt);
      _setPromptStatus(
        prompt.sessionId,
        const PromptSendStatus(phase: PromptSendPhase.submitting),
      );
      await _persistSelectedPrompt(prompt);
      return;
    }

    _pendingPromptsBySession.remove(prompt.sessionId);
    _lastPromptCommandBySession[prompt.sessionId] = prompt.commandId;
    _setPromptStatus(
      prompt.sessionId,
      PromptSendStatus(
        phase: state == 'running'
            ? PromptSendPhase.running
            : PromptSendPhase.accepted,
      ),
    );
    if (selectedSessionId == prompt.sessionId &&
        pendingCommandId == prompt.commandId) {
      final submittedText = prompt.payload['message'];
      if (draft == submittedText) draft = '';
      pendingCommandId = null;
      pendingPayload = null;
      pendingState = null;
      await _persistDraft();
    } else {
      await _clearAcceptedBackgroundPrompt(prompt);
    }
  }

  Future<void> _clearAcceptedBackgroundPrompt(_PendingPrompt prompt) async {
    final currentHost = hostId;
    if (currentHost == null) return;
    final saved = await _database.draft(currentHost, prompt.sessionId);
    if (saved == null || saved.pendingCommandId != prompt.commandId) return;
    await _database.saveDraft(
      hostId: currentHost,
      sessionId: prompt.sessionId,
      text: saved.draftText == prompt.payload['message'] ? '' : saved.draftText,
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      selectedDeliveryMode:
          deliveryModeFromWire(saved.selectedDeliveryMode) ??
          DeliveryMode.immediate,
      updatedAt: _now(),
      localAttachmentRefsJson: _decodeAttachmentIds(
        saved.localAttachmentRefsJson,
      ),
    );
  }

  Future<void> _serverError(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) async {
    final code = payload['code']?.toString() ?? 'unknown';
    final creationCommandId = message['commandId'];
    if (_sessionCreation.isCreating &&
        creationCommandId == _sessionCreation.commandId) {
      _failSessionCreation(
        payload['message']?.toString() ??
            'The bridge could not create the chat.',
        commandId: creationCommandId as String,
      );
      return;
    }
    final requestId = message['requestId'];
    final modelCompleter = _modelListCompleter;
    if (requestId is String &&
        requestId == _modelListRequestId &&
        modelCompleter != null &&
        !modelCompleter.isCompleted) {
      modelCompleter.completeError(
        StateError(
          '$code: ${payload['message'] ?? 'Could not load configured agents'}',
        ),
      );
      return;
    }
    if (requestId is String) _processSnapshotRequests.remove(requestId);
    final reconciledCommandId = requestId is String
        ? _pendingCurrentRequestCommand.remove(requestId)
        : null;
    final prompt = _pendingForCommand(
      message['commandId'] ?? reconciledCommandId,
    );
    final historyRequest = requestId is String
        ? _historyRequests.remove(requestId)
        : null;
    if (historyRequest != null) {
      final current = historyFor(historyRequest.sessionId);
      _history[historyRequest.sessionId] = current.copyWith(
        isLoading: false,
        error: '$code: ${payload['message'] ?? 'History sync failed'}',
      );
      // History is a repeatable read. A rate-limited page was rejected before
      // dispatch, so retrying its same opaque token cannot duplicate data.
      if (code == 'rate_limited' && historyRequest.epoch == _connectionEpoch) {
        errorMessage = null;
        unawaited(
          Future<void>.delayed(const Duration(milliseconds: 350), () async {
            if (historyRequest.epoch == _connectionEpoch &&
                _historySyncCurrentSessionId == historyRequest.sessionId) {
              await loadOlderHistory(historyRequest.sessionId);
            }
          }),
        );
      } else if (_historySyncCurrentSessionId == historyRequest.sessionId) {
        _historyGateError =
            '$code: ${payload['message'] ?? 'History sync failed'}';
        _historySyncCurrentSessionId = null;
      }
      _notify();
      return;
    }
    final shouldRecoverHostReadiness =
        code == 'host_not_ready' &&
        _syncPending.isEmpty &&
        !_hostReadinessRecoveryInFlight &&
        _socket != null &&
        connectionId != null;
    if (code == 'host_not_ready') {
      // This is a transient command-admission race, not evidence that the
      // connected host is degraded. Re-establish the subscription once; do
      // not resend the rejected user command.
      errorMessage = null;
    } else {
      errorMessage = '$code: ${payload['message'] ?? 'Bridge error'}';
    }
    phase = switch (code) {
      'unsupported_protocol' ||
      'unsupported_capability' ||
      'pi_version_mismatch' => ConnectionPhase.incompatible,
      'host_draining' => ConnectionPhase.hostDraining,
      'database_unavailable' ||
      'storage_full' ||
      'crash_loop' ||
      'provider_interrupted' => ConnectionPhase.degraded,
      'host_not_ready' =>
        _syncPending.isNotEmpty || shouldRecoverHostReadiness
            ? ConnectionPhase.synchronizing
            : phase,
      _ => phase,
    };
    if (shouldRecoverHostReadiness) {
      _hostReadinessRecoveryInFlight = true;
      unawaited(
        _subscribe().catchError((Object error, StackTrace stack) {
          _hostReadinessRecoveryInFlight = false;
          _socketEnded(error, _connectionEpoch);
        }),
      );
    }
    if ((code == 'crash_loop' || code == 'provider_interrupted') &&
        selectedSessionId != null) {
      _mergeSession(<String, Object?>{
        'sessionId': selectedSessionId,
        'runtimeState': code,
      });
    }
    if (code == 'workspace_trust_required' || code == 'workspace_not_allowed') {
      _workspaceTrustRequiredFor = selectedWorkspaceId;
    }
    if (code == 'stale_controller' || code == 'controller_required') {
      leaseId = null;
      _leaseTimer?.cancel();
    }
    if (code == 'controller_conflict' &&
        _sendRecoveryInFlight &&
        selectedSessionId != null) {
      // Send is the explicit user intent that permits one takeover attempt.
      // The prompt itself is already frozen, so a successful authoritative
      // controller event resumes exactly that command once.
      final sessionId = selectedSessionId!;
      final controller = _controllers.forSession(sessionId);
      if (!controller.takeoverPending) {
        errorMessage = null;
        try {
          await takeoverController(sessionId);
        } on Object catch (error) {
          final waiter = _controllerWaiters.remove(sessionId);
          if (waiter != null && !waiter.isCompleted) {
            waiter.completeError(error);
          }
        }
        return;
      }
      final waiter = _controllerWaiters.remove(sessionId);
      if (waiter != null && !waiter.isCompleted) {
        waiter.completeError(
          StateError('Another controller still owns this chat.'),
        );
      }
    }
    if (code == 'command_not_found' && prompt != null) {
      // command.current authoritatively proves this frozen command was never
      // accepted. Preserve the draft and expose an explicit retry; do not
      // create a replacement command id.
      await _markPromptFailure(
        prompt,
        code: code,
        message: 'The bridge did not accept this message. You can retry it.',
        action: PromptFailureAction.retry,
      );
      return;
    }
    if (prompt != null) {
      final failure = _promptFailureFromBridge(
        code,
        payload['message']?.toString(),
      );
      await _markPromptFailure(
        prompt,
        code: code,
        message: failure.message,
        action: failure.action,
      );
    }
  }

  Future<void> _acquireController() async {
    if (selectedSessionId == null || !isReady) return;
    await _sendCommand(
      type: 'controller.acquire',
      commandId: _id(),
      payload: <String, Object?>{
        'scope': 'session',
        'sessionId': selectedSessionId!,
      },
      requiresLease: false,
    );
  }

  void _startLeaseRenewal() {
    _leaseTimer?.cancel();
    if (leaseId == null || !isReady) return;
    final renewalEpoch = _connectionEpoch;
    _leaseTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      final currentLease = leaseId;
      if (isReady && currentLease != null) {
        unawaited(
          _sendControl('controller.renew', <String, Object?>{
            'leaseId': currentLease,
          }).catchError((Object error, StackTrace stack) {
            if (renewalEpoch == _connectionEpoch && currentLease == leaseId) {
              _socketEnded(error, renewalEpoch);
            }
            return '';
          }),
        );
      }
    });
  }

  Future<void> _reconcilePending() async {
    if (!isReady) return;
    // Deliberately read-only. Reconnect never calls retryPending and therefore
    // cannot duplicate a prompt whose completion is uncertain. Commands tied
    // to Trash entries stay durable but are not queried against a removed
    // stream.
    for (final prompt
        in _pendingPromptsBySession.values
            .where((prompt) => _isActiveChat(prompt.sessionId))
            .toList()) {
      final requestId = await _sendControl('command.current', <String, Object?>{
        'commandId': prompt.commandId,
      });
      _pendingCurrentRequestCommand[requestId] = prompt.commandId;
    }
  }

  Future<String> _sendControl(
    String type,
    Map<String, Object?> payload, {
    String? requestId,
  }) async {
    final socket = _socket;
    if (socket == null || connectionId == null) throw StateError('Offline');
    final resolvedRequestId = requestId ?? _id();
    await socket.send(_envelope(type, payload, requestId: resolvedRequestId));
    return resolvedRequestId;
  }

  Future<void> _sendCommand({
    required String type,
    required String commandId,
    required Map<String, Object?> payload,
    required bool requiresLease,
  }) async {
    final socket = _socket;
    if (socket == null || connectionId == null || !isReady) {
      throw StateError('Offline');
    }
    if (requiresLease && leaseId == null) {
      throw StateError('Controller lease required');
    }
    await socket.send(
      _envelope(
        type,
        payload,
        requestId: _id(),
        commandId: commandId,
        lease: requiresLease ? leaseId : null,
      ),
    );
  }

  Map<String, Object?> _envelope(
    String type,
    Map<String, Object?> payload, {
    required String requestId,
    String? commandId,
    String? lease,
    bool includeConnection = true,
  }) => <String, Object?>{
    'protocol': const <String, Object?>{'major': 1, 'minor': 0},
    'messageId': _id(),
    'requestId': requestId,
    if (includeConnection && connectionId != null) 'connectionId': connectionId,
    'commandId': ?commandId,
    'leaseId': ?lease,
    'type': type,
    'sentAt': DateTime.fromMillisecondsSinceEpoch(
      _now().toUtc().millisecondsSinceEpoch,
      isUtc: true,
    ).toIso8601String(),
    'payload': payload,
  };

  Future<void> _ackCursors() async {
    if (!isReady || _streams.isEmpty) return;
    _eventsSinceAck = 0;
    await _sendControl('cursor.ack', <String, Object?>{
      'cursors': <String, Object?>{
        for (final entry in _streams.entries)
          entry.key: entry.value.lastContiguousCursor.value,
      },
    });
  }

  void _startAckTimer() {
    _ackTimer?.cancel();
    _ackTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_eventsSinceAck > 0) unawaited(_ackCursors());
    });
  }

  Future<void> _persistDraft() async {
    final currentHost = hostId;
    final currentSession = selectedSessionId;
    if (_disposed || currentHost == null || currentSession == null) return;
    // Snapshot every field before the first await. A quick session switch must
    // not combine one chat's draft or pending command with another chat's key.
    final currentDraft = draft;
    final currentCommandId = pendingCommandId;
    final currentPayload = pendingPayload;
    final currentState = pendingState;
    final currentDeliveryMode = selectedDeliveryMode;
    final attachments = List<AttachmentRef>.of(
      _attachmentsBySession[currentSession] ?? const <AttachmentRef>[],
    );
    // Persist the in-memory attachment list to its dedicated table. The
    // M13 column on `draft_entries` is a denormalised mirror used only to
    // surface the count in the composer; the table is the source of truth.
    await _database.removeLocalAttachmentsForSession(
      hostId: currentHost,
      sessionId: currentSession,
    );
    if (_disposed) return;
    for (var i = 0; i < attachments.length; i++) {
      await _database.upsertLocalAttachment(
        hostId: currentHost,
        sessionId: currentSession,
        ref: attachments[i],
        orderIndex: i,
      );
      if (_disposed) return;
    }
    await _database.saveDraft(
      hostId: currentHost,
      sessionId: currentSession,
      text: currentDraft,
      pendingCommandId: currentCommandId,
      pendingPayloadJson: currentPayload == null
          ? null
          : jsonEncode(currentPayload),
      pendingState: currentState,
      selectedDeliveryMode: currentDeliveryMode,
      updatedAt: _now(),
      localAttachmentRefsJson: attachments
          .map((ref) => ref.id)
          .toList(growable: false),
    );
  }

  void _restorePendingPrompt(DraftEntry saved) {
    final commandId = saved.pendingCommandId;
    final encoded = saved.pendingPayloadJson;
    if (commandId == null || encoded == null) return;
    try {
      final decoded = jsonDecode(encoded);
      final prompt = _PendingPrompt(
        sessionId: saved.sessionId,
        commandId: commandId,
        payload: Map<String, Object?>.unmodifiable(
          Map<String, Object?>.from(decoded as Map),
        ),
        state: saved.pendingState ?? 'unknown',
      );
      _pendingPromptsBySession[saved.sessionId] = prompt;
      _lastPromptCommandBySession[saved.sessionId] = commandId;
      _promptSendBySession[saved.sessionId] = _statusForRestoredPrompt(prompt);
    } on Object {
      // A malformed local payload cannot be resent. Keep the draft text, but
      // do not hydrate an unsafe command intent.
    }
  }

  static PromptSendStatus _statusForRestoredPrompt(_PendingPrompt prompt) {
    return switch (prompt.state) {
      'indeterminate' ||
      'sent' ||
      'submitting' ||
      'retrying' => const PromptSendStatus(
        phase: PromptSendPhase.indeterminate,
        failure: PromptSendFailure(
          code: 'completion_uncertain',
          message: 'Checking whether the bridge accepted this message.',
          action: PromptFailureAction.discardUncertain,
        ),
      ),
      'acquiring_control' => const PromptSendStatus(
        phase: PromptSendPhase.failed,
        failure: PromptSendFailure(
          code: 'control_unavailable',
          message: 'Control was not acquired before the app stopped.',
          action: PromptFailureAction.takeControl,
        ),
      ),
      _ => PromptSendStatus(
        phase: PromptSendPhase.failed,
        failure: _promptFailureFromBridge(prompt.state, null),
      ),
    };
  }

  void _restoreDraft(DraftEntry saved) {
    draft = saved.draftText;
    pendingCommandId = saved.pendingCommandId;
    pendingState = saved.pendingState;
    selectedDeliveryMode =
        deliveryModeFromWire(saved.selectedDeliveryMode) ??
        DeliveryMode.immediate;
    final encoded = saved.pendingPayloadJson;
    if (encoded == null) {
      pendingPayload = null;
    } else {
      final decoded = jsonDecode(encoded);
      pendingPayload = Map<String, Object?>.unmodifiable(
        Map<String, Object?>.from(decoded as Map),
      );
    }
    // The dedicated `local_attachments` table holds the canonical list; the
    // mirror column is only used as a sanity hint and is intentionally not
    // re-hydrated from here.
  }

  /// Returns the IDs the wire payload should reference, in original draft
  /// order, restricted to entries that are `ready`. Failed, uploading,
  /// expired, replaced, and removed entries are never included.
  List<String> _activeReadyAttachmentIds() {
    final sessionId = selectedSessionId;
    if (sessionId == null) return const <String>[];
    final list = _attachmentsBySession[sessionId] ?? const <AttachmentRef>[];
    final out = <String>[];
    for (final ref in list) {
      if (ref.isReady) out.add(ref.id);
    }
    return List<String>.unmodifiable(out);
  }

  /// Public read-only view of the active draft's attachment list.
  List<AttachmentRef> get draftAttachments => List<AttachmentRef>.unmodifiable(
    _attachmentsBySession[selectedSessionId] ?? const <AttachmentRef>[],
  );

  /// IDs the wire payload would carry if the user submitted right now.
  List<String> get draftAttachmentIds => _activeReadyAttachmentIds();

  Future<void> pickAndUploadImage() async {
    final origin = endpoint;
    final sessionId = selectedSessionId;
    if (!isReady || origin == null || sessionId == null) {
      throw StateError('Connect and select a chat before attaching an image');
    }
    if (draftAttachments.length >= AttachmentLimits.maxCount) {
      throw StateError(
        'A draft supports at most ${AttachmentLimits.maxCount} images',
      );
    }
    final image = await ImageAttachmentPicker(
      PlatformImagePicker(),
    ).pickAndSanitize();
    if (image == null) return;
    final uploaded = await PrivateBinaryTransport().upload(
      hostOrigin: origin,
      installationId: await _database.installationIdentifier(),
      clientUploadId: _uuid.v4(),
      image: image,
      intendedSessionId: sessionId,
    );
    final ref = AttachmentRef(
      id: uploaded.attachmentId,
      kind: AttachmentKind.fromMimeType(uploaded.mimeType),
      filename: image.fileName,
      sizeBytes: uploaded.bytes,
      mimeType: uploaded.mimeType,
      status: AttachmentStatus.ready,
      createdAt: _now(),
      expiresAt: uploaded.expiresAt,
      sha256: uploaded.sha256,
      width: uploaded.width,
      height: uploaded.height,
    );
    final error = await addDraftAttachment(ref);
    if (error != null) throw StateError(error);
  }

  /// Admit a new draft attachment. Returns the rejection reason on failure
  /// (e.g. quota exceeded, duplicate id). On success the registry and the
  /// durable row are updated and the draft is re-persisted.
  Future<String?> addDraftAttachment(AttachmentRef ref) async {
    if (hostId == null || selectedSessionId == null) {
      return 'No active session';
    }
    final current =
        _attachmentsBySession[selectedSessionId!] ?? const <AttachmentRef>[];
    final registry = AttachmentRegistry(initial: current);
    final result = registry.add(ref);
    if (!result.isAccepted) return result.rejection;
    _attachmentsBySession[selectedSessionId!] = List<AttachmentRef>.of(
      result.registry.items,
    );
    _notify();
    await _persistDraft();
    return null;
  }

  /// Remove a draft attachment by ID. The host never sees the local path
  /// and the local bytes (when present) are not touched here — that is the
  /// picker's responsibility. The user is never auto-sent on remove.
  Future<void> removeDraftAttachment(String attachmentId) async {
    if (hostId == null || selectedSessionId == null) return;
    final current =
        _attachmentsBySession[selectedSessionId!] ?? const <AttachmentRef>[];
    final registry = AttachmentRegistry(initial: current).remove(attachmentId);
    _attachmentsBySession[selectedSessionId!] = List<AttachmentRef>.of(
      registry.items,
    );
    _notify();
    await _persistDraft();
  }

  /// Replace an existing draft attachment in place. Used when the picker
  /// re-emits the same file with different bytes (e.g. after re-encode).
  /// The new reference is validated against the same quota a fresh add
  /// would use.
  Future<String?> replaceDraftAttachment({
    required String oldId,
    required AttachmentRef incoming,
  }) async {
    if (hostId == null || selectedSessionId == null) {
      return 'No active session';
    }
    final current =
        _attachmentsBySession[selectedSessionId!] ?? const <AttachmentRef>[];
    final result = AttachmentRegistry(
      initial: current,
    ).replace(oldId: oldId, incoming: incoming);
    if (!result.isAccepted) return result.rejection;
    _attachmentsBySession[selectedSessionId!] = List<AttachmentRef>.of(
      result.registry.items,
    );
    _notify();
    await _persistDraft();
    return null;
  }

  /// Update the lifecycle status of a draft attachment. Bumps
  /// `uploadAttempt` when [bumpAttempt] is true. The coordinator never
  /// triggers an upload on its own; the future transport drives this.
  Future<void> markDraftAttachment(
    String attachmentId,
    AttachmentStatus status, {
    String? lastError,
    bool bumpAttempt = false,
  }) async {
    if (hostId == null || selectedSessionId == null) return;
    final current =
        _attachmentsBySession[selectedSessionId!] ?? const <AttachmentRef>[];
    final next = AttachmentRegistry(initial: current).markStatus(
      attachmentId,
      status,
      lastError: lastError,
      bumpAttempt: bumpAttempt,
    );
    _attachmentsBySession[selectedSessionId!] = List<AttachmentRef>.of(
      next.items,
    );
    _notify();
    await _persistDraft();
  }

  /// Sweep the active draft for stale references. Expired entries are
  /// dropped from the in-memory list and the durable table; the user is
  /// never auto-sent anything. Returns the IDs that were expired.
  Future<List<String>> expireStaleDraftAttachments({DateTime? now}) async {
    if (hostId == null || selectedSessionId == null) {
      return const <String>[];
    }
    final current =
        _attachmentsBySession[selectedSessionId!] ?? const <AttachmentRef>[];
    final cutoff = now ?? _now();
    final result = AttachmentRegistry(initial: current).expireStale(cutoff);
    if (result.expiredIds.isEmpty) return const <String>[];
    _attachmentsBySession[selectedSessionId!] = List<AttachmentRef>.of(
      result.registry.items,
    );
    _notify();
    await _persistDraft();
    return result.expiredIds;
  }

  Future<void> _loadCachedStreams(String forHost) async {
    if (_streams.keys.any((streamId) => streamId.startsWith('host:$forHost'))) {
      return;
    }

    for (final saved in await _database.snapshotsForHost(forHost)) {
      final decoded = jsonDecode(saved.payloadJson);
      final items = decoded is List
          ? decoded
                .whereType<Map>()
                .map((item) => Map<String, Object?>.from(item))
                .toList()
          : <Map<String, Object?>>[];
      _streams[saved.streamId] = StreamViewState(
        streamId: saved.streamId,
        lastContiguousCursor: StreamCursor.parse(saved.baselineCursor),
        integrity: StreamIntegrity.healthy,
        events: const [],
        snapshotItems: items,
      );
      _hydrateSnapshot(saved.streamId, items);
    }

    final cursorByStream = <String, String>{
      for (final cursor in await _database.cursorsForHost(forHost))
        cursor.streamId: cursor.lastContiguousCursor,
    };
    final cachedHistory = <String, List<StreamEventState>>{};
    for (final event in await _database.eventsForHost(forHost)) {
      final payload = Map<String, Object?>.from(
        jsonDecode(event.payloadJson) as Map,
      );
      final wire = <String, Object?>{
        'eventId': event.eventId,
        'streamId': event.streamId,
        'cursor': event.cursor,
        'type': event.type,
        'sentAt': event.occurredAt.toUtc().toIso8601String(),
        'payload': payload,
      };
      _appendRaw(wire);
      final normalized = StreamEventState(
        hostId: event.hostId,
        streamId: event.streamId,
        cursor: StreamCursor.parse(event.cursor),
        eventId: event.eventId,
        type: event.type,
        payload: payload,
        occurredAt: event.occurredAt,
      );
      if (event.streamId.startsWith('session:')) {
        final sessionId = event.streamId.substring('session:'.length);
        (cachedHistory[sessionId] ??= <StreamEventState>[]).add(normalized);
        if (const {
          'model.state',
          'context.state',
          'retry.state',
          'compaction.state',
          'tool.output',
          'tool.completed',
          'tool.failed',
        }.contains(event.type)) {
          _handleEventPayload(event.type, payload);
        }
        continue;
      }
      final state =
          _streams[event.streamId] ?? StreamViewState.initial(event.streamId);
      final reduction = _reducer.apply(state, normalized);
      if (reduction.disposition == EventDisposition.applied ||
          reduction.disposition == EventDisposition.duplicate) {
        _streams[event.streamId] = reduction.state;
        if (reduction.disposition == EventDisposition.applied) {
          _handleEventPayload(event.type, payload);
        }
      } else if (reduction.disposition == EventDisposition.gap ||
          reduction.disposition == EventDisposition.conflict) {
        _forceSnapshot.add(event.streamId);
      }
    }
    for (final entry in cachedHistory.entries) {
      entry.value.sort((a, b) => a.cursor.compareTo(b.cursor));
      final streamId = 'session:${entry.key}';
      final streamRevision = cursorByStream[streamId];
      final historyRevision = await _database.historySyncRevision(
        forHost,
        entry.key,
      );
      _history[entry.key] = SessionHistoryState(
        sessionId: entry.key,
        items: entry.value,
        snapshotRevision: historyRevision,
        nextPageToken: null,
        isLoading: false,
        error: null,
      );
      if (streamRevision != null) {
        _streams[streamId] = StreamViewState.initial(
          streamId,
          cursor: StreamCursor.parse(streamRevision),
        );
      }
    }
  }

  void _hydrateSnapshot(String streamId, List<Map<String, Object?>> items) {
    for (final item in items) {
      final sessions = item['sessions'];
      if (sessions is List) {
        for (final session in sessions.whereType<Map>()) {
          _mergeSession(Map<String, Object?>.from(session));
        }
      }
      if (streamId.startsWith('session:')) {
        _mergeSession(<String, Object?>{
          'sessionId': streamId.substring('session:'.length),
          ...item,
        });
      }
    }
  }

  SessionState _sessionFromEntry(SessionEntry entry) => SessionState(
    sessionId: entry.sessionId,
    hostId: entry.hostId,
    workspaceId: entry.workspaceId,
    name: entry.name,
    runtimeState: entry.runtimeState,
    policyMode: entry.policyMode,
    modelSummary: entry.modelSummary,
    thinkingLevel: entry.thinkingLevel,
    queueCount: entry.queueCount,
    lastActivityAt: entry.lastActivityAt,
    unreadState: entry.unreadState,
    controllerState: entry.controllerState,
  );

  void _appendRaw(Map<String, Object?> message) {
    _rawEvents.add(jsonEncode(message));
    if (_rawEvents.length > 200) {
      _rawEvents.removeRange(0, _rawEvents.length - 200);
    }
  }

  String _probeError(EndpointProbe probe) =>
      'Readiness ${probe.statusCode}: ${probe.body['reason'] ?? probe.body['status'] ?? 'not ready'}';

  void _socketEnded(Object? error, int epoch) {
    if (epoch != _connectionEpoch || _disposed) return;
    _failSessionCreation('The connection closed before the chat was created.');
    _failModelListRequest('The connection closed before agents were loaded.');
    ++_connectionEpoch;
    _processSnapshotRequests.clear();
    _gitSummaryRequests.clear();
    _git = _git.copyWith(refreshing: false);
    _planSummaryRequests.clear();
    _plans = _plans.copyWith(refreshing: false);
    if (!_historyGateComplete) {
      _historySyncCurrentSessionId = null;
      _historySyncQueue.clear();
      _historySyncLocalRevisions.clear();
    }
    for (final waiter in _controllerWaiters.values) {
      if (!waiter.isCompleted) {
        waiter.completeError(StateError('Connection changed'));
      }
    }
    _controllerWaiters.clear();
    for (final prompt in _pendingPromptsBySession.values) {
      if (prompt.state == 'submitting' ||
          prompt.state == 'sent' ||
          prompt.state == 'retrying') {
        prompt.state = 'indeterminate';
        _promptSendBySession[prompt.sessionId] = const PromptSendStatus(
          phase: PromptSendPhase.indeterminate,
          failure: PromptSendFailure(
            code: 'completion_uncertain',
            message:
                'The connection changed before delivery could be confirmed.',
            action: PromptFailureAction.discardUncertain,
          ),
        );
      } else if (prompt.state == 'acquiring_control' ||
          prompt.state == 'created') {
        prompt.state = 'disconnected';
        _promptSendBySession[prompt.sessionId] = const PromptSendStatus(
          phase: PromptSendPhase.failed,
          failure: PromptSendFailure(
            code: 'disconnected',
            message: 'The bridge disconnected before the message was sent.',
            action: PromptFailureAction.reconnect,
          ),
        );
      }
      unawaited(_persistSelectedPrompt(prompt));
    }
    _ackTimer?.cancel();
    _leaseTimer?.cancel();
    unawaited(_closeSocket());
    connectionId = null;
    leaseId = null;
    phase = _foreground
        ? ConnectionPhase.disconnected
        : ConnectionPhase.background;
    if (error != null) errorMessage = error.toString();
    _notify();
    _scheduleReconnect();
  }

  void _protocolFailure(Object error, int epoch) {
    if (epoch != _connectionEpoch) return;
    _failSessionCreation('The bridge response could not be read.');
    phase = ConnectionPhase.incompatible;
    errorMessage = 'Protocol error: $error';
    _notify();
    unawaited(_closeSocket());
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (!_foreground ||
        endpoint == null ||
        _disposed ||
        _reconnectTimer != null) {
      return;
    }
    _reconnectTimer = Timer(const Duration(seconds: 2), () {
      _reconnectTimer = null;
      if (_foreground && endpoint != null) {
        unawaited(connect(endpoint.toString()));
      }
    });
  }

  void _cancelReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  Future<void> _closeSocket() async {
    _failModelListRequest('The connection changed before agents were loaded.');
    _ackTimer?.cancel();
    _ackTimer = null;
    _leaseTimer?.cancel();
    _leaseTimer = null;
    final subscription = _socketSubscription;
    final socket = _socket;
    _socketSubscription = null;
    _socket = null;
    await subscription?.cancel();
    await socket?.close();
  }

  String _id() => _uuid.v4().toLowerCase();

  /// Test seam for exercising progress rendering without a bridge fixture.
  @visibleForTesting
  void debugSetHistorySyncState({
    required int completed,
    required int total,
    bool complete = false,
    String? error,
  }) {
    _historySyncCompleted = completed;
    _historySyncTotal = total;
    _historyGateComplete = complete;
    _historyGateError = error;
    _notify();
  }

  /// Coalesce mutation bursts into one listener notification while ensuring
  /// network-only updates do not wait for an unrelated frame or pointer event.
  /// A microtask runs after the active build/callback stack, and listener
  /// setState calls schedule the frame that paints the new state.
  void _notify() {
    if (_disposed || _notifyScheduled) return;
    _notifyScheduled = true;
    scheduleMicrotask(() {
      _notifyScheduled = false;
      if (!_disposed) notifyListeners();
    });
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _failSessionCreation('Chat creation was cancelled.');
    _sessionCreationTimer?.cancel();
    ++_connectionEpoch;
    _processSnapshotRequests.clear();
    _gitSummaryRequests.clear();
    _git = _git.copyWith(refreshing: false);
    _planSummaryRequests.clear();
    _plans = _plans.copyWith(refreshing: false);
    _cancelReconnect();
    _ackTimer?.cancel();
    _leaseTimer?.cancel();
    unawaited(_closeSocket());
    super.dispose();
  }

  // =====================================================================
  // M11 multi-session surface
  // =====================================================================

  /// The current subscription set, in wire order. Always includes at
  /// most one full and at most five summary subscriptions. Read-only.
  SessionSubscriptionSet get subscriptionSet => _subscriptionSet;

  /// Read-only view of per-session controller state. Mutations happen
  /// only through [acquireController], [releaseController], and
  /// [takeoverController] so the "no dual controller" invariant is
  /// enforced in one place.
  Map<String, SessionControllerState> get controllerStates =>
      _controllers.snapshot();

  /// Returns the single primary session id, or `null` if the current
  /// installation is observing all sessions.
  String? get primarySessionId => _controllers.primarySessionId;

  /// Returns the attention state for `sessionId`, defaulting to `none`.
  SessionAttentionState attentionFor(String sessionId) =>
      _attention[sessionId] ?? SessionAttentionState.none;

  /// Returns the unread count for `sessionId`, or zero when unknown.
  int unreadCountFor(String sessionId) => _unreadCount[sessionId] ?? 0;

  /// Per-session draft text. Selecting a session round-trips the active
  /// draft through this map so the user never loses work to a fast
  /// switch.
  String draftFor(String sessionId) => _draftBySession[sessionId] ?? '';

  /// Per-session sticky delivery mode. Reverts to `immediate` if the
  /// session has not set one.
  DeliveryMode deliveryModeFor(String sessionId) =>
      _deliveryModeBySession[sessionId] ?? DeliveryMode.immediate;

  /// Marks a session as carrying attention. The host may also report
  /// attention via `session.attention` events; both paths converge
  /// here. The unread count is the number of new turns the user has
  /// not yet opened.
  void markAttention({
    required String sessionId,
    required SessionAttentionState state,
    int? unreadCount,
  }) {
    _attention[sessionId] = state;
    _attentionWire[sessionId] = sessionAttentionWire(state);
    if (unreadCount != null) {
      _unreadCount[sessionId] = unreadCount < 0 ? 0 : unreadCount;
    } else if (state == SessionAttentionState.none) {
      _unreadCount[sessionId] = 0;
    }
    final s = _sessions[sessionId];
    if (s != null) {
      _sessions[sessionId] = SessionState(
        sessionId: s.sessionId,
        hostId: s.hostId,
        workspaceId: s.workspaceId,
        name: s.name,
        runtimeState: s.runtimeState,
        policyMode: s.policyMode,
        modelSummary: s.modelSummary,
        thinkingLevel: s.thinkingLevel,
        queueCount: s.queueCount,
        lastActivityAt: s.lastActivityAt,
        unreadState: _attentionWire[sessionId],
        controllerState: _controllers.forSession(sessionId).mode.name,
      );
    }
    _notify();
    final currentHost = hostId;
    if (currentHost == null) return;
    _database
        .upsertAttentionState(
          hostId: currentHost,
          sessionId: sessionId,
          state: _attentionWire[sessionId]!,
          unreadCount: _unreadCount[sessionId] ?? 0,
          updatedAt: _now(),
        )
        .then((_) {
          _notify();
        }, onError: (_) {});
  }

  /// Makes [sessionId] the foreground subscription and acquires control.
  ///
  /// A restored selection can predate the durable multi-session set. In that
  /// case, first repair the foreground subscription; its sync-complete path
  /// performs acquisition after the server readiness fence opens. When the
  /// subscription is already full, this is an explicit takeover request.
  Future<void> takeControl(String sessionId) async {
    if (!_subscriptionSet.isFull(sessionId)) {
      await selectPrimarySession(sessionId);
      return;
    }
    await acquireController(sessionId);
  }

  /// Explicit controller acquire. Returns when the host acknowledges
  /// the request. Only valid for the active subscription set's full
  /// session; observer sessions are rejected locally.
  Future<void> acquireController(String sessionId) async {
    if (!_subscriptionSet.isFull(sessionId)) {
      throw StateError(
        'Controller can only be acquired for the foreground session',
      );
    }
    await _sendCommand(
      type: 'controller.acquire',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId},
      requiresLease: false,
    );
  }

  /// Explicit controller release. Mobile stops being the controller
  /// for the session and reverts to observer. The session remains
  /// streamed in the subscription set as a summary.
  Future<void> releaseController(String sessionId) async {
    if (!_subscriptionSet.contains(sessionId)) {
      throw StateError('Cannot release a session that is not subscribed');
    }
    await _sendCommand(
      type: 'controller.release',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId},
      requiresLease: true,
    );
  }

  /// Explicit takeover. Mobile takes the controller from another
  /// installation. A repeat takeover is a no-op.
  Future<void> takeoverController(String sessionId) async {
    if (!_subscriptionSet.isFull(sessionId)) {
      throw StateError('Takeover is only allowed on the foreground session');
    }
    final controller = _controllers.forSession(sessionId);
    if (controller.takeoverPending) return;
    if (controller.mode == ControllerMode.primary) return;
    controller.beginTakeover();
    _notify();
    try {
      await _sendCommand(
        type: 'controller.takeover',
        commandId: _id(),
        payload: <String, Object?>{'sessionId': sessionId},
        requiresLease: false,
      );
    } on Object {
      controller.markObserver(observerLeaseId: controller.leaseId);
      _notify();
      rethrow;
    }
  }

  /// Replaces the foreground session. The previous full subscription,
  /// if any, is demoted to a summary if there is capacity, otherwise
  /// dropped. The new session becomes the full subscription.
  Future<void> selectPrimarySession(String sessionId) async {
    if (sessionId.isEmpty) {
      throw ArgumentError.value(sessionId, 'sessionId', 'must not be empty');
    }
    if (_historyGateComplete && !_isActiveChat(sessionId)) {
      throw StateError('Cannot select a chat that is not active.');
    }
    if (_subscriptionSet.isFull(sessionId)) {
      await selectSession(sessionId);
      return;
    }
    final previousFull = _subscriptionSet.full?.sessionId;
    var next = _subscriptionSet.setFull(
      sessionId: sessionId,
      cursor: _cursorForSession(sessionId),
    );
    if (previousFull != null &&
        previousFull != sessionId &&
        _isActiveChat(previousFull)) {
      if (next.summaries.length <
          SessionSubscriptionSet.maxSummarySubscriptions) {
        next = next.addSummary(
          sessionId: previousFull,
          cursor: _cursorForSession(previousFull),
        );
      }
    }
    _subscriptionSet = next;
    await _persistSubscriptionSet();
    await selectSession(sessionId);
  }

  /// Adds `sessionId` as a summary subscription. Throws when the cap
  /// would be exceeded.
  Future<void> addSummarySubscription(String sessionId) async {
    if (_historyGateComplete && !_isActiveChat(sessionId)) {
      throw StateError('Cannot subscribe to a chat that is not active.');
    }
    if (_subscriptionSet.isFull(sessionId)) return;
    if (_subscriptionSet.contains(sessionId)) return;
    _subscriptionSet = _subscriptionSet.addSummary(
      sessionId: sessionId,
      cursor: _cursorForSession(sessionId),
    );
    await _persistSubscriptionSet();
    await _pushSubscriptions();
  }

  /// Removes a session from the subscription set. The full session
  /// cannot be removed; use [selectPrimarySession] with a new id.
  Future<void> removeSubscription(String sessionId) async {
    if (_subscriptionSet.isFull(sessionId)) {
      throw StateError('Cannot remove the foreground subscription');
    }
    if (!_subscriptionSet.contains(sessionId)) return;
    _subscriptionSet = _subscriptionSet.remove(sessionId);
    await _persistSubscriptionSet();
    await _pushSubscriptions();
  }

  /// Persists the active subscription set, replacing the durable
  /// storage for the host. Used by [forgetHost] and generation resets.
  Future<void> _persistSubscriptionSet() async {
    if (hostId == null) return;
    final entries = _subscriptionSet.items
        .map(
          (item) => <String, Object?>{
            'sessionId': item.sessionId,
            'streamId': item.streamId,
            'detail': subscriptionDetailWire(item.detail),
            'cursor': item.cursor.value,
          },
        )
        .toList(growable: false);
    await _database.replaceSubscriptionSet(hostId: hostId!, entries: entries);
  }

  /// Pushes the subscription set to the host. The host stream is
  /// always part of the wire-level subscription; the session rows
  /// come from the active set.
  Future<void> _pushSubscriptions() => _subscribe();

  /// Returns the highest known cursor for `sessionId` across the live
  /// stream and the durable cache. Defaults to zero.
  StreamCursor _cursorForSession(String sessionId) {
    final live = _streams['session:$sessionId']?.lastContiguousCursor;
    if (live != null) return live;
    return StreamCursor.zero;
  }

  /// Records an authoritative controller reply from the host. Mobile
  /// never invents lease identifiers: this is the only path that
  /// assigns one.
  void adoptControllerEvent(Map<String, Object?> payload) {
    final id = payload['sessionId'] as String?;
    if (id == null) return;
    final mode = controllerModeFromWire(payload['mode']);
    final lease = payload['leaseId'] as String?;
    final controller = _controllers.forSession(id);
    switch (mode) {
      case ControllerMode.primary:
        if (lease == null) return;
        controller.adoptAcquire(lease);
        if (id == selectedSessionId) {
          leaseId = lease;
          if (_sendRecoveryInFlight) errorMessage = null;
        }
        final waiter = _controllerWaiters.remove(id);
        if (waiter != null && !waiter.isCompleted) waiter.complete();
        if (hostId != null) {
          _database.upsertControllerState(
            hostId: hostId!,
            sessionId: id,
            mode: 'controller',
            leaseId: lease,
            previousMode: controller.previousMode.name,
            takeoverPending: false,
            updatedAt: _now(),
          );
        }
      case ControllerMode.observer:
        controller.markObserver(observerLeaseId: lease);
        if (id == selectedSessionId) leaseId = null;
        if (hostId != null) {
          _database.upsertControllerState(
            hostId: hostId!,
            sessionId: id,
            mode: 'observer',
            leaseId: lease,
            previousMode: controller.previousMode.name,
            takeoverPending: false,
            updatedAt: _now(),
          );
        }
      case ControllerMode.none:
        controller.markNone();
        if (id == selectedSessionId) leaseId = null;
        if (hostId != null) {
          _database.upsertControllerState(
            hostId: hostId!,
            sessionId: id,
            mode: 'none',
            leaseId: null,
            previousMode: controller.previousMode.name,
            takeoverPending: false,
            updatedAt: _now(),
          );
        }
    }
    _notify();
  }
}
