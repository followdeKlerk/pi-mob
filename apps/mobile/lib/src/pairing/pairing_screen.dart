import 'dart:async';

import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'camera_pairing_scanner_view.dart';
import 'manual_endpoint_view.dart';
import 'pairing_confirmation_view.dart';
import 'pairing_flow.dart';
import 'pairing_payload.dart';
import 'pairing_scanner.dart';

/// Callback the screen uses to persist a validated [PairingPayload] and exit
/// pairing. The host persistence lives in the bridge/connection layer; the
/// pairing screen only emits validated values.
typedef PairingSubmit = Future<void> Function(PairingPayload payload);

/// Callback the screen uses when the user explicitly forgets a paired host.
/// The bridge connection layer is responsible for clearing cached state
/// through existing database APIs and returning the app to the unpaired
/// state.
typedef ForgetHostAction = Future<void> Function();

/// Top-level pairing screen. The screen owns the [PairingFlowController] and
/// delegates persistence to the caller through [onPair] and [onForgetHost].
///
/// The screen is wrapped in a [PairingFlowScope] so descendants can resolve
/// the controller via [PairingFlowScope.of]. Listeners rebuild whenever the
/// flow notifies.
class PairingScreen extends StatefulWidget {
  const PairingScreen({
    required this.onPair,
    required this.onForgetHost,
    this.hostIdSuffix,
    this.allowForgetWhenUnpaired = false,
    super.key,
  });

  final PairingSubmit onPair;
  final ForgetHostAction onForgetHost;
  final String? hostIdSuffix;
  final bool allowForgetWhenUnpaired;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  late final PairingFlowController _flow;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _flow = PairingFlowController();
    _flow.addListener(_onFlowChanged);
  }

  void _onFlowChanged() {
    if (!mounted) return;
    setState(() {});
  }

  @override
  void dispose() {
    _flow.removeListener(_onFlowChanged);
    _flow.dispose();
    super.dispose();
  }

  Future<void> _handleConfirm() async {
    final candidate = _flow.candidate;
    if (candidate == null || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.onPair(candidate);
      if (mounted) _flow.confirm();
    } on Object catch (error) {
      _flow.decline();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Pairing failed: $error')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _handleDecline() async {
    _flow.decline();
  }

  Future<void> _handleForget() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onForgetHost();
      _flow.reset();
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Forget failed: $error')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PairingFlowScope(
      controller: _flow,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Pair host'),
          actions: [
            if (widget.allowForgetWhenUnpaired)
              IconButton(
                key: const Key('pairing-forget-from-unpaired'),
                tooltip: 'Forget host',
                onPressed: _busy ? null : _handleForget,
                icon: const Icon(Icons.delete_outline),
              ),
          ],
        ),
        body: SafeArea(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: _buildBody(),
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_flow.phase) {
      case PairingPhase.awaitingConfirmation:
        final candidate = _flow.candidate;
        if (candidate == null) {
          return const _SourceSelector(key: ValueKey('pairing-selector'));
        }
        return PairingConfirmationView(
          key: const ValueKey('pairing-confirmation'),
          payload: candidate,
          hostIdSuffixOverride: widget.hostIdSuffix,
          onConfirm: _handleConfirm,
          onDecline: _handleDecline,
        );
      case PairingPhase.rejected:
        return _RejectionPanel(
          key: const ValueKey('pairing-rejected'),
          reason: _flow.rejection,
          detail: _flow.rejectionDetail,
          typedJsonError: _flow.typedJsonError,
          typedEndpointError: _flow.typedEndpointError,
          onRetry: _handleDecline,
          onForget: widget.allowForgetWhenUnpaired ? _handleForget : null,
        );
      case PairingPhase.composing:
      case PairingPhase.waitingForScan:
      case PairingPhase.validating:
      case PairingPhase.paired:
      case PairingPhase.unsupported:
      case PairingPhase.idle:
        return _SourceSelector(
          key: ValueKey('pairing-selector-${_flow.source.name}-$_busy'),
        );
    }
  }
}

class _SourceSelector extends StatelessWidget {
  const _SourceSelector({super.key});

