import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Callback that delivers a single decoded QR raw value to the view's owner.
/// The view performs the QR detection; the owner is responsible for piping
/// the value into its own scanner abstraction (typically a
/// `CameraPairingScanner`).
typedef CameraRawValueCallback = void Function(String rawValue);

/// Builder that produces the camera preview widget. Production callers use
/// [defaultCameraPreviewBuilder], which wraps `mobile_scanner`'s
/// [MobileScanner] widget. Widget tests pass a placeholder that does not
/// require camera hardware.
typedef CameraPreviewBuilder =
    Widget Function(
      BuildContext context,
      MobileScannerController controller,
      void Function(BarcodeCapture capture) onMobileDetect,
    );

/// View that owns the camera lifecycle and emits decoded QR strings to a
/// caller-supplied callback.
///
/// The view deliberately does **not** own a [PairingScanner]. The pairing
/// state machine owns that seam and listens to it directly; the view's job
/// is to bridge the `mobile_scanner` package into a stream of raw QR text.
///
/// Widget tests construct the view with a custom [previewBuilder]
/// (typically a `SizedBox` placeholder) and a fake [onRawValue] that drives
/// a fake source stream. The real `mobile_scanner` integration is only
/// constructed in production callers via the default
/// [defaultCameraPreviewBuilder].
class CameraPairingScannerView extends StatefulWidget {
  const CameraPairingScannerView({
    required this.onRawValue,
    this.controller,
    this.previewBuilder = defaultCameraPreviewBuilder,
    this.onError,
    super.key,
  });

  /// Called once per detected QR code with the raw decoded text. Whitespace
  /// is not trimmed here; the owning scanner is responsible for any
  /// normalisation.
  final CameraRawValueCallback onRawValue;

  /// Optional pre-built controller. When omitted, the view constructs one
  /// with the default mobile_scanner settings. Tests typically supply a
  /// custom [previewBuilder] so the controller is never invoked.
  final MobileScannerController? controller;

  /// Builder that produces the preview widget. Defaults to the
  /// mobile_scanner-backed renderer; widget tests substitute a placeholder.
  final CameraPreviewBuilder previewBuilder;

  /// Optional callback for lifecycle errors (camera unavailable, permission
  /// denied, etc). When provided, the view surfaces a fallback overlay
  /// instead of throwing so the pairing flow can still recover manually.
  final void Function(Object error, StackTrace stack)? onError;

  @override
  State<CameraPairingScannerView> createState() =>
      _CameraPairingScannerViewState();
}

class _CameraPairingScannerViewState extends State<CameraPairingScannerView> {
  late MobileScannerController _controller;
  bool _ownsController = false;
  Object? _lifecycleError;

  @override
  void initState() {
    super.initState();
    final supplied = widget.controller;
    if (supplied != null) {
      _controller = supplied;
      _ownsController = false;
    } else {
      _controller = MobileScannerController(
        formats: const [BarcodeFormat.qrCode],
        detectionSpeed: DetectionSpeed.noDuplicates,
      );
      _ownsController = true;
    }
  }

  void _handleDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null || raw.isEmpty) continue;
      widget.onRawValue(raw);
    }
  }

  @override
  void dispose() {
    if (_ownsController) {
      unawaited(_controller.dispose());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_lifecycleError != null) {
      return _UnsupportedCameraPanel(
        key: const Key('camera-pairing-scanner-unsupported'),
        error: _lifecycleError!,
      );
    }
    return widget.previewBuilder(context, _controller, _handleDetect);
  }
}

/// Default production preview. Wraps [MobileScanner] and surfaces the
/// scanner's exception stream as a fallback overlay so a device without a
/// camera or with permission denied shows a recovery UI instead of
/// crashing.
Widget defaultCameraPreviewBuilder(
  BuildContext context,
  MobileScannerController controller,
  void Function(BarcodeCapture capture) onMobileDetect,
) {
  return MobileScanner(
    controller: controller,
    onDetect: onMobileDetect,
    errorBuilder: (context, error) => _UnsupportedCameraPanel(
      key: const Key('camera-pairing-scanner-error'),
      error: error,
    ),
  );
}

class _UnsupportedCameraPanel extends StatelessWidget {
  const _UnsupportedCameraPanel({required this.error, super.key});

  final Object error;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(PiSpacing.lg),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.no_photography_outlined, size: 96),
            const SizedBox(height: 12),
            Text(
              'Camera unavailable',
              style: theme.textTheme.titleMedium,
              key: const Key('camera-pairing-scanner-unavailable-title'),
            ),
            const SizedBox(height: 8),
            Text(
              'The pairing camera could not start. Use the Manual tab and '
              'type or paste the QR JSON instead.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (kDebugMode) ...[
              const SizedBox(height: 12),
              Text(
                error.toString(),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
