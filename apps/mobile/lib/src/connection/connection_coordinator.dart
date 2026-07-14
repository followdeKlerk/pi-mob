import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';

import '../../protocol_fixture.dart';
import '../data/app_database.dart' hide StreamCursor;
import '../domain/controller_lease.dart';
import '../domain/mobile_state.dart';
import '../domain/session_controls.dart';
import '../domain/session_directory.dart';
import '../domain/session_subscriptions.dart';
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
  final Map<String, SessionControlState> _sessionControls = {};
  final List<ModelOption> _models = [];
  final Map<String, SessionHistoryState> _history = {};
  // In-flight `session.history.page` requests. The host may take several
  // seconds to return a large page; without bookkeeping we could apply a
  // response from a stale epoch after the user has reconnected.
  final Map<String, _HistoryRequest> _historyRequests = {};
  final List<WorkspaceEntry> _workspaces = [];
  final List<String> _rawEvents = [];
  final List<ToolOutputNotice> _toolOutputNotices = [];
  final Set<String> _syncPending = {};
  final Set<String> _forceSnapshot = {};
  WorkspaceSearchState _workspaceSearch = WorkspaceSearchState.idle();
  int _workspaceSearchEpoch = 0;
  String? _workspaceTrustRequiredFor;
  // M11 multi-session support. The set holds at most one full
  // subscription and at most five summary subscriptions; each cursor
  // advances independently so a gap on one background session cannot
  // stall the foreground session.
  SessionSubscriptionSet _subscriptionSet = SessionSubscriptionSet.empty();
  final ControllerBook _controllers = ControllerBook();
  final Map<String, SessionAttentionState> _attention = {};
  final Map<String, String> _attentionWire = {};
  final Map<String, int> _unreadCount = {};
  // Per-session draft map: the active session's draft is mirrored into
  // this map on select so an observer session's draft survives a fast
  // switch and is preserved across takeover/release transitions.
  final Map<String, String> _draftBySession = {};
  final Map<String, DeliveryMode> _deliveryModeBySession = {};

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

  bool get isReady => phase == ConnectionPhase.ready && _socket != null;

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
      selectedDeliveryMode,
      selectedRuntimeState,
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
    final state = selectedRuntimeState;
    if (!_deliveryModeMatchesRuntime(selectedDeliveryMode, state)) {
      return _deliveryModeMismatchReason(selectedDeliveryMode, state);
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

  bool get canRetry =>
      isReady &&
      leaseId != null &&
      pendingCommandId != null &&
      pendingPayload != null;
  bool get canAbort => isReady && selectedSessionId != null && leaseId != null;
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

  List<SessionState> get sessions => List.unmodifiable(_sessions.values);
  List<ModelOption> get configuredModels => List.unmodifiable(_models);
  SessionControlState? get selectedControls => selectedSessionId == null
      ? null
      : (_sessionControls[selectedSessionId!] ??
            SessionControlState.empty(selectedSessionId!));
  List<String> get rawEvents => List.unmodifiable(_rawEvents);
  List<ToolOutputNotice> get toolOutputNotices =>
      List.unmodifiable(_toolOutputNotices);
  Map<String, StreamViewState> get streams => Map.unmodifiable(_streams);

  SessionHistoryState historyFor(String sessionId) =>
      _history[sessionId] ?? SessionHistoryState.empty(sessionId);

  List<StreamEventState> transcriptEvents(String sessionId) {
    final byId = <String, StreamEventState>{};
    for (final event
        in _history[sessionId]?.items ?? const <StreamEventState>[]) {
      byId[event.eventId] = event;
    }
    for (final event
        in _streams['session:$sessionId']?.events ??
            const <StreamEventState>[]) {
      byId[event.eventId] = event;
    }
    final result =
        byId.values
            .where(
              (event) => const <String>{
                'turn',
                'assistant',
                'reasoning',
                'tool',
              }.contains(event.type.split('.').first),
            )
            .toList()
          ..sort((a, b) => a.cursor.compareTo(b.cursor));
    return List<StreamEventState>.unmodifiable(result);
  }

  bool hasOlderHistory(String sessionId) {
    final state = _history[sessionId];
    return state == null || state.hasOlder;
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
    if (current.isLoading || (current.items.isNotEmpty && !current.hasOlder)) {
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

  Future<void> requestModels() async {
    await _sendControl('model.list', <String, Object?>{
      if (selectedSessionId != null) 'sessionId': selectedSessionId,
    });
  }

  Future<void> setModel(String modelId) => _sendSessionControl(
    'model.set',
    <String, Object?>{'modelId': modelId},
    idleOnly: true,
  );
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
    final drafts = await _database.allDrafts();
    if (drafts.isNotEmpty) {
      final saved = drafts.reduce(
        (a, b) => a.updatedAt.isAfter(b.updatedAt) ? a : b,
      );
      // Only adopt the draft's hostId if a host row still exists. Drafts are
      // intentionally preserved across explicit forget-host so the user can
      // re-pair without losing their typing, but orphaned drafts must not
      // resurrect a forgotten host identity.
      if (hostId != null) {
        hostId ??= saved.hostId;
      }
      if (hostId != null) {
        selectedSessionId = saved.sessionId;
        _restoreDraft(saved);
      }
    } else if (_sessions.isNotEmpty && hostId != null) {
      selectedSessionId = _sessions.keys.first;
    }

    if (hostId != null) await _loadCachedStreams(hostId!);
    _notify();
    if (autoConnect && endpoint != null && _foreground) {
      unawaited(connect(endpoint.toString()));
    }
  }

  Future<void> connect(String endpointText) async {
    if (!_foreground || _disposed) return;
    final int epoch = ++_connectionEpoch;
    _cancelReconnect();
    await _closeSocket();
    leaseId = null;
    connectionId = null;
    errorMessage = null;

    try {
      endpoint = normalizeHttpsEndpoint(endpointText);
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
                (Object error, StackTrace stack) =>
                    _protocolFailure(error, epoch),
              );
        },
        onError: (Object error, StackTrace stack) => _socketEnded(error, epoch),
        onDone: () => _socketEnded(null, epoch),
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

  Future<void> retryConnection() async {
    final target = endpoint;
    if (target != null) await connect(target.toString());
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
    _sessionControls.clear();
    _models.clear();
    _history.clear();
    _historyRequests.clear();
    _workspaces.clear();
    _workspaceSearch = WorkspaceSearchState.idle();
    _workspaceSearchEpoch += 1;
    _workspaceTrustRequiredFor = null;
    _rawEvents.clear();
    _toolOutputNotices.clear();
    _forceSnapshot.clear();
    _syncPending.clear();
    phase = ConnectionPhase.unpaired;
    _notify();
  }

  Future<void> selectWorkspace(String workspaceId) async {
    selectedWorkspaceId = workspaceId;
    _workspaceTrustRequiredFor = _needsApproval(_workspaces, workspaceId)
        ? workspaceId
        : null;
    _notify();
  }

  Future<void> createSession({String? name}) async {
    if (!isReady || selectedWorkspaceId == null) return;
    final commandId = _id();
    await _sendCommand(
      type: 'session.create',
      commandId: commandId,
      payload: <String, Object?>{
        'workspaceId': selectedWorkspaceId,
        'policyMode': 'full',
        if (name != null && name.isNotEmpty) 'name': name,
      },
      requiresLease: false,
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
      if (_carryDraftAfterGeneration) {
        _carryDraftAfterGeneration = false;
        await _persistDraft();
      }
    } else {
      _restoreDraft(saved);
    }
    _notify();
    if (_socket != null && connectionId != null) await _subscribe();
  }

  Future<void> updateDraft(String value) async {
    draft = value;
    _notify();
    await _persistDraft();
  }

  Future<void> submitPrompt() async {
    if (!canSend) return;
    final commandId = _id();
    final payload = <String, Object?>{
      'sessionId': selectedSessionId!,
      'deliveryMode': deliveryModeWire(selectedDeliveryMode),
      'message': draft,
      'attachmentIds': const <String>[],
    };

    // Durability barrier: this exact semantic payload is committed before send.
    pendingCommandId = commandId;
    pendingPayload = Map<String, Object?>.unmodifiable(payload);
    pendingState = 'created';
    await _persistDraft();
    _notify();
    try {
      await _sendCommand(
        type: 'prompt.submit',
        commandId: commandId,
        payload: payload,
        requiresLease: true,
      );
      if (pendingCommandId == commandId) {
        pendingState = 'sent';
        await _persistDraft();
        _notify();
      }
    } on Object catch (error) {
      pendingState = 'send_error';
      errorMessage = error.toString();
      await _persistDraft();
      _notify();
    }
  }

  /// The only path that sends a persisted prompt after a failed/lost attempt.
  /// It reuses both the command ID and byte-equivalent decoded payload.
  Future<void> retryPending() async {
    if (!canRetry) return;
    pendingState = 'retrying';
    await _persistDraft();
    _notify();
    await _sendCommand(
      type: 'prompt.submit',
      commandId: pendingCommandId!,
      payload: Map<String, Object?>.from(pendingPayload!),
      requiresLease: true,
    );
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

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final active = state == AppLifecycleState.resumed;
    _foreground = active;
    if (!active) {
      ++_connectionEpoch;
      _cancelReconnect();
      unawaited(_closeSocket());
      connectionId = null;
      leaseId = null;
      phase = ConnectionPhase.background;
      _notify();
    } else if (endpoint != null) {
      unawaited(connect(endpoint.toString()));
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
        _modelListResult(payload);
      case 'session.history.page.result':
        _sessionHistoryPageResult(message, payload);
      case 'workspace.trust_state':
        await _workspaceTrustStateEvent(payload);
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
        if (message['eventId'] is String &&
            message['streamId'] is String &&
            message['cursor'] is String) {
          await _journalEvent(message, type, payload);
        }
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
      _sessionControls.clear();
      _models.clear();
      _history.clear();
      _historyRequests.clear();
      _rawEvents.clear();
      _toolOutputNotices.clear();
      _forceSnapshot.add('host:$newHostId');
    } else {
      await _loadCachedStreams(newHostId);
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
    final streamIds = <String>[
      'host:$hostId',
      if (selectedSessionId != null) 'session:$selectedSessionId',
    ];
    _syncPending
      ..clear()
      ..addAll(streamIds);
    phase = ConnectionPhase.synchronizing;
    final streams = <Map<String, Object?>>[];
    for (final streamId in streamIds) {
      final cursor =
          _streams[streamId]?.lastContiguousCursor.value ??
          await _database.cursor(streamId);
      streams.add(<String, Object?>{
        'streamId': streamId,
        'detail': 'full',
        if (!_forceSnapshot.remove(streamId) && cursor != null)
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
    final current = StreamCursor.parse(payload['currentCursor'] as String);
    final state = _streams[streamId] ?? StreamViewState.initial(streamId);
    if (state.lastContiguousCursor.compareTo(current) < 0) {
      throw StateError(
        'Stream $streamId completed with an unapplied cursor gap',
      );
    }
    _syncPending.remove(streamId);
    if (_syncPending.isEmpty) {
      phase = ConnectionPhase.ready;
      errorMessage = null;
      _startAckTimer();
      await _sendControl('workspace.list', const <String, Object?>{});
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
    if (type == 'host.degraded') {
      phase = ConnectionPhase.degraded;
      errorMessage = payload['reason']?.toString() ?? 'Host degraded';
    } else if (type == 'host.draining') {
      phase = ConnectionPhase.hostDraining;
      errorMessage = 'Host is draining';
    } else if (type == 'tool.output' ||
        type == 'tool.completed' ||
        type == 'tool.failed') {
      final retained = payload['retainedBytes'];
      final total = payload['totalBytes'];
      final truncated = payload['isTruncated'];
      if (retained is int && total is int && truncated is bool) {
        _toolOutputNotices.removeWhere(
          (notice) => notice.toolCallId == payload['toolCallId'],
        );
        _toolOutputNotices.add(
          ToolOutputNotice(
            toolCallId: payload['toolCallId']?.toString() ?? 'unknown',
            retainedBytes: retained,
            totalBytes: total,
            isTruncated: truncated,
            digest: payload['digest'] as String?,
          ),
        );
      }
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
    } else if (type == 'session.summary') {
      _mergeSession(payload);
      final id = payload['sessionId'];
      if (id is String && selectedSessionId == null) {
        unawaited(selectSession(id));
      }
    } else if (type == 'session.removed') {
      final id = payload['sessionId'];
      if (id is String) _sessions.remove(id);
    } else if (type == 'workspace.trust_state') {
      unawaited(_workspaceTrustStateEvent(payload));
    } else if (type == 'session.state' || type.startsWith('turn.')) {
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
    } else if (type == 'command.state' &&
        payload['commandId'] == pendingCommandId) {
      final state = payload['state'];
      if (state is String) unawaited(_acceptPending(state));
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
      name: payload['name'] as String? ?? old?.name ?? 'Session',
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

  void _modelListResult(Map<String, Object?> payload) {
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
  }

  void _sessionHistoryPageResult(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) {
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
    final merged = <String, StreamEventState>{
      for (final event in existing.items) event.eventId: event,
      for (final event in decoded) event.eventId: event,
    }.values.toList()..sort((a, b) => a.cursor.compareTo(b.cursor));
    _history[request.sessionId] = existing.copyWith(
      items: merged,
      snapshotRevision: payload['snapshotRevision'] is String
          ? payload['snapshotRevision'] as String
          : existing.snapshotRevision,
      nextPageToken: payload['nextPageToken'] is String
          ? payload['nextPageToken'] as String
          : null,
      isLoading: false,
      error: null,
    );
  }

  void _workspaceList(Map<String, Object?> payload) {
    final items = payload['items'];
    if (items is! List) return;
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

  Future<void> _workspaceTrustStateEvent(Map<String, Object?> payload) async {
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
    final commandId = message['commandId'];
    final state = payload['state'];
    if (commandId == pendingCommandId && state is String) {
      await _acceptPending(state);
    }
  }

  Future<void> _commandCurrent(Map<String, Object?> payload) async {
    if (payload['commandId'] == pendingCommandId &&
        payload['state'] is String) {
      await _acceptPending(payload['state'] as String);
    }
  }

  Future<void> _acceptPending(String state) async {
    pendingState = state;
    if (!_acceptedOrLater.contains(state)) {
      await _persistDraft();
      return;
    }
    final submittedText = pendingPayload?['message'];
    if (draft == submittedText) draft = '';
    pendingCommandId = null;
    pendingPayload = null;
    pendingState = null;
    await _persistDraft();
  }

  Future<void> _serverError(
    Map<String, Object?> message,
    Map<String, Object?> payload,
  ) async {
    final code = payload['code']?.toString() ?? 'unknown';
    errorMessage = '$code: ${payload['message'] ?? 'Bridge error'}';
    phase = switch (code) {
      'unsupported_protocol' ||
      'unsupported_capability' ||
      'pi_version_mismatch' => ConnectionPhase.incompatible,
      'host_draining' => ConnectionPhase.hostDraining,
      'host_not_ready' ||
      'database_unavailable' ||
      'storage_full' ||
      'crash_loop' ||
      'provider_interrupted' => ConnectionPhase.degraded,
      _ => phase,
    };
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
    if (message['commandId'] == pendingCommandId ||
        (code == 'command_not_found' && pendingCommandId != null)) {
      pendingState = code;
      await _persistDraft();
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
    _leaseTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      final currentLease = leaseId;
      if (isReady && currentLease != null) {
        unawaited(
          _sendControl('controller.renew', <String, Object?>{
            'leaseId': currentLease,
          }),
        );
      }
    });
  }

  Future<void> _reconcilePending() async {
    if (pendingCommandId == null || !isReady) return;
    // Deliberately a read only. Never call retryPending from reconnect.
    await _sendControl('command.current', <String, Object?>{
      'commandId': pendingCommandId!,
    });
  }

  Future<String> _sendControl(String type, Map<String, Object?> payload) async {
    final socket = _socket;
    if (socket == null || connectionId == null) throw StateError('Offline');
    final requestId = _id();
    await socket.send(_envelope(type, payload, requestId: requestId));
    return requestId;
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
    'sentAt': _now().toIso8601String(),
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
    if (hostId == null || selectedSessionId == null) return;
    await _database.saveDraft(
      hostId: hostId!,
      sessionId: selectedSessionId!,
      text: draft,
      pendingCommandId: pendingCommandId,
      pendingPayloadJson: pendingPayload == null
          ? null
          : jsonEncode(pendingPayload),
      pendingState: pendingState,
      selectedDeliveryMode: selectedDeliveryMode,
      updatedAt: _now(),
    );
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
    ++_connectionEpoch;
    _ackTimer?.cancel();
    _leaseTimer?.cancel();
    _socket = null;
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

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    ++_connectionEpoch;
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
    await _sendCommand(
      type: 'controller.takeover',
      commandId: _id(),
      payload: <String, Object?>{'sessionId': sessionId},
      requiresLease: false,
    );
  }

  /// Replaces the foreground session. The previous full subscription,
  /// if any, is demoted to a summary if there is capacity, otherwise
  /// dropped. The new session becomes the full subscription.
  Future<void> selectPrimarySession(String sessionId) async {
    if (sessionId.isEmpty) {
      throw ArgumentError.value(sessionId, 'sessionId', 'must not be empty');
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
    if (previousFull != null && previousFull != sessionId) {
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
    await _pushSubscriptions();
  }

  /// Adds `sessionId` as a summary subscription. Throws when the cap
  /// would be exceeded.
  Future<void> addSummarySubscription(String sessionId) async {
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
  Future<void> _pushSubscriptions() async {
    if (_socket == null || connectionId == null || hostId == null) return;
    _syncPending
      ..clear()
      ..add('host:$hostId');
    for (final item in _subscriptionSet.items) {
      _syncPending.add(item.streamId);
    }
    phase = ConnectionPhase.synchronizing;
    final wire = <Map<String, Object?>>[
      <String, Object?>{'streamId': 'host:$hostId', 'detail': 'full'},
      ..._subscriptionSet.toWire(),
    ];
    _notify();
    await _sendControl('subscription.set', <String, Object?>{'streams': wire});
  }

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
        if (id == selectedSessionId) leaseId = lease;
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
