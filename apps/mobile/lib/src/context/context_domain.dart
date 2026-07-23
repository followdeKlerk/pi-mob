import 'package:flutter/foundation.dart';

/// R4 — Closed set of model providers the inspector can render. The
/// schema (F0) is permissive about provider text; the inspector only
/// needs to know whether the field is present to render a row.
const _maxProviderLength = 128;
const _maxModelIdLength = 128;
const _maxInstructionsLength = 4096;
const _maxPinnedPathLength = 512;
const _maxRevisionLength = 128;
const _maxCapabilitySourceLength = 128;
const _maxContextSourceIdLength = 128;
const _maxContextSourceKindLength = 32;
const _maxContextSourceSummary = 240;
const _maxThinkingLevelLength = 32;

const _tokenUsageDigitsPattern = r'^(0|[1-9][0-9]{0,15})$';
final _tokenUsageDigitsRegExp = RegExp(_tokenUsageDigitsPattern);

const _uuidPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
final _uuidRegExp = RegExp(_uuidPattern);

const _isoUtcPattern =
    r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$';
final _isoUtcRegExp = RegExp(_isoUtcPattern);

/// R4 — A single pinned file row on the inspector.
@immutable
class ContextPinnedFile {
  const ContextPinnedFile({
    required this.path,
    required this.pinnedAt,
    required this.revision,
    this.ranges,
  });
  final String path;
  final String pinnedAt;
  final String revision;
  final List<ContextLineRange>? ranges;

  bool get isFullFile => ranges == null || ranges!.isEmpty;
}

/// R4 — A closed 1-based inclusive line range.
@immutable
class ContextLineRange {
  const ContextLineRange({required this.startLine, required this.endLine});
  final int startLine;
  final int endLine;

  bool get isSingleLine => startLine == endLine;
}

/// R4 — The closed `ContextSource` schema row.
@immutable
class ContextSource {
  const ContextSource({
    required this.sourceId,
    required this.sourceKind,
    required this.summary,
    required this.stale,
    required this.capability,
    this.revision,
    this.lastRefreshedAt,
  });
  final String sourceId;
  final String sourceKind;
  final String summary;
  final bool stale;
  final ContextCapability capability;
  final String? revision;
  final String? lastRefreshedAt;
}

/// R4 — Capability envelope mirror of `CapabilityStatusSchema`. Closed
/// shape: every variant carries `state`; only the `available` variant
/// is allowed without `reason`/`remediation`; the other three require
/// truthful reason/remediation text.
@immutable
class ContextCapability {
  const ContextCapability({
    required this.state,
    this.reason,
    this.remediation,
    this.source,
    this.revision,
    this.lastRefreshedAt,
  });
  final String state;
  final String? reason;
  final String? remediation;
  final String? source;
  final String? revision;
  final String? lastRefreshedAt;

  static const ContextCapability unavailable = ContextCapability(
    state: 'unavailable',
  );
}

/// R4 — Token-usage telemetry. Token counts are canonical decimal
/// STRINGS per F0 so JS Number precision loss is impossible.
@immutable
class ContextTokenUsage {
  const ContextTokenUsage({
    required this.inputTokens,
    required this.outputTokens,
    this.cacheReadTokens,
    this.cacheWriteTokens,
    this.contextWindowTokens,
    this.usagePercent,
  });
  final String inputTokens;
  final String outputTokens;
  final String? cacheReadTokens;
  final String? cacheWriteTokens;
  final String? contextWindowTokens;
  final double? usagePercent;
}

/// R4 — Closed `ContextSnapshot` projection.
@immutable
class ContextSnapshotData {
  const ContextSnapshotData({
    required this.sessionId,
    required this.revision,
    required this.source,
    required this.stale,
    required this.lastRefreshedAt,
    this.model,
    this.thinkingLevel,
    this.instructions,
    this.pinnedFiles,
    this.tokenUsage,
    this.compacted,
    this.compactRevision,
    this.compactedAt,
    this.sources,
  });

  final String sessionId;
  final String revision;
  final String source;
  final bool stale;
  final String lastRefreshedAt;
  final ContextModel? model;
  final String? thinkingLevel;
  final String? instructions;
  final List<ContextPinnedFile>? pinnedFiles;
  final ContextTokenUsage? tokenUsage;
  final bool? compacted;
  final String? compactRevision;
  final String? compactedAt;
  final List<ContextSource>? sources;

