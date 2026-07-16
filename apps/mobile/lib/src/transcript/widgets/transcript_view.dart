import 'package:flutter/material.dart';
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
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
  }

  @override
  void didUpdateWidget(covariant TranscriptView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final added = widget.document.length - oldWidget.document.length;
    if (added <= 0) return;
    if (_nearLatest) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
    } else {
      setState(() => _unread += added);
    }
  }

  void _onScroll() {
    if (!_controller.hasClients) return;
    final near = _controller.position.maxScrollExtent - _controller.offset < 96;
    if (near != _nearLatest) setState(() => _nearLatest = near);
    if (near && _unread != 0) setState(() => _unread = 0);
  }

  void _jumpToLatest() {
    if (!_controller.hasClients) return;
    _controller.jumpTo(_controller.position.maxScrollExtent);
    if (mounted) setState(() => _unread = 0);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  /// Horizontal inset shared with the inner widgets so headings, prose and
  /// tool cards line up consistently.
  static const double _contentInset = 16;

  @override
  Widget build(BuildContext context) {
    final turns = widget.document.turns;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxHeight < 96) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: _contentInset),
            child: Align(
              alignment: Alignment.center,
              child: Text('Transcript', style: text.titleSmall),
            ),
          );
        }
        return ColoredBox(
          color: scheme.surface,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      _contentInset,
                      12,
                      _contentInset,
                      8,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Transcript',
                            style: text.titleSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Divider(
                    height: 1,
                    thickness: 1,
                    color: scheme.outlineVariant,
                  ),
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
                        : SelectionArea(
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
                    onPressed: _jumpToLatest,
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
  List<String> _eventIds = const [];

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
    for (var index = _eventIds.length; index < widget.events.length; index++) {
      _apply(widget.events[index]);
    }
    _eventIds = List<String>.unmodifiable(
      widget.events.map((event) => event.eventId),
    );
  }

  bool _isAppendOnly() {
    if (widget.events.length < _eventIds.length) return false;
    for (var index = 0; index < _eventIds.length; index++) {
      if (widget.events[index].eventId != _eventIds[index]) return false;
    }
    return true;
  }

  void _rebuild() {
    _state = TranscriptReducerState.empty(widget.streamId);
    for (final event in widget.events) {
      _apply(event);
    }
    _eventIds = List<String>.unmodifiable(
      widget.events.map((event) => event.eventId),
    );
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
          padding: const EdgeInsets.symmetric(vertical: 6),
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
                  6,
                  _contentInset,
                  4,
                ),
                child: Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    assistant.status.name,
                    style: text.labelSmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      letterSpacing: 0.4,
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
          vertical: 6,
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
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
        vertical: 6,
      ),
      child: ListTile(
        leading: const Icon(Icons.info_outline),
        title: Text(system.kind.name.replaceAll('_', ' ')),
        subtitle: Text(system.message),
      ),
    );
  }
}
