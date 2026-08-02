import 'package:flutter/foundation.dart';

import 'pairing_payload.dart';

enum PairingPhase { idle, composing, paired, rejected }

final class PairingFlowController extends ChangeNotifier {
  PairingPhase _phase = PairingPhase.idle;
  String _typedEndpoint = '';
  String _typedPasscode = '';
  String? _typedEndpointError;
  String? _typedPasscodeError;
  PairingPayload? _candidate;
  PairingRejection? _rejection;
  String _rejectionDetail = '';

  PairingPhase get phase => _phase;
  String get typedEndpoint => _typedEndpoint;
  String get typedPasscode => _typedPasscode;
  String? get typedEndpointError => _typedEndpointError;
  String? get typedPasscodeError => _typedPasscodeError;
  PairingPayload? get candidate => _candidate;
  PairingRejection? get rejection => _rejection;
  String get rejectionDetail => _rejectionDetail;

  void updateTypedEndpoint(String text) {
    _typedEndpoint = text;
    _typedEndpointError = null;
    if (_phase == PairingPhase.idle) _phase = PairingPhase.composing;
    notifyListeners();
  }

  void updateTypedPasscode(String text) {
    _typedPasscode = text;
    _typedPasscodeError = null;
    if (_phase == PairingPhase.idle) _phase = PairingPhase.composing;
    notifyListeners();
  }

  bool submit() {
    try {
      _candidate = validatePairingInput(
        endpoint: _typedEndpoint,
        passcode: _typedPasscode,
      );
    } on PairingValidationFailure catch (error) {
      _candidate = null;
      _rejection = error.reason;
      _rejectionDetail = error.toString();
      if (error.reason == PairingRejection.emptyEndpoint ||
          error.reason == PairingRejection.malformedEndpoint ||
          error.reason == PairingRejection.nonHttps ||
          error.reason == PairingRejection.notMagicDns ||
          error.reason == PairingRejection.portNotAllowed ||
          error.reason == PairingRejection.userInfoNotAllowed ||
          error.reason == PairingRejection.pathQueryFragmentNotAllowed) {
        _typedEndpointError = error.reason.technicalReason;
      } else {
        _typedPasscodeError = error.reason.technicalReason;
      }
      _phase = PairingPhase.rejected;
      notifyListeners();
      return false;
    }
    _rejection = null;
    _rejectionDetail = '';
    _typedEndpointError = null;
    _typedPasscodeError = null;
    _phase = PairingPhase.composing;
    notifyListeners();
    return true;
  }

  void confirm() {
    if (_candidate == null) return;
    _phase = PairingPhase.paired;
    notifyListeners();
  }

  void reset() {
    _candidate = null;
    _rejection = null;
    _rejectionDetail = '';
    _typedEndpoint = '';
    _typedPasscode = '';
    _typedEndpointError = null;
    _typedPasscodeError = null;
    _phase = PairingPhase.idle;
    notifyListeners();
  }
}