  static ContextSnapshotData? tryParse(Map<String, Object?> payload) {
    final sessionId = payload['sessionId'];
    final revision = payload['revision'];
    final source = payload['source'];
    final stale = payload['stale'];
    final lastRefreshedAt = payload['lastRefreshedAt'];
    final capability = payload['capability'];
    if (sessionId is! String || !_uuidRegExp.hasMatch(sessionId)) return null;
    if (revision is! String ||
        revision.isEmpty ||
        revision.length > _maxRevisionLength)
      return null;
    if (source is! String ||
        source.isEmpty ||
        source.length > _maxCapabilitySourceLength)
      return null;
    if (stale is! bool) return null;
    if (lastRefreshedAt is! String || !_isoUtcRegExp.hasMatch(lastRefreshedAt))
      return null;
    if (capability is! Map) return null;
    final cap = Map<String, Object?>.from(capability);
    if (cap['state'] != 'available') return null;

    ContextModel? model;
    final rawModel = payload['model'];
    if (rawModel is Map) {
      final map = Map<String, Object?>.from(rawModel);
      final provider = map['provider'];
      final modelId = map['modelId'];
      if (provider is String &&
          provider.isNotEmpty &&
          provider.length <= _maxProviderLength &&
          modelId is String &&
          modelId.isNotEmpty &&
          modelId.length <= _maxModelIdLength) {
        model = ContextModel(provider: provider, modelId: modelId);
      } else {
        return null;
      }
    }

    String? thinkingLevel;
    final rawThinking = payload['thinkingLevel'];
    if (rawThinking is String) {
      if (rawThinking.isEmpty || rawThinking.length > _maxThinkingLevelLength)
        return null;
      thinkingLevel = rawThinking;
    }

    String? instructions;
    final rawInstructions = payload['instructions'];
    if (rawInstructions is String) {
      if (rawInstructions.length > _maxInstructionsLength) return null;
      instructions = rawInstructions;
    }

    List<ContextPinnedFile>? pinnedFiles;
    final rawPinned = payload['pinnedFiles'];
    if (rawPinned is List) {
      if (rawPinned.length > 64) return null;
      final out = <ContextPinnedFile>[];
      for (final entry in rawPinned) {
        if (entry is! Map) return null;
        final m = Map<String, Object?>.from(entry);
        final path = m['path'];
        final pinnedAt = m['pinnedAt'];
        final rev = m['revision'];
        if (path is! String ||
            path.isEmpty ||
            path.length > _maxPinnedPathLength)
          return null;
        if (pinnedAt is! String || !_isoUtcRegExp.hasMatch(pinnedAt))
          return null;
        if (rev is! String || rev.isEmpty || rev.length > _maxRevisionLength)
          return null;
        List<ContextLineRange>? ranges;
        final rawRanges = m['ranges'];
        if (rawRanges is List) {
          if (rawRanges.length > 16) return null;
          final built = <ContextLineRange>[];
          for (final r in rawRanges) {
            if (r is! Map) return null;
            final rm = Map<String, Object?>.from(r);
            final start = rm['startLine'];
            final end = rm['endLine'];
            if (start is! int || end is! int || start < 1 || end < start)
              return null;
            built.add(ContextLineRange(startLine: start, endLine: end));
          }
          ranges = List.unmodifiable(built);
        }
        out.add(
          ContextPinnedFile(
            path: path,
            pinnedAt: pinnedAt,
            revision: rev,
            ranges: ranges,
          ),
        );
      }
      pinnedFiles = List.unmodifiable(out);
    }

    ContextTokenUsage? tokenUsage;
    final rawUsage = payload['tokenUsage'];
    if (rawUsage is Map) {
      final map = Map<String, Object?>.from(rawUsage);
      final input = map['inputTokens'];
      final output = map['outputTokens'];
      if (input is! String || !_tokenUsageDigitsRegExp.hasMatch(input))
        return null;
      if (output is! String || !_tokenUsageDigitsRegExp.hasMatch(output))
        return null;
      String? optional(Object? value) =>
          value is String && _tokenUsageDigitsRegExp.hasMatch(value)
          ? value
          : null;
      double? percent;
      final rawPercent = map['usagePercent'];
      if (rawPercent is num) {
        final v = rawPercent.toDouble();
        if (v < 0 || v > 1) return null;
        percent = v;
      } else if (rawPercent != null) {
        return null;
      }
      tokenUsage = ContextTokenUsage(
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: optional(map['cacheReadTokens']),
        cacheWriteTokens: optional(map['cacheWriteTokens']),
        contextWindowTokens: optional(map['contextWindowTokens']),
        usagePercent: percent,
      );
    }

    bool? compacted;
    final rawCompacted = payload['compacted'];
    if (rawCompacted is bool) compacted = rawCompacted;

    String? compactRevision;
    final rawCompactRevision = payload['compactRevision'];
    if (rawCompactRevision is String) {
      if (rawCompactRevision.isEmpty ||
          rawCompactRevision.length > _maxRevisionLength)
        return null;
      compactRevision = rawCompactRevision;
    }

    String? compactedAt;
    final rawCompactedAt = payload['compactedAt'];
    if (rawCompactedAt is String) {
      if (!_isoUtcRegExp.hasMatch(rawCompactedAt)) return null;
      compactedAt = rawCompactedAt;
    }

    List<ContextSource>? sources;
    final rawSources = payload['sources'];
    if (rawSources is List) {
      if (rawSources.length > 64) return null;
      final out = <ContextSource>[];
      for (final entry in rawSources) {
        if (entry is! Map) return null;
        final m = Map<String, Object?>.from(entry);
        final sourceId = m['sourceId'];
        final sourceKind = m['sourceKind'];
        final summary = m['summary'];
        final staleSource = m['stale'];
        final cap = m['capability'];
        if (sourceId is! String ||
            sourceId.isEmpty ||
            sourceId.length > _maxContextSourceIdLength)
          return null;
        if (sourceKind is! String ||
            sourceKind.isEmpty ||
            sourceKind.length > _maxContextSourceKindLength)
          return null;
        if (summary is! String || summary.length > _maxContextSourceSummary)
          return null;
        if (staleSource is! bool) return null;
        if (cap is! Map) return null;
        final capMap = Map<String, Object?>.from(cap);
        final state = capMap['state'];
        if (state is! String ||
            !<String>{
              'available',
              'degraded',
              'unavailable',
              'stale',
            }.contains(state))
          return null;
        if (state != 'available') {
          final reason = capMap['reason'];
          final remediation = capMap['remediation'];
          if (reason is! String || reason.isEmpty) return null;
          if (remediation is! String || remediation.isEmpty) return null;
        }
        final rev = m['revision'];
        String? sourceRev;
        if (rev is String) {
          if (rev.isEmpty || rev.length > _maxRevisionLength) return null;
          sourceRev = rev;
        }
        final refreshed = m['lastRefreshedAt'];
        String? lastRefreshed;
        if (refreshed is String) {
          if (!_isoUtcRegExp.hasMatch(refreshed)) return null;
          lastRefreshed = refreshed;
        }
        out.add(
          ContextSource(
            sourceId: sourceId,
            sourceKind: sourceKind,
            summary: summary,
            stale: staleSource,
            capability: ContextCapability(
              state: state,
              reason: capMap['reason'] is String
                  ? capMap['reason'] as String
                  : null,
              remediation: capMap['remediation'] is String
                  ? capMap['remediation'] as String
                  : null,
            ),
            revision: sourceRev,
            lastRefreshedAt: lastRefreshed,
          ),
        );
      }
      sources = List.unmodifiable(out);
    }

    return ContextSnapshotData(
      sessionId: sessionId,
      revision: revision,
      source: source,
      stale: stale,
      lastRefreshedAt: lastRefreshedAt,
      model: model,
      thinkingLevel: thinkingLevel,
      instructions: instructions,
      pinnedFiles: pinnedFiles,
      tokenUsage: tokenUsage,
      compacted: compacted,
      compactRevision: compactRevision,
      compactedAt: compactedAt,
      sources: sources,
    );
  }
}

