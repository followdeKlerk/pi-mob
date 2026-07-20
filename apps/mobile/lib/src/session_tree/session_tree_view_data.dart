import 'package:flutter/foundation.dart';

/// The normalized kind of an entry displayed in the session tree.
enum SessionTreeEntryKind {
  userPrompt('User prompt'),
  assistant('Assistant response'),
  tool('Tool activity'),
  system('System entry');

  const SessionTreeEntryKind(this.semanticLabel);

  final String semanticLabel;
}

/// Loading state for one node's immediate children.
enum SessionTreeChildrenState { notRequested, loading, loaded, failed }

/// Initial state of the tree surface.
enum SessionTreeSurfaceState { loading, ready, failed, incompatible }

/// A recursively normalized tree entry. The bridge/reducer owns ordering,
/// eligibility, pagination tokens, and lineage. Widgets only render this data.
@immutable
class SessionTreeNodeData {
  const SessionTreeNodeData({
    required this.entryId,
    required this.kind,
    required this.preview,
    required this.depth,
    this.children = const <SessionTreeNodeData>[],
    this.childrenState = SessionTreeChildrenState.loaded,
    this.hasMoreChildren = false,
    this.nextPageToken,
    this.childrenError,
    this.isCurrentLeaf = false,
    this.isOnCurrentBranch = false,
    this.isForkEligible = false,
    this.initiallyExpanded = false,
  }) : assert(depth >= 0),
       assert(!hasMoreChildren || nextPageToken != null);

  /// Opaque bridge-mapped entry reference. It is never shown to the user.
  final String entryId;
  final SessionTreeEntryKind kind;
  final String preview;
  final int depth;

  /// Already loaded immediate children, in bridge-provided order.
  final List<SessionTreeNodeData> children;
  final SessionTreeChildrenState childrenState;
  final bool hasMoreChildren;
  final String? nextPageToken;
  final String? childrenError;

  final bool isCurrentLeaf;
  final bool isOnCurrentBranch;

  /// True only for an upstream-confirmed eligible user prompt.
  final bool isForkEligible;

  /// Allows the reducer to reveal the current lineage on first render.
  final bool initiallyExpanded;

  bool get canExpand =>
      children.isNotEmpty ||
      childrenState == SessionTreeChildrenState.notRequested ||
      childrenState == SessionTreeChildrenState.loading ||
      childrenState == SessionTreeChildrenState.failed ||
      hasMoreChildren;
}

/// Request for the first, next, or retry page under [parentEntryId].
@immutable
class SessionTreePageRequest {
  const SessionTreePageRequest({
    required this.parentEntryId,
    required this.pageToken,
    this.isRetry = false,
  });

  final String parentEntryId;
  final String? pageToken;
  final bool isRetry;
}

enum SessionBranchOperationKind { fork, clone }

enum SessionBranchOperationPhase {
  idle,
  submitting,
  waitingForSnapshot,
  cancelled,
  failed,
}

/// Durable fork/clone state supplied by the coordinator. In particular,
/// [waitingForSnapshot] prevents the UI from implying that navigation is safe
/// before the new session mapping and snapshot are available.
@immutable
class SessionBranchOperationData {
  const SessionBranchOperationData({
    this.kind,
    this.phase = SessionBranchOperationPhase.idle,
    this.message,
  }) : assert(
         phase == SessionBranchOperationPhase.idle || kind != null,
         'A non-idle branch operation needs a kind.',
       );

  final SessionBranchOperationKind? kind;
  final SessionBranchOperationPhase phase;
  final String? message;

  bool get isBusy =>
      phase == SessionBranchOperationPhase.submitting ||
      phase == SessionBranchOperationPhase.waitingForSnapshot;
}

/// Coordinator-free input for the session-tree screen.
@immutable
class SessionTreeViewData {
  const SessionTreeViewData({
    required this.sessionName,
    required this.roots,
    this.surfaceState = SessionTreeSurfaceState.ready,
    this.isStale = false,
    this.partialDataMessage,
    this.errorMessage,
    this.branchOperation = const SessionBranchOperationData(),
  });

