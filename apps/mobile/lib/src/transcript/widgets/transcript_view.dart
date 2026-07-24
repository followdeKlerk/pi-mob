import 'package:flutter/material.dart';

import '../../ui/theme/pi_tokens.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../../domain/mobile_state.dart';
import '../domain/transcript_document.dart';
import '../domain/transcript_items.dart';
import '../domain/transcript_reducer.dart';
import '../domain/transcript_turn.dart';
import 'final_answer_view.dart';
import 'reasoning_block.dart';
import 'tool_card.dart';

/// Production transcript surface. Historical rows are lazily built, each turn
/// has a stable key and paint boundary, and active streaming cannot repaint the
/// full list.
///
/// Presentation: the surface is rendered edge-to-edge against the parent
/// route. It paints the M3 [ColorScheme.surface] tone, uses a hairline
/// outline-variant divider between the title bar and the list, and never
/// wraps the transcript in a `Card`. The inner widgets
/// ([FinalAnswerView], [ReasoningBlock], [ToolCard]) own their own
/// horizontal rhythm.
class TranscriptView extends StatefulWidget {
  const TranscriptView({
    required this.document,
    this.onEditUserMessage,
    this.onScrollPersist,
    this.initialScrollOffset,
    this.initialFollowMode,
    super.key,
  });

  final TranscriptDocument document;
  final ValueChanged<String>? onEditUserMessage;

  /// R12 — Persisted scroll observer. Invoked on every user-initiated
  /// scroll change with the latest stable pixel offset and the resolved
  /// follow-mode flag (true = pinned to the latest tail, false = the user
  /// has scrolled away). Background follow ticks (auto-scroll-to-tail)
  /// do NOT fire this observer.
  final void Function(int offset, bool followMode)? onScrollPersist;

  /// R12 — Initial scroll offset to restore when the widget mounts or the
  /// stream identity changes. `null` means "no persisted offset; stay at
  /// tail". Background live events then scroll back to the tail only when
  /// `initialFollowMode` is true or unset.
  final int? initialScrollOffset;

  /// R12 — Initial follow mode for restore. `true` means the user was
  /// pinned to the tail; `false` means the user was reading history and
  /// we should land at `initialScrollOffset`. Defaults to `true`.
  final bool? initialFollowMode;

  @override
  State<TranscriptView> createState() => _TranscriptViewState();
}

class _TranscriptViewState extends State<TranscriptView> {
  final ScrollController _controller = ScrollController();
  bool _nearLatest = true;
  bool _pendingFollow = true;
  bool _initialPosition = true;
  bool _autoFollowing = false;
  bool _restoringScroll = false;
  int _followGeneration = 0;
  int _unread = 0;

  /// R12 — restore offset carried from the persisted tuple. When set,
  /// the first frame after a non-append-only rebuild jumps here instead
  /// of the latest tail. Cleared after the jump so subsequent live
  /// events follow `_nearLatest` as before.
  int? _pendingRestoreOffset;

  /// R12 — follow mode carried from the persisted tuple. When false,
  /// the user was reading history and `_nearLatest` must stay false
  /// until they scroll back. When null we use the default (tail).
  bool? _pendingRestoreFollow;

  /// R12 — last persisted offset+followMode. Used to coalesce flushes
  /// so the underlying database write only fires when the user has
  /// actually moved the scroll position. Coalescing is by value
  /// comparison only (no Timer / Future.delayed — see FIELD_GUIDE §R11):
  /// repeated identical offsets short-circuit, but every meaningful
  /// change flushes immediately, so the mobile-authoritative tuple is
  /// durable by the time the user releases the scroll gesture.
  int _lastPersistedOffset = -1;
  bool _lastPersistedFollow = true;

