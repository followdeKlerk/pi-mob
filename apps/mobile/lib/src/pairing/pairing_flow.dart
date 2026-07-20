import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'pairing_payload.dart';
import 'pairing_scanner.dart';

/// Outcome of a pairing attempt.
enum PairingOutcome { initial, awaiting, scanning, confirm, accepted, rejected }

/// Distinct phases of the pairing state machine. The pairing flow is small
/// enough to drive from a single [ChangeNotifier]; the phases are explicit so
/// tests can assert on transitions.
enum PairingPhase {
  /// Nothing has been submitted yet. The screen shows the input selector.
  idle,

  /// Manual typing is in progress. The submit button is enabled only when the
  /// text field has a non-empty value.
  composing,

  /// The flow is waiting for a [RawScan] from the active scanner.
  waitingForScan,

  /// A raw payload was received and is being validated.
  validating,

  /// A valid payload is awaiting user confirmation.
  awaitingConfirmation,

  /// The user confirmed; the host is saved and the flow exits.
  paired,

  /// The payload or endpoint was rejected. The reason is recorded so the UI
  /// can surface a precise message.
  rejected,

  /// The scanner surface is not available (e.g. camera disabled). The flow
  /// remains on the manual tab.
  unsupported,
}

/// Mutable pairing-flow state shared by the pairing screen, the manual
/// endpoint view, and the confirmation view.
///
/// The flow never invokes the bridge; its sole responsibility is producing a
/// validated [PairingPayload] (or a precise rejection) that the host layer
/// can persist.
final class PairingFlowController extends ChangeNotifier {
  PairingFlowController({
    ManualPairingScanner? manualScanner,
    CameraPairingScanner? cameraScanner,
  }) : _manualScanner = manualScanner ?? ManualPairingScanner(),
       _cameraScanner = cameraScanner ?? CameraPairingScanner() {
    _manualSubscription = _manualScanner.scans.listen(_onScan);
  }

  final ManualPairingScanner _manualScanner;
  final CameraPairingScanner _cameraScanner;
  StreamSubscription<RawScan>? _manualSubscription;
  PairingInputSource _source = PairingInputSource.manual;
  PairingPhase _phase = PairingPhase.idle;
  String _typedEndpoint = '';
  String? _typedEndpointError;
  String? _typedJson = '';
  String? _typedJsonError;
  PairingPayload? _candidate;
  PairingRejection? _rejection;
  String _rejectionDetail = '';

  /// The active source tab.
  PairingInputSource get source => _source;

  /// Current pairing phase.
  PairingPhase get phase => _phase;

  /// Last typed endpoint text (manual recovery flow).
  String get typedEndpoint => _typedEndpoint;

  /// Last typed JSON payload (paste flow).
  String get typedJson => _typedJson ?? '';

  /// Inline validation error for the typed endpoint.
  String? get typedEndpointError => _typedEndpointError;

  /// Inline validation error for the typed JSON.
  String? get typedJsonError => _typedJsonError;

  /// Validated candidate awaiting user confirmation.
  PairingPayload? get candidate => _candidate;

  /// Reason the latest payload was rejected.
  PairingRejection? get rejection => _rejection;

  /// Technical detail for the rejection. Suitable for an expandable details
  /// section; never used for the primary user-facing message.
  String get rejectionDetail => _rejectionDetail;

  /// Scanner used for manual JSON/typed submission.
  ManualPairingScanner get manualScanner => _manualScanner;

  /// Scanner stub used for the camera surface. Reserved for the future camera
  /// implementation; tapping the camera surface exposes [phase] as
  /// [PairingPhase.unsupported].
  CameraPairingScanner get cameraScanner => _cameraScanner;

  /// Switch the active source tab. Switching to the camera tab does not
  /// destroy the manual scanner; users can move between tabs without losing
  /// their typed input.
  void selectSource(PairingInputSource next) {
    if (_source == next) return;
    _source = next;
    _clearTransientErrors();
    notifyListeners();
  }

  /// Update the typed manual endpoint text. Empty input is allowed so the
  /// user can clear the field.
  void updateTypedEndpoint(String text) {
    _typedEndpoint = text;
    _typedEndpointError = null;
    if (_phase == PairingPhase.idle) _phase = PairingPhase.composing;
    notifyListeners();
  }

  /// Update the typed JSON payload.
  void updateTypedJson(String text) {
    _typedJson = text;
    _typedJsonError = null;
    if (_phase == PairingPhase.idle) _phase = PairingPhase.composing;
    notifyListeners();
  }