  final String sessionName;
  final List<SessionTreeNodeData> roots;
  final SessionTreeSurfaceState surfaceState;

  /// Cached tree remains navigable, but mutations are disabled upstream.
  final bool isStale;

  /// A stable, user-facing description of missing/degraded tree data.
  final String? partialDataMessage;
  final String? errorMessage;
  final SessionBranchOperationData branchOperation;

  bool get isEmpty =>
      surfaceState == SessionTreeSurfaceState.ready && roots.isEmpty;
}

@immutable
class SessionTreeCallbacks {
  const SessionTreeCallbacks({
    this.onNodeSelected,
    this.onLoadChildren,
    this.onRetryTree,
    this.onFork,
    this.onClone,
    this.onDismissBranchStatus,
  });

  final ValueChanged<SessionTreeNodeData>? onNodeSelected;
  final ValueChanged<SessionTreePageRequest>? onLoadChildren;
  final VoidCallback? onRetryTree;

  /// Called only after the user confirms the selected eligible prompt.
  final ValueChanged<SessionTreeNodeData>? onFork;

  /// Called only after the user confirms the distinct clone flow.
  final VoidCallback? onClone;
  final VoidCallback? onDismissBranchStatus;
}

/// Lifecycle state shown in the session details surface.
enum SessionLifecyclePhase {
  idle,
  renaming,
  abortingForDelete,
  deleting,
  undoingDelete,
  restoring,
  purging,
  repairingDelete,
}

@immutable
class SessionIdentityViewData {
  const SessionIdentityViewData({
    required this.sessionId,
    required this.fallbackName,
    required this.workspaceLabel,
    this.customName,
    this.parentSessionName,
  });

  final String sessionId;
  final String? customName;
  final String fallbackName;
  final String workspaceLabel;
  final String? parentSessionName;

  String get displayName {
    final name = customName?.trim();
    return name == null || name.isEmpty ? fallbackName : name;
  }
}

@immutable
class SessionRenameRequest {
  const SessionRenameRequest(this.name);

  /// Null selects the generated fallback name.
  final String? name;
}

/// Lifecycle view-data is intentionally local to this widget package so it
/// does not conflict with coordinator/database work. All booleans are
/// authoritative upstream state, not decisions made by the widget.
@immutable
class SessionLifecycleViewData {
  const SessionLifecycleViewData({
    required this.identity,
    this.isDeleted = false,
    this.purgeDateLabel,
    this.canRestore = false,
    this.restoreUnavailableReason,
    this.hasActiveProcess = false,
    this.hasActiveTurn = false,
    this.queuedPromptCount = 0,
    this.deleteFailedMessage,
    this.actionsEnabled = true,
    this.disabledReason,
    this.phase = SessionLifecyclePhase.idle,
  }) : assert(queuedPromptCount >= 0),
       assert(!isDeleted || purgeDateLabel != null);

  final SessionIdentityViewData identity;
  final bool isDeleted;

  /// Server-derived, already localized display value. Client clock is not
  /// used to decide whether restore remains valid.
  final String? purgeDateLabel;
  final bool canRestore;
  final String? restoreUnavailableReason;
  final bool hasActiveProcess;
  final bool hasActiveTurn;
  final int queuedPromptCount;

  /// Non-null means the accepted soft delete only partially completed.
  final String? deleteFailedMessage;
  final bool actionsEnabled;
  final String? disabledReason;
  final SessionLifecyclePhase phase;

  bool get isBusy => phase != SessionLifecyclePhase.idle;
}

@immutable
class SessionLifecycleCallbacks {
  const SessionLifecycleCallbacks({
    this.onRename,
    this.onSoftDelete,
    this.onUndoDelete,
    this.onRestore,
    this.onPermanentDelete,
    this.onRepairDelete,
  });

  final ValueChanged<SessionRenameRequest>? onRename;
  final VoidCallback? onSoftDelete;
  final VoidCallback? onUndoDelete;
  final VoidCallback? onRestore;
  final VoidCallback? onPermanentDelete;
  final VoidCallback? onRepairDelete;
}