  static const double _followThreshold = 48;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
    _pendingRestoreOffset = widget.initialScrollOffset;
    _pendingRestoreFollow = widget.initialFollowMode;
    if (_pendingRestoreFollow == false) {
      _nearLatest = false;
    }
  }

  @override
  void didUpdateWidget(covariant TranscriptView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.document.streamId != oldWidget.document.streamId) {
      _nearLatest = true;
      _pendingFollow = true;
      _initialPosition = true;
      _unread = 0;
      // The persisted offset for the new stream arrives through
      // `widget.initialScrollOffset`; capture it here so the next frame
      // can jump there instead of the latest tail.
      _pendingRestoreOffset = widget.initialScrollOffset;
      _pendingRestoreFollow = widget.initialFollowMode;
      if (_pendingRestoreFollow == false) {
        _nearLatest = false;
      }
      _lastPersistedOffset = -1;
      return;
    }
    if (!_contentChanged(oldWidget.document, widget.document)) return;
    final added =
        _activityCount(widget.document) - _activityCount(oldWidget.document);
    if (_nearLatest || _autoFollowing) {
      _pendingFollow = true;
    } else if (added > 0) {
      _unread += added;
    }
  }

  bool _contentChanged(TranscriptDocument oldDoc, TranscriptDocument newDoc) {
    if (oldDoc.turns.length != newDoc.turns.length) return true;
    if (oldDoc.turns.isEmpty) return false;
    return oldDoc.turns.last != newDoc.turns.last;
  }

  int _activityCount(TranscriptDocument document) {
    var count = document.turns.length;
    for (final turn in document.turns) {
      if (turn is AssistantTurn) count += turn.items.length;
    }
    return count;
  }

  bool _onUserScroll(UserScrollNotification notification) {
    if (_autoFollowing && notification.direction != ScrollDirection.idle) {
      _followGeneration++;
      _autoFollowing = false;
    }
    return false;
  }

  void _onScroll() {
    if (!_controller.hasClients || _autoFollowing) return;
    final after = _controller.position.extentAfter;
    final near = after <= _followThreshold;
    if (near == _nearLatest && (!near || _unread == 0)) {
      // Even when _nearLatest state didn't change, a user scroll may
      // have shifted the offset; flush the persistence observer so the
      // mobile-authoritative tuple stays current.
      _maybePersist();
      return;
    }
    setState(() {
      _nearLatest = near;
      if (near) _unread = 0;
    });
    _maybePersist();
  }

  /// R12 — Flush a scroll-persistence event when the offset or follow
  /// mode has changed meaningfully. Coalescing is by value comparison
  /// only (no Timer / Future.delayed — see FIELD_GUIDE §R11): the
  /// callback is invoked exactly once per change and is allowed to
  /// complete on its own Future. Background follow ticks
  /// (`_autoFollowing`) skip the callback so a tail-stick is not
  /// recorded as a user move.
  void _maybePersist() {
    final callback = widget.onScrollPersist;
    if (callback == null) return;
    if (!_controller.hasClients) return;
    if (_autoFollowing) return;
    if (_restoringScroll) return;
    final offset = _controller.position.pixels.round();
    if (offset == _lastPersistedOffset && _nearLatest == _lastPersistedFollow) {
      return;
    }
    _lastPersistedOffset = offset;
    _lastPersistedFollow = _nearLatest;
    callback(offset, _nearLatest);
  }

  Future<void> _scrollToLatest({bool userInitiated = false}) async {
    if (!_controller.hasClients) return;
    final generation = ++_followGeneration;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_initialPosition || reduceMotion) {
      _controller.jumpTo(_controller.position.maxScrollExtent);
      _initialPosition = false;
    } else {
      _autoFollowing = true;
      try {
        // A lazily-built list can refine maxScrollExtent as rows are laid
        // out. Follow that refinement rather than stopping one screen short.
        for (var attempt = 0; attempt < 4; attempt++) {
          if (!_controller.hasClients || generation != _followGeneration) {
            return;
          }
          await _controller.animateTo(
            _controller.position.maxScrollExtent,
            duration: Duration(milliseconds: userInitiated ? 280 : 180),
            curve: userInitiated ? Curves.easeOutCubic : Curves.easeOut,
          );
          await WidgetsBinding.instance.endOfFrame;
          if (_controller.position.extentAfter < 1) break;
        }
      } finally {
        if (generation == _followGeneration) _autoFollowing = false;
      }
    }
    if (!mounted || generation != _followGeneration) return;
    setState(() {
      _nearLatest = true;
      _unread = 0;
    });
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_pendingFollow && _pendingRestoreOffset == null) {
      _pendingFollow = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _scrollToLatest();
      });
    } else if (_pendingRestoreOffset != null) {
      // R12 — Restore the persisted offset instead of jumping to tail.
      // Background follow ticks (live streaming) must NOT override a
      // user's pinned history position until they manually jump back.
      final target = _pendingRestoreOffset!;
      _pendingRestoreOffset = null;
      _initialPosition = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (!_controller.hasClients) return;
        final clamped = target.clamp(
          0,
          _controller.position.maxScrollExtent.round(),
        );
        if (_pendingRestoreFollow != true) {
          _nearLatest = false;
        }
        _restoringScroll = true;
        _controller.jumpTo(clamped.toDouble());
        _restoringScroll = false;
        if (_pendingRestoreFollow == true) {
          _pendingRestoreFollow = null;
        }
      });
    }
    final turns = widget.document.turns;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        return ColoredBox(
          color: scheme.surface,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: turns.isEmpty
                        ? Center(
                            child: Text(
                              'No transcript yet',
                              style: text.bodyMedium?.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          )
                        : NotificationListener<UserScrollNotification>(
                            onNotification: _onUserScroll,
                            child: ListView.builder(
                              key: const Key('transcript-list'),
                              controller: _controller,
                              itemCount: turns.length,
                              itemBuilder: (context, index) => RepaintBoundary(
                                key: ValueKey(turns[index].widgetKey),
                                child: _TurnView(
                                  turn: turns[index],
                                  onEditUserMessage: widget.onEditUserMessage,
                                ),
                              ),
                            ),
                          ),
                  ),
                ],
              ),
              if (!_nearLatest)
                Positioned(
                  right: 12,
                  bottom: 12,
                  child: FloatingActionButton.small(
                    key: const Key('jump-to-latest'),
                    onPressed: () => _scrollToLatest(userInitiated: true),
                    tooltip:
                        'Jump to latest${_unread == 0 ? '' : ', $_unread new'}',
                    child: Badge(
                      isLabelVisible: _unread > 0,
                      label: Text('$_unread'),
                      child: const Icon(Icons.arrow_downward),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class TranscriptEventView extends StatefulWidget {
  const TranscriptEventView({
    required this.streamId,
    required this.events,
    this.onEditUserMessage,
    this.onScrollPersist,
    this.initialScrollOffset,
    this.initialFollowMode,
    super.key,
  });

  final String streamId;
  final List<StreamEventState> events;
  final ValueChanged<String>? onEditUserMessage;

  /// R12 — Threaded through to the inner TranscriptView.
  final void Function(int offset, bool followMode)? onScrollPersist;

  /// R12 — Threaded through to the inner TranscriptView.
  final int? initialScrollOffset;

  /// R12 — Threaded through to the inner TranscriptView.
  final bool? initialFollowMode;

  @override
  State<TranscriptEventView> createState() => _TranscriptEventViewState();
}

class _TranscriptEventViewState extends State<TranscriptEventView> {
  static const _reducer = TranscriptReducer();
  late TranscriptReducerState _state;
  int _eventCount = 0;
  String? _firstEventId;
  String? _lastEventId;

  @override
  void initState() {
    super.initState();
    _rebuild();
  }

  @override
  void didUpdateWidget(covariant TranscriptEventView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.streamId != widget.streamId || !_isAppendOnly()) {
      _rebuild();
      return;
    }
    for (var index = _eventCount; index < widget.events.length; index++) {
      _apply(widget.events[index]);
    }
    _captureEventBounds();
  }

  bool _isAppendOnly() {
    if (widget.events.length < _eventCount) return false;
    if (_eventCount == 0) return true;
    return widget.events.first.eventId == _firstEventId &&
        widget.events[_eventCount - 1].eventId == _lastEventId;
  }

  void _captureEventBounds() {
    _eventCount = widget.events.length;
    _firstEventId = widget.events.isEmpty ? null : widget.events.first.eventId;
    _lastEventId = widget.events.isEmpty ? null : widget.events.last.eventId;
  }

  void _rebuild() {
    _state = TranscriptReducerState.empty(widget.streamId);
    for (final event in widget.events) {
      _apply(event);
    }
    _captureEventBounds();
  }

  void _apply(StreamEventState event) {
    if (event.streamId == widget.streamId) {
      _state = _reducer.apply(state: _state, event: event);
    }
  }

  @override
  Widget build(BuildContext context) => TranscriptView(
    document: _state.document,
    onEditUserMessage: widget.onEditUserMessage,
    onScrollPersist: widget.onScrollPersist,
    initialScrollOffset: widget.initialScrollOffset,
    initialFollowMode: widget.initialFollowMode,
  );
}

class _TurnView extends StatelessWidget {
  const _TurnView({required this.turn, this.onEditUserMessage});
  final Turn turn;
  final ValueChanged<String>? onEditUserMessage;

  /// Horizontal inset shared with the inner widgets so system / user rows
  /// align with the rest of the transcript.
  static const double _contentInset = 16;

  Future<void> _showUserActions(BuildContext context, String message) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.copy_outlined),
              title: const Text('Copy prompt'),
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: message));
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
              },
            ),
            if (onEditUserMessage != null)
              ListTile(
                key: const Key('edit-user-message-as-draft'),
                leading: const Icon(Icons.edit_outlined),
                title: const Text('Edit as new draft'),
                subtitle: const Text('Nothing is sent automatically'),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  onEditUserMessage!(message);
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    if (turn is AssistantTurn) {
      final assistant = turn as AssistantTurn;
      final statusLabel = assistant.completedWithNoResponse
          ? 'Completed with no response'
          : assistant.status.name;
      return Semantics(
        container: true,
        liveRegion: assistant.isTerminal,
        label: 'Assistant turn $statusLabel',
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: PiSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final item in assistant.items)
                if (item is ReasoningItem)
                  ReasoningBlock.forViewData(
                    item.viewData,
                    key: ValueKey(item.widgetKey),
                  )
                else if (item is ToolItem)
                  ToolCard.forViewData(
                    item.viewData,
                    key: ValueKey(item.widgetKey),
                  )
                else if (item is FinalAnswerItem)
                  FinalAnswerView.forViewData(
                    item.viewData,
                    key: ValueKey(item.widgetKey),
                  )
                else if (item is UnknownItem)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: _contentInset,
                    ),
                    child: ListTile(
                      key: ValueKey(item.widgetKey),
                      leading: const Icon(Icons.extension),
                      title: const Text('Other event'),
                      subtitle: Text(
                        item.diagnostic.previewJson ?? item.diagnostic.detail,
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  _contentInset,
                  PiSpacing.sm,
                  _contentInset,
                  PiSpacing.xs,
                ),
                child: Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    statusLabel,
                    key: assistant.completedWithNoResponse
                        ? Key('assistant-no-response-${assistant.turnId}')
                        : null,
                    style: text.labelSmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }
    if (turn is UserTurn) {
      final user = turn as UserTurn;
      final message = user.message ?? 'Prompt';
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: _contentInset,
          vertical: PiSpacing.sm,
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(PiRadius.md),
          onLongPress: () => _showUserActions(context, message),
          child: ListTile(
            leading: const Icon(Icons.person_outline),
            title: Text(message),
            subtitle: Text('You · ${user.deliveryMode} · ${user.status.name}'),
          ),
        ),
      );
    }
    final system = turn as SystemTurn;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: _contentInset,
        vertical: PiSpacing.sm,
      ),
      child: ListTile(
        leading: const Icon(Icons.info_outline),
        title: Text(system.kind.name.replaceAll('_', ' ')),
        subtitle: Text(system.message),
      ),
    );
  }
}
