import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../transcript/domain/transcript_diagnostics.dart';
import '../transcript/domain/transcript_document.dart';
import '../transcript/domain/transcript_turn.dart';
import '../transcript/widgets/transcript_view.dart';
import 'canonical_session_manager.dart';
import 'canonical_transcript_document.dart';

/// Renders a session's canonical transcript.
///
/// The widget bridges the canonical session-event log
/// ([CanonicalTranscriptState]) into the production
/// [TranscriptView] widget via the
/// [projectCanonicalToDocument] adapter. The widget listens to the
/// manager so live canonical events re-render without touching the
/// legacy history/live merge path.
class CanonicalTranscriptView extends StatefulWidget {
  const CanonicalTranscriptView({
    required this.sessionId,
    required this.manager,
    this.onEditUserMessage,
    this.attachmentLoader,
    this.onScrollPersist,
    this.initialScrollOffset,
    this.initialFollowMode,
    super.key,
  });

  final String sessionId;
  final CanonicalSessionManager manager;
  final ValueChanged<String>? onEditUserMessage;
  final Future<Uint8List> Function(String attachmentId)? attachmentLoader;
  final void Function(int offset, bool followMode)? onScrollPersist;
  final int? initialScrollOffset;
  final bool? initialFollowMode;

  @override
  State<CanonicalTranscriptView> createState() =>
      _CanonicalTranscriptViewState();
}

class _CanonicalTranscriptViewState extends State<CanonicalTranscriptView> {
  TranscriptDocument _document = const TranscriptDocument(
    streamId: '',
    turns: <Turn>[],
    diagnostics: <TranscriptDiagnostic>[],
    lastSettledTurnId: null,
  );
  String _streamKey = '';
  final _projection = CanonicalTranscriptProjection();
  int? _lastSequence;
  Timer? _streamRefreshTimer;

  @override
  void initState() {
    super.initState();
    widget.manager.addListener(_onManagerChanged);
    _bootstrap();
  }

  @override
  void didUpdateWidget(covariant CanonicalTranscriptView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.manager != widget.manager) {
      _streamRefreshTimer?.cancel();
      _streamRefreshTimer = null;
      oldWidget.manager.removeListener(_onManagerChanged);
      widget.manager.addListener(_onManagerChanged);
    }
    if (oldWidget.sessionId != widget.sessionId) {
      _bootstrap();
      return;
    }
    _refreshDocument();
  }

  @override
  void dispose() {
    _streamRefreshTimer?.cancel();
    widget.manager.removeListener(_onManagerChanged);
    super.dispose();
  }

  void _bootstrap() {
    _streamRefreshTimer?.cancel();
    _streamRefreshTimer = null;
    _streamKey = 'session:${widget.sessionId}';
    _lastSequence = null;
    _projection.reset();
    _refreshDocument();
  }

  void _onManagerChanged() {
    if (!_isStreaming) {
      _streamRefreshTimer?.cancel();
      _streamRefreshTimer = null;
      _refreshDocument();
      return;
    }
    if (_streamRefreshTimer != null) return;
    // ponytail: cap streamed transcript layouts at 30fps; raise the rate only
    // if physical-device profiling shows the UI has spare frame budget.
    _streamRefreshTimer = Timer(const Duration(milliseconds: 33), () {
      _streamRefreshTimer = null;
      _refreshDocument();
    });
  }

  bool get _isStreaming {
    for (final turn in _document.turns.reversed) {
      if (turn is AssistantTurn) return !turn.isTerminal;
    }
    return false;
  }

  void _refreshDocument() {
    final state = widget.manager.snapshotFor(widget.sessionId);
    if (state != null && state.lastAppliedSequence == _lastSequence) return;
    if (state == null &&
        _document.streamId == _streamKey &&
        _document.isEmpty &&
        _document.diagnostics.isEmpty) {
      return;
    }
    final next = state == null
        ? TranscriptDocument.empty(_streamKey)
        : _projection.project(state);
    _lastSequence = state?.lastAppliedSequence;
    if (state == null) _projection.reset();
    if (!mounted) {
      // Replay may complete before the widget is mounted. Keep the
      // reconstructed document so the first build does not show an empty
      // transcript until a later live event arrives.
      _document = next;
      return;
    }
    setState(() {
      _document = next;
    });
  }

  @override
  Widget build(BuildContext context) => TranscriptView(
    document: _document,
    onEditUserMessage: widget.onEditUserMessage,
    attachmentLoader: widget.attachmentLoader,
    onScrollPersist: widget.onScrollPersist,
    initialScrollOffset: widget.initialScrollOffset,
    initialFollowMode: widget.initialFollowMode,
  );
}