/// R4 — Truthful no-context surface.
@immutable
class ContextUnavailableData {
  const ContextUnavailableData({
    required this.sessionId,
    required this.reason,
    required this.message,
    required this.remediation,
  });
  final String sessionId;
  final String reason;
  final String message;
  final String remediation;

  static ContextUnavailableData? tryParse(Map<String, Object?> payload) {
    if (payload['capability'] != 'contexts.v1') return null;
    final sessionId = payload['sessionId'];
    if (sessionId is! String || !_uuidRegExp.hasMatch(sessionId)) return null;
    final status = payload['status'];
    if (status is! Map) return null;
    final map = Map<String, Object?>.from(status);
    final state = map['state'];
    if (state is! String ||
        !<String>{'unavailable', 'degraded', 'stale'}.contains(state))
      return null;
    final reason = map['reason'];
    final remediation = map['remediation'];
    if (reason is! String || reason.isEmpty) return null;
    if (remediation is! String || remediation.isEmpty) return null;
    return ContextUnavailableData(
      sessionId: sessionId,
      reason: state,
      message: reason,
      remediation: remediation,
    );
  }
}

/// R4 — Closed `ContextModel` projection.
@immutable
class ContextModel {
  const ContextModel({required this.provider, required this.modelId});
  final String provider;
  final String modelId;
}

