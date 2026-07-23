import 'package:flutter/foundation.dart';

const _maxPlanIdLength = 128;
const _maxStepIdLength = 128;
const _maxStepTitleLength = 128;
const _maxBlockerLength = 240;
const _maxSourceLength = 128;

const _planStepStatuses = <String>{
  'pending',
  'running',
  'completed',
  'blocked',
  'skipped',
};

const _planUnavailableStates = <String>{
  'advertised',
  'unavailable',
  'stale',
  'error',
};

@immutable
class PlanStepData {
  const PlanStepData({
    required this.stepId,
    required this.title,
    required this.status,
    this.blocker,
  });
  final String stepId;
  final String title;
  final String status;
  final String? blocker;

  bool get isTerminal => status == 'completed' || status == 'skipped';
}

@immutable
class PlanSnapshotData {
  const PlanSnapshotData({
    required this.planId,
    required this.revision,
    required this.sessionId,
    required this.turnId,
    required this.source,
    required this.stale,
    required this.steps,
    required this.lastRefreshedAt,
  });
  final String planId;
  final String revision;
  final String sessionId;
  final String turnId;
  final String source;
  final bool stale;
  final List<PlanStepData> steps;
  final String? lastRefreshedAt;

  bool get isCompleted => steps.isNotEmpty && steps.every((s) => s.isTerminal);

  static PlanSnapshotData? tryParse(Map<String, Object?> payload) {
    final planId = _boundedString(
      payload['planId'],
      maxLength: _maxPlanIdLength,
    );
    final revision = _revisionToken(payload['revision']);
    final sessionId = _uuidString(payload['sessionId']);
    final turnId = _boundedString(payload['turnId'], maxLength: 128);
    final source = _boundedString(
      payload['source'],
      maxLength: _maxSourceLength,
    );
    final staleValue = payload['stale'];
    final capability = payload['capability'];
    final stepsRaw = payload['steps'];
    final lastRefreshedAt = _isoUtcString(payload['lastRefreshedAt']);

    if (planId == null ||
        revision == null ||
        sessionId == null ||
        turnId == null ||
        source == null ||
        staleValue is! bool ||
        capability is! Map ||
        stepsRaw is! List ||
        stepsRaw.length > 64) {
      return null;
    }
    final cap = Map<String, Object?>.from(capability);
    if (cap['state'] != 'available') return null;
    if (cap['source'] is String &&
        (cap['source'] as String).length > _maxSourceLength)
      return null;

    final steps = <PlanStepData>[];
    for (final item in stepsRaw) {
      if (item is! Map) return null;
      final map = Map<String, Object?>.from(item);
      final stepId = _boundedString(map['stepId'], maxLength: _maxStepIdLength);
      final title = _boundedString(
        map['title'],
        maxLength: _maxStepTitleLength,
      );
      final status = map['status'];
      if (stepId == null ||
          title == null ||
          status is! String ||
          !_planStepStatuses.contains(status)) {
        return null;
      }
      final blocker = map['blocker'] == null
          ? null
          : _boundedString(map['blocker'], maxLength: _maxBlockerLength);
      steps.add(
        PlanStepData(
          stepId: stepId,
          title: title,
          status: status,
          blocker: blocker,
        ),
      );
    }
    return PlanSnapshotData(
      planId: planId,
      revision: revision,
      sessionId: sessionId,
      turnId: turnId,
      source: source,
      stale: staleValue,
      steps: List<PlanStepData>.unmodifiable(steps),
      lastRefreshedAt: lastRefreshedAt,
    );
  }
}

@immutable
class PlanUnavailableData {
  const PlanUnavailableData({
    required this.reason,
    required this.message,
    required this.remediation,
  });
  final String reason;
  final String message;
  final String? remediation;

  static PlanUnavailableData? tryParse(Map<String, Object?> payload) {
    if (payload['capability'] != 'plans.v1') return null;
    final status = payload['status'];
    if (status is! Map) return null;
    final map = Map<String, Object?>.from(status);
    final state = map['state'];
    if (state is! String || !_planUnavailableStates.contains(state))
      return null;
    final reason = state == 'available' ? 'advertised' : state;
    if (state == 'available') {
      final message = map['reason'] is String
          ? map['reason'] as String
          : 'Plans are available';
      return PlanUnavailableData(
        reason: reason,
        message: message,
        remediation: map['remediation'] is String
            ? map['remediation'] as String
            : null,
      );
    }
    final reasonStr = map['reason'];
    final remediationStr = map['remediation'];
    if (reasonStr is! String || remediationStr is! String) return null;
    return PlanUnavailableData(
      reason: reason,
      message: reasonStr,
      remediation: remediationStr,
    );
  }
}

@immutable
class PlanState {
  const PlanState({this.snapshot, this.unavailable, this.refreshing = false});
  final PlanSnapshotData? snapshot;
  final PlanUnavailableData? unavailable;
  final bool refreshing;

  PlanState copyWith({
    PlanSnapshotData? snapshot,
    PlanUnavailableData? unavailable,
    bool? refreshing,
  }) {
    return PlanState(
      snapshot: snapshot ?? this.snapshot,
      unavailable: unavailable ?? this.unavailable,
      refreshing: refreshing ?? this.refreshing,
    );
  }
}

PlanState reducePlan(
  PlanState state,
  String type,
  Map<String, Object?> payload,
) {
  if (type == 'plan.snapshot' || type == 'plan.snapshot.result') {
    final snapshot = PlanSnapshotData.tryParse(payload);
    return snapshot != null
        ? PlanState(snapshot: snapshot, unavailable: null, refreshing: false)
        : PlanState(
            snapshot: null,
            unavailable: const PlanUnavailableData(
              reason: 'invalid_payload',
              message: 'Plan snapshot payload was invalid',
              remediation:
                  'Refresh after the host publishes a valid R2 plan snapshot.',
            ),
            refreshing: false,
          );
  }
  if (type == 'plan.unavailable') {
    final unavailable = PlanUnavailableData.tryParse(payload);
    return PlanState(
      snapshot: null,
      unavailable:
          unavailable ??
          const PlanUnavailableData(
            reason: 'invalid_payload',
            message: 'Plan unavailable payload was invalid',
            remediation:
                'Refresh after the host publishes a valid R2 plan unavailable payload.',
          ),
      refreshing: false,
    );
  }
  if (type == 'plan.summary.request') return state.copyWith(refreshing: true);
  return state;
}

String? _boundedString(Object? value, {required int maxLength}) {
  if (value is! String || value.isEmpty || value.length > maxLength)
    return null;
  return value;
}

String? _revisionToken(Object? value) {
  return value is String && value.isNotEmpty && value.length <= 128
      ? value
      : null;
}

String? _uuidString(Object? value) {
  if (value is! String) return null;
  final pattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  );
  return pattern.hasMatch(value) ? value : null;
}

String? _isoUtcString(Object? value) {
  if (value is! String) return null;
  return RegExp(
        r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$',
      ).hasMatch(value)
      ? value
      : null;
}
