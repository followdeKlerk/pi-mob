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
    super.key,
  });

  final TranscriptDocument document;
  final ValueChanged<String>? onEditUserMessage;

  @override
  State<TranscriptView> createState() => _TranscriptViewState();
}

class _TranscriptViewState extends State<TranscriptView> {
  final ScrollController _controller = ScrollController();
  bool _nearLatest = true;
  bool _pendingFollow = true;
  bool _initialPosition = true;
  bool _autoFollowing = false;
  int _followGeneration = 0;
  int _unread = 0;

  static const double _followThreshold = 48;
  static const double _leaveThreshold = 96;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
  }

  @override
  void didUpdateWidget(covariant TranscriptView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.document.streamId != oldWidget.document.streamId) {
      _nearLatest = true;
      _pendingFollow = true;
      _initialPosition = true;
      _unread = 0;
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
    final near = _nearLatest
        ? after <= _leaveThreshold
        : after <= _followThreshold;
    if (near == _nearLatest && (!near || _unread == 0)) return;
    setState(() {
      _nearLatest = near;
      if (near) _unread = 0;
    });
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
    if (_pendingFollow) {
      _pendingFollow = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _scrollToLatest();
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
    super.key,
  });

  final String streamId;
  final List<StreamEventState> events;
  final ValueChanged<String>? onEditUserMessage;

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
      return Semantics(
        container: true,
        liveRegion: assistant.isTerminal,
        label: 'Assistant turn ${assistant.status.name}',
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
                    assistant.status.name,
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