/// R4 — Closed projection state for the inspector. Exactly one of
/// `snapshot` / `unavailable` is non-null at a time. `refreshing`
/// tracks the in-flight `context.snapshot.request`.
@immutable
class ContextState {
  const ContextState({
    this.snapshot,
    this.unavailable,
    this.refreshing = false,
    this.lastRequestRevision,
  });
  final ContextSnapshotData? snapshot;
  final ContextUnavailableData? unavailable;
  final bool refreshing;
  final String? lastRequestRevision;

  ContextState copyWith({
    ContextSnapshotData? snapshot,
    ContextUnavailableData? unavailable,
    bool? refreshing,
    String? lastRequestRevision,
    bool clearSnapshot = false,
    bool clearUnavailable = false,
  }) {
    return ContextState(
      snapshot: clearSnapshot ? null : (snapshot ?? this.snapshot),
      unavailable: clearUnavailable ? null : (unavailable ?? this.unavailable),
      refreshing: refreshing ?? this.refreshing,
      lastRequestRevision: lastRequestRevision ?? this.lastRequestRevision,
    );
  }
}

/// R4 — Closed mutation target union mirror.
@immutable
class ContextMutationTarget {
  const ContextMutationTarget.file({
    required this.path,
    this.ranges,
    this.revision,
  }) : sourceId = null;
  const ContextMutationTarget.source({required this.sourceId, this.revision})
    : path = null,
      ranges = null;
  const ContextMutationTarget.all()
    : path = null,
      ranges = null,
      sourceId = null,
      revision = null;

  final String? path;
  final List<ContextLineRange>? ranges;
  final String? revision;
  final String? sourceId;

  String get kind =>
      sourceId != null ? 'source' : (path != null ? 'file' : 'all');

  Map<String, Object?> toJson() {
    if (sourceId != null) {
      return {
        'kind': 'source',
        'sourceId': sourceId,
        if (revision != null) 'revision': revision,
      };
    }
    if (path != null) {
      return {
        'kind': 'file',
        'path': path,
        if (ranges != null)
          'ranges': ranges!
              .map((r) => {'startLine': r.startLine, 'endLine': r.endLine})
              .toList(),
        if (revision != null) 'revision': revision,
      };
    }
    return {'kind': 'all'};
  }
}

/// R4 — Reducer mirroring `reducePlan` / `reduceGit`.
ContextState reduceContext(
  ContextState state,
  String type,
  Map<String, Object?> payload,
) {
  if (type == 'context.snapshot.result' || type == 'context.snapshot') {
    final snapshot = ContextSnapshotData.tryParse(payload);
    if (snapshot != null) {
      return ContextState(
        snapshot: snapshot,
        refreshing: false,
        lastRequestRevision: snapshot.revision,
      );
    }
    return const ContextState(
      unavailable: ContextUnavailableData(
        sessionId: '',
        reason: 'invalid_payload',
        message: 'Context snapshot payload was invalid',
        remediation:
            'Refresh after the host publishes a valid R4 context snapshot.',
      ),
      refreshing: false,
    );
  }
  if (type == 'context.unavailable') {
    final unavailable = ContextUnavailableData.tryParse(payload);
    if (unavailable != null) {
      return ContextState(
        snapshot: null,
        unavailable: unavailable,
        refreshing: false,
      );
    }
    return const ContextState(
      unavailable: ContextUnavailableData(
        sessionId: '',
        reason: 'invalid_payload',
        message: 'Context unavailable payload was invalid',
        remediation:
            'Refresh after the host publishes a valid R4 context unavailable payload.',
      ),
      refreshing: false,
    );
  }
  if (type == 'context.snapshot.request')
    return state.copyWith(refreshing: true);
  return state;
}
