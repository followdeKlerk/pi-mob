import 'dart:async';

/// A single raw scan event from a pairing scanner.
///
/// The transport layer is intentionally abstracted so the pairing flow can be
/// driven from:
///   * the camera (mobile_scanner package, wrapped by [CameraPairingScanner]),
///   * an image picker that decodes a QR screenshot,
///   * manual JSON paste for test and recovery flows.
///
/// Only the raw JSON bytes are exchanged; the [PairingPayload] validator is
/// the single source of truth for what counts as a valid pairing envelope.
final class RawScan {
  const RawScan({required this.payload, this.source = RawScanSource.unknown});

  /// JSON text decoded from the QR code or manually entered.
  final String payload;

  /// Origin of the scan. Used for telemetry and accessibility narration.
  final RawScanSource source;
}

enum RawScanSource { manual, camera, image, paste, unknown }

/// Deterministic scanner-input abstraction.
///
/// Implementations may produce a stream of [RawScan] events. The pairing flow
/// is intentionally `Stream<RawScan>`-based so the camera implementation can
/// plug in without changing the flow state machine. Tests use
/// [ManualPairingScanner] or the camera adapter with a fake scan stream.
abstract interface class PairingScanner {
  /// Whether the scanner has any further scans available.
  bool get hasScans;

  /// Stream of raw scans. The stream is single-subscription.
  Stream<RawScan> get scans;

  /// Stop the scanner and release any underlying resources.
  Future<void> dispose();
}

/// Manual pairing scanner used by the typing flow and by widget tests.
///
/// Each call to [submit] enqueues a [RawScan] on [scans]. The scanner is fully
/// deterministic: ordering is preserved and tests do not need to mock timers or
/// async timers.
final class ManualPairingScanner implements PairingScanner {
  ManualPairingScanner();

  final StreamController<RawScan> _controller = StreamController<RawScan>();
  int _count = 0;

  @override
  bool get hasScans => _count > 0;

  @override
  Stream<RawScan> get scans => _controller.stream;

  /// Submit a raw payload. Empty or whitespace-only payloads are ignored so
  /// the UI does not accidentally produce a malformed scan.
  void submit(String payload, {RawScanSource source = RawScanSource.manual}) {
    final trimmed = payload.trim();
    if (trimmed.isEmpty) return;
    _count += 1;
    _controller.add(RawScan(payload: trimmed, source: source));
  }

  @override
  Future<void> dispose() async {
    if (!_controller.isClosed) await _controller.close();
  }
}

/// Camera-backed pairing scanner.
///
/// The scanner is constructed from an injectable [Stream] of raw decoded QR
/// payloads (the JSON text). Widget tests substitute a `StreamController`
/// driven by `submit()`-style helpers; production wires the
/// `mobile_scanner` `MobileScannerController.barcodes` stream into the
/// constructor (see `camera_pairing_scanner_view.dart`).
///
/// The scanner performs three guarantees:
///
///   * The source stream is forwarded verbatim (whitespace-trimmed, empty
///     values dropped) so the QR decoder is the only place that decides
///     "is this a real QR code?".
///   * The output stream is single-subscription, matching the [PairingScanner]
///     contract that the flow state machine relies on.
///   * Disposing the scanner cancels the source subscription and closes the
///     output controller, so widget teardown cannot leak a half-closed
///     stream.
final class CameraPairingScanner implements PairingScanner {
  /// Build a camera scanner that consumes raw QR payloads from [source].
  /// Call [start] to begin forwarding; the call is idempotent.
  CameraPairingScanner({Stream<String>? source})
    : _source = source ?? const Stream<String>.empty();

  /// Backwards-compatible default constructor used by existing call sites
  /// that do not need to inject a source. The scanner emits nothing until
  /// a source is provided and [start] is called.
  CameraPairingScanner.unattached() : _source = const Stream<String>.empty();

  /// Convenience constructor for tests: the source stream is driven by the
  /// supplied [controller], which the caller retains control over (the
  /// scanner does not close it on dispose).
  factory CameraPairingScanner.fromController(
    StreamController<String> controller,
  ) {
    return CameraPairingScanner(source: controller.stream);
  }

  Stream<String> _source;
  StreamSubscription<String>? _subscription;
  final StreamController<RawScan> _controller = StreamController<RawScan>();
  int _count = 0;

  @override
  bool get hasScans => _count > 0;

  @override
  Stream<RawScan> get scans => _controller.stream;

  /// Begin forwarding the source stream to [scans]. Idempotent; repeated
  /// calls without an intervening [dispose] are a no-op so widget rebuilds
  /// cannot accidentally fork the pipeline.
  void start() {
    if (_subscription != null) return;
    _subscription = _source.listen(
      _onSourceValue,
      onError: _onSourceError,
      onDone: _onSourceDone,
    );
  }

  /// Replace the source stream. Intended for tests that need to drive a
  /// scanner across multiple streams; the previous subscription is
  /// cancelled first so no events leak from the old source.
  void setSource(Stream<String> source) {
    final previous = _subscription;
    _subscription = null;
    unawaited(previous?.cancel());
    _source = source;
    start();
  }

  void _onSourceValue(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return;
    if (_controller.isClosed) return;
    _count += 1;
    _controller.add(RawScan(payload: trimmed, source: RawScanSource.camera));
  }

  void _onSourceError(Object error, StackTrace stack) {
    if (_controller.isClosed) return;
    _controller.addError(error, stack);
  }

  void _onSourceDone() {
    if (_controller.isClosed) return;
    _controller.close();
  }

  @override
  Future<void> dispose() async {
    final subscription = _subscription;
    _subscription = null;
    await subscription?.cancel();
    if (!_controller.isClosed) await _controller.close();
  }
}

/// Factory selecting the appropriate scanner for the active source tab.
PairingScanner createPairingScanner(PairingInputSource source) {
  switch (source) {
    case PairingInputSource.manual:
      return ManualPairingScanner();
    case PairingInputSource.camera:
      return CameraPairingScanner();
  }
}

enum PairingInputSource { manual, camera }
