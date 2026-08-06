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
    this.onScrollPersist,
    this.initialScrollOffset,
    this.initialFollowMode,
    super.key,
  });

  final String sessionId;
  final CanonicalSessionManager manager;
  final ValueChanged<String>? onEditUserMessage;
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
    widget.manager.removeListener(_onManagerChanged);
    super.dispose();
  }

  void _bootstrap() {
    _streamKey = 'session:${widget.sessionId}';
    _refreshDocument();
  }

  void _onManagerChanged() => _refreshDocument();

  void _refreshDocument() {
    final state = widget.manager.snapshotFor(widget.sessionId);
    final next = state == null
        ? TranscriptDocument.empty(_streamKey)
        : projectCanonicalToDocument(state);
    if (!mounted) {
      // Replay may complete before the widget is mounted. Keep the
      // reconstructed document so the first build does not show an empty
      // transcript until a later live event arrives.
      _document = next;
      return;
    }
    if (next == _document) return;
    setState(() {
      _document = next;
    });
  }

  @override
  Widget build(BuildContext context) => TranscriptView(
    document: _document,
    onEditUserMessage: widget.onEditUserMessage,
    onScrollPersist: widget.onScrollPersist,
    initialScrollOffset: widget.initialScrollOffset,
    initialFollowMode: widget.initialFollowMode,
  );
}
