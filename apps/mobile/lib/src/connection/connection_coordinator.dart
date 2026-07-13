import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';

import '../../protocol_fixture.dart';
import '../data/app_database.dart' hide StreamCursor;
import '../domain/mobile_state.dart';
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
  final List<WorkspaceEntry> _workspaces = [];
  final List<String> _rawEvents = [];
  final List<ToolOutputNotice> _toolOutputNotices = [];
  final Set<String> _syncPending = {};
  final Set<String> _forceSnapshot = {};
  WorkspaceSearchState _workspaceSearch = WorkspaceSearchState.idle();
  int _workspaceSearchEpoch = 0;
  String? _workspaceTrustRequiredFor;

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

  bool get isReady => phase == ConnectionPhase.ready && _socket != null;
  bool get canSend =>
      isReady &&
      selectedSessionId != null &&
      leaseId != null &&
      draft.trim().isNotEmpty &&
      pendingCommandId == null &&
      !requiresTrustApproval;
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

  List<SessionState> get sessions => List.unmodifiable(_sessions.values);
  List<String> get rawEvents => List.unmodifiable(_rawEvents);
  List<ToolOutputNotice> get toolOutputNotices =>
      List.unmodifiable(_toolOutputNotices);
  Map<String, StreamViewState> get streams => Map.unmodifiable(_streams);

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
    errorMessage = null;
    _streams.clear();
    _sessions.clear();
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
      if (!_carryDraftAfterGeneration) draft = '';
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
      'deliveryMode': 'immediate',
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
      _streams.clear();
      _sessions.clear();
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
    } else if (type == 'controller.state' &&
        payload['sessionId'] == selectedSessionId) {
      leaseId = payload['mode'] == 'controller'
          ? payload['leaseId'] as String?
          : null;
      _startLeaseRenewal();
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

  Future<void> _sendControl(String type, Map<String, Object?> payload) async {
    final socket = _socket;
    if (socket == null || connectionId == null) throw StateError('Offline');
    await socket.send(_envelope(type, payload, requestId: _id()));
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
      updatedAt: _now(),
    );
  }

  void _restoreDraft(DraftEntry saved) {
    draft = saved.draftText;
    pendingCommandId = saved.pendingCommandId;
    pendingState = saved.pendingState;
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
}