  @override
  Widget build(BuildContext context) {
    final flow = PairingFlowScope.of(context);
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              tabs: const [
                Tab(icon: Icon(Icons.edit_note), text: 'Manual'),
                Tab(icon: Icon(Icons.qr_code_scanner), text: 'Camera'),
              ],
              onTap: (index) {
                final controller = DefaultTabController.of(context);
                controller.animateTo(index);
                flow.selectSource(
                  index == 0
                      ? PairingInputSource.manual
                      : PairingInputSource.camera,
                );
              },
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _ManualPane(key: const ValueKey('manual-pane')),
                _CameraPane(key: const ValueKey('camera-pane')),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ManualPane extends StatefulWidget {
  const _ManualPane({super.key});

  @override
  State<_ManualPane> createState() => _ManualPaneState();
}

class _ManualPaneState extends State<_ManualPane> {
  late final TextEditingController _jsonController;

  @override
  void initState() {
    super.initState();
    _jsonController = TextEditingController();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final flow = PairingFlowScope.of(context);
    if (!_jsonController.value.composing.isValid &&
        _jsonController.text != flow.typedJson) {
      _jsonController.value = TextEditingValue(
        text: flow.typedJson,
        selection: TextSelection.collapsed(offset: flow.typedJson.length),
      );
    }
  }

  @override
  void dispose() {
    _jsonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final flow = PairingFlowScope.of(context);
    return ListView(
      padding: const EdgeInsets.all(PiSpacing.lg),
      children: [
        Card(
          key: const Key('manual-endpoint-card'),
          child: ManualEndpointView(controller: flow),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(PiSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Or paste QR JSON',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('manual-json-field'),
                  minLines: 3,
                  maxLines: 6,
                  controller: _jsonController,
                  onChanged: flow.updateTypedJson,
                  decoration: InputDecoration(
                    labelText: 'QR JSON payload',
                    border: const OutlineInputBorder(),
                    errorText: flow.typedJsonError,
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                    key: const Key('manual-json-submit'),
                    onPressed: () => flow.submitTypedJson(),
                    icon: const Icon(Icons.send),
                    label: const Text('Validate'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CameraPane extends StatefulWidget {
  const _CameraPane({super.key});

  @override
  State<_CameraPane> createState() => _CameraPaneState();
}

class _CameraPaneState extends State<_CameraPane> {
  // The StreamController is owned by the pane and outlives the view so a
  // detection that races a rebuild does not lose a frame. The pane feeds
  // detected QR text into [source] and listens to the scanner's output
  // stream; the scanner's source is bound to [source] on construction.
  final StreamController<String> _source = StreamController<String>.broadcast();
  late final CameraPairingScanner _scanner;
  StreamSubscription<RawScan>? _subscription;

  @override
  void initState() {
    super.initState();
    _scanner = CameraPairingScanner(source: _source.stream);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_subscription != null) return;
    _scanner.start();
    final flow = PairingFlowScope.of(context);
    _subscription = _scanner.scans.listen(
      (scan) => flow.handleRawScan(scan.payload),
      onError: (Object error, StackTrace stack) {
        // Camera-side errors land on the scanner stream; surface them
        // through the rejection pipeline so the UI can recover via retry.
        flow.handleRawScan('');
      },
    );
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    unawaited(_scanner.dispose());
    unawaited(_source.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CameraPairingScannerView(
      key: const Key('camera-pairing-scanner-view'),
      onRawValue: _source.add,
      previewBuilder: cameraPreviewPlaceholder,
    );
  }
}

/// Placeholder preview used when the real mobile_scanner preview cannot run
/// (e.g. widget tests, desktop builds, missing platform support). It renders
/// a non-interactive icon and label so the camera pane still has the same
/// shape as the production view.
Widget cameraPreviewPlaceholder(
  BuildContext context,
  MobileScannerController controller,
  void Function(BarcodeCapture capture) onDetect,
) {
  final theme = Theme.of(context);
  return ColoredBox(
    color: theme.colorScheme.surfaceContainerHighest,
    child: Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.qr_code_scanner, size: 96),
          const SizedBox(height: 12),
          Text(
            'Camera preview placeholder',
            style: theme.textTheme.titleMedium,
            key: const Key('camera-preview-placeholder-title'),
          ),
        ],
      ),
    ),
  );
}

class _RejectionPanel extends StatelessWidget {
  const _RejectionPanel({
    required this.reason,
    required this.detail,
    required this.typedJsonError,
    required this.typedEndpointError,
    required this.onRetry,
    this.onForget,
    super.key,
  });

  final PairingRejection? reason;
  final String detail;
  final String? typedJsonError;
  final String? typedEndpointError;
  final VoidCallback onRetry;
  final VoidCallback? onForget;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final message =
        typedJsonError ??
        typedEndpointError ??
        reason?.technicalReason ??
        'Pairing input was rejected';
    return Padding(
      padding: const EdgeInsets.all(PiSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(PiSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.warning_amber_rounded,
                        color: theme.colorScheme.onErrorContainer,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Pairing rejected',
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: theme.colorScheme.onErrorContainer,
                          ),
                          key: const Key('pairing-rejection-title'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    message,
                    key: const Key('pairing-rejection-message'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      detail,
                      key: const Key('pairing-rejection-detail'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onErrorContainer,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const Spacer(),
          Row(
            children: [
              if (onForget != null) ...[
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('pairing-rejection-forget'),
                    onPressed: onForget,
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Forget host'),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: FilledButton.icon(
                  key: const Key('pairing-rejection-retry'),
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Try again'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Inherited widget exposing the [PairingFlowController] to descendants so
/// the tab panes can read it without prop drilling.
class PairingFlowScope extends InheritedNotifier<PairingFlowController> {
  const PairingFlowScope({
    required PairingFlowController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static PairingFlowController of(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<PairingFlowScope>();
    assert(scope != null, 'PairingFlowScope.of called without an ancestor');
    return scope!.notifier!;
  }
}
