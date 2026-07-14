import 'package:flutter/material.dart';

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
class TranscriptView extends StatefulWidget {
  const TranscriptView({
    required this.document,
    this.onLoadOlder,
    this.hasOlder = false,
    super.key,
  });

  final TranscriptDocument document;
  final Future<void> Function()? onLoadOlder;
  final bool hasOlder;

  @override
  State<TranscriptView> createState() => _TranscriptViewState();
}

class _TranscriptViewState extends State<TranscriptView> {
  final ScrollController _controller = ScrollController();
  bool _nearLatest = true;
  int _unread = 0;
  bool _loadingOlder = false;

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

  Future<void> _loadOlder() async {
    final callback = widget.onLoadOlder;
    if (callback == null || _loadingOlder || !_controller.hasClients) return;
    final oldExtent = _controller.position.maxScrollExtent;
    final oldOffset = _controller.offset;
    setState(() => _loadingOlder = true);
    await callback();
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_controller.hasClients) {
        final delta = _controller.position.maxScrollExtent - oldExtent;
        _controller.jumpTo(oldOffset + delta);
      }
    });
    setState(() => _loadingOlder = false);
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
    final turns = widget.document.turns;
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxHeight < 96) {
          return const Card(child: Center(child: Text('Transcript')));
        }
        return Card(
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
                    child: Text(
                      'Transcript',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (widget.hasOlder)
                    TextButton.icon(
                      key: const Key('load-older-transcript'),
                      onPressed: _loadingOlder ? null : _loadOlder,
                      icon: _loadingOlder
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.history),
                      label: const Text('Load older history'),
                    ),
                  const Divider(height: 1),
                  Expanded(
                    child: turns.isEmpty
                        ? const Center(child: Text('No transcript yet'))
                        : SelectionArea(
                            child: ListView.builder(
                              key: const Key('transcript-list'),
                              controller: _controller,
                              itemCount: turns.length,
                              itemBuilder: (context, index) => RepaintBoundary(
                                key: ValueKey(turns[index].widgetKey),
                                child: _TurnView(turn: turns[index]),
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
    this.onLoadOlder,
    this.hasOlder = false,
    super.key,
  });

  final String streamId;
  final List<StreamEventState> events;
  final Future<void> Function()? onLoadOlder;
  final bool hasOlder;

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
    onLoadOlder: widget.onLoadOlder,
    hasOlder: widget.hasOlder,
  );
}

class _TurnView extends StatelessWidget {
  const _TurnView({required this.turn});
  final Turn turn;

  @override
  Widget build(BuildContext context) {
    if (turn is AssistantTurn) {
      final assistant = turn as AssistantTurn;
      return Semantics(
        container: true,
        liveRegion: assistant.isTerminal,
        label: 'Assistant turn ${assistant.status.name}',
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
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
                  ListTile(
                    key: ValueKey(item.widgetKey),
                    leading: const Icon(Icons.extension),
                    title: const Text('Other event'),
                    subtitle: Text(
                      item.diagnostic.previewJson ?? item.diagnostic.detail,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  assistant.status.name,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ),
            ],
          ),
        ),
      );
    }
    if (turn is UserTurn) {
      final user = turn as UserTurn;
      return ListTile(
        title: const Text('Prompt'),
        subtitle: Text('${user.deliveryMode} · ${user.status.name}'),
      );
    }
    final system = turn as SystemTurn;
    return ListTile(
      leading: const Icon(Icons.info_outline),
      title: Text(system.kind.name.replaceAll('_', ' ')),
      subtitle: Text(system.message),
    );
  }
}