  /// Submit the typed manual endpoint. Performs strict validation through
  /// [validateManualEndpoint]; on success, transitions to
  /// [PairingPhase.awaitingConfirmation] with a synthesized payload whose
  /// hostId is the empty string (it is filled by the bridge hello handshake).
  void submitTypedEndpoint() {
    final text = _typedEndpoint.trim();
    if (text.isEmpty) {
      _typedEndpointError = 'Enter an HTTPS endpoint';
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    Uri endpoint;
    try {
      endpoint = validateManualEndpoint(text);
    } on PairingValidationFailure catch (error) {
      _typedEndpointError = error.reason.technicalReason;
      _rejection = error.reason;
      _rejectionDetail = error.toString();
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    _candidate = PairingPayload(
      kind: 'pi-mob-host',
      version: 1,
      hostId: '',
      displayName: endpoint.host,
      endpoint: endpoint,
      protocolMajor: 1,
    );
    _rejection = null;
    _rejectionDetail = '';
    _typedEndpointError = null;
    _phase = PairingPhase.awaitingConfirmation;
    notifyListeners();
  }

  /// Submit the typed JSON payload. Performs strict validation through
  /// [validatePairingPayload].
  void submitTypedJson() {
    final text = (_typedJson ?? '').trim();
    if (text.isEmpty) {
      _typedJsonError = 'Paste the QR JSON';
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on Object {
      _typedJsonError = 'QR text is not valid JSON';
      _rejection = PairingRejection.malformedEndpoint;
      _rejectionDetail = 'JSON decode failed';
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    try {
      _candidate = validatePairingPayload(decoded);
    } on PairingValidationFailure catch (error) {
      _typedJsonError = error.reason.technicalReason;
      _rejection = error.reason;
      _rejectionDetail = error.toString();
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    _rejection = null;
    _rejectionDetail = '';
    _typedJsonError = null;
    _phase = PairingPhase.awaitingConfirmation;
    notifyListeners();
  }

  /// Push a raw scan payload through the validation pipeline. Used by the
  /// scanner tab; also exposed so widget tests can deliver deterministic
  /// payloads.
  void handleRawScan(String raw) {
    _manualScanner.submit(raw, source: RawScanSource.manual);
  }

  /// Confirm the current [_candidate] and transition the flow to
  /// [PairingPhase.paired]. The host persistence happens through the
  /// [ConnectionCoordinator.forgetHost] / external save APIs.
  void confirm() {
    if (_candidate == null) return;
    _phase = PairingPhase.paired;
    notifyListeners();
  }

  /// Decline the current [_candidate] and return the flow to [PairingPhase.idle].
  void decline() {
    _candidate = null;
    _rejection = null;
    _rejectionDetail = '';
    _phase = PairingPhase.idle;
    notifyListeners();
  }

  /// Reset every transient value. Used after a successful pair so a future
  /// re-pair starts from a clean slate.
  void reset() {
    _candidate = null;
    _rejection = null;
    _rejectionDetail = '';
    _typedEndpointError = null;
    _typedJsonError = null;
    if (_typedJson != null) _typedJson = '';
    _typedEndpoint = '';
    _phase = PairingPhase.idle;
    notifyListeners();
  }

  void _clearTransientErrors() {
    _typedEndpointError = null;
    _typedJsonError = null;
    _rejectionDetail = '';
  }

  void _onScan(RawScan scan) {
    _phase = PairingPhase.validating;
    notifyListeners();
    Object? decoded;
    try {
      decoded = jsonDecode(scan.payload);
    } on Object {
      _rejection = PairingRejection.malformedEndpoint;
      _rejectionDetail = 'QR text is not valid JSON';
      _phase = PairingPhase.rejected;
      notifyListeners();
      return;
    }
    try {
      _candidate = validatePairingPayload(decoded);
      _rejection = null;
      _rejectionDetail = '';
      _phase = PairingPhase.awaitingConfirmation;
    } on PairingValidationFailure catch (error) {
      _candidate = null;
      _rejection = error.reason;
      _rejectionDetail = error.toString();
      _phase = PairingPhase.rejected;
    }
    notifyListeners();
  }

  @override
  void dispose() {
    unawaited(_manualSubscription?.cancel());
    unawaited(_manualScanner.dispose());
    unawaited(_cameraScanner.dispose());
    super.dispose();
  }
}
