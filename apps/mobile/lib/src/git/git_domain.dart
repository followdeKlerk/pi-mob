import 'package:flutter/foundation.dart';

const _maxExternalUrlLength = 1024;
const _maxRepositoryLength = 128;
const _maxBranchLength = 128;
const _maxGitCount = 1000000;
const _maxCheckNameLength = 128;
const _maxCheckSummaryLength = 512;
const _maxLogSummaryLength = 4096;
const _maxCommitShaLength = 64;
const _maxCommitMessageLength = 240;
const _maxCommitAuthorLength = 128;
const _maxPullRequestTitleLength = 240;
const _gitCapability = 'git-ci.v1';
const _gitActions = <String>{
  'refresh',
  'commit_through_pi',
  'push_through_pi',
  'open_external',
};
const _gitCiStates = <String>{'success', 'failure', 'pending', 'unknown'};
const _workingTreeStates = <String>{'clean', 'dirty', 'unknown'};
final RegExp _repositoryPattern = RegExp(r'^(?!/)[A-Za-z0-9._:/\-]{1,128}$');
final RegExp _branchPattern = RegExp(
  r'^(?![/.])(?!.*(?:\.\.|@\{))(?!.*//)[A-Za-z0-9._/\-]{1,128}(?<!\.lock)$',
);
final RegExp _shaPattern = RegExp(r'^[0-9a-f]{7,64}$');
final RegExp _isoUtcPattern = RegExp(
  r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$',
);

@immutable
class GitCommitData {
  const GitCommitData({
    required this.sha,
    required this.authoredAt,
    required this.url,
    this.message,
    this.author,
  });
  final String sha;
  final String authoredAt;
  final String url;
  final String? message;
  final String? author;
}

@immutable
class GitPullRequestData {
  const GitPullRequestData({
    required this.number,
    required this.title,
    required this.url,
  });
  final int number;
  final String title;
  final String url;
}

@immutable
class GitCheckData {
  const GitCheckData({
    required this.name,
    required this.status,
    this.summary,
    this.logSummary,
    this.url,
  });
  final String name;
  final String status;
  final String? summary;
  final String? logSummary;
  final String? url;
}

@immutable
class GitSummaryData {
  const GitSummaryData({
    required this.workspaceId,
    required this.revision,
    required this.repositoryUrl,
    required this.repository,
    required this.detached,
    required this.branch,
    required this.workingTreeState,
    required this.changedCount,
    required this.ahead,
    required this.behind,
    required this.latestCommit,
    required this.pullRequest,
    required this.ciState,
    required this.failedChecks,
    required this.supportedActions,
    required this.lastRefreshedAt,
  });

  final String workspaceId;
  final String revision;
  final String repositoryUrl;
  final String repository;
  final bool detached;
  final String? branch;
  final String workingTreeState;
  final int changedCount;
  final int ahead;
  final int behind;
  final GitCommitData latestCommit;
  final GitPullRequestData? pullRequest;
  final String ciState;
  final List<GitCheckData> failedChecks;
  final List<String> supportedActions;
  final String lastRefreshedAt;

  bool get canCommit => supportedActions.contains('commit_through_pi');
  bool get canPush => supportedActions.contains('push_through_pi');

  static GitSummaryData? tryParse(Map<String, Object?> json) {
    final workspaceId = _boundedString(json['workspaceId'], maxLength: 128);
    final revision = _boundedString(json['revision'], maxLength: 128);
    final repositoryUrl = _safeUrl(json['repositoryUrl']);
    final repository = _boundedString(
      json['repository'],
      maxLength: _maxRepositoryLength,
      pattern: _repositoryPattern,
    );
    final detached = json['detached'];
    final workingTreeState = _enumString(
      json['workingTreeState'],
      _workingTreeStates,
    );
    final changedCount = _boundedInt(json['changedCount']);
    final ahead = _boundedInt(json['ahead']);
    final behind = _boundedInt(json['behind']);
    final latestCommit = _parseCommit(json['latestCommit']);
    final ciState = _parseCiState(json['ciStatus']);
    final failedChecks = _parseChecks(json['failedChecks']);
    final supportedActions = _parseActions(json['supportedActions']);
    final capability = json['capability'];
    final lastRefreshedAt = _isoUtcString(json['lastRefreshedAt']);
    if (workspaceId == null ||
        revision == null ||
        repositoryUrl == null ||
        repository == null ||
        detached is! bool ||
        workingTreeState == null ||
        changedCount == null ||
        ahead == null ||
        behind == null ||
        latestCommit == null ||
        ciState == null ||
        failedChecks == null ||
        supportedActions == null ||
        capability != _gitCapability ||
        lastRefreshedAt == null) {
      return null;
    }

    final branch = detached
        ? (json['branch'] == null ? null : null)
        : _boundedString(
            json['branch'],
            maxLength: _maxBranchLength,
            pattern: _branchPattern,
          );
    if ((detached && json['branch'] != null) || (!detached && branch == null)) {
      return null;
    }

    final pullRequest = _parsePullRequest(json['pullRequest']);
    if (json['pullRequest'] != null && pullRequest == null) {
      return null;
    }

    return GitSummaryData(
      workspaceId: workspaceId,
      revision: revision,
      repositoryUrl: repositoryUrl,
      repository: repository,
      detached: detached,
      branch: branch,
      workingTreeState: workingTreeState,
      changedCount: changedCount,
      ahead: ahead,
      behind: behind,
      latestCommit: latestCommit,
      pullRequest: pullRequest,
      ciState: ciState,
      failedChecks: failedChecks,
      supportedActions: supportedActions,
      lastRefreshedAt: lastRefreshedAt,
    );
  }
}

@immutable
class GitUnavailableData {
  const GitUnavailableData({
    required this.workspaceId,
    required this.reason,
    required this.message,
    this.remediation,
  });
  final String workspaceId;
  final String reason;
  final String message;
  final String? remediation;

  static GitUnavailableData? tryParse(Map<String, Object?> payload) {
    final workspaceId = _boundedString(payload['workspaceId'], maxLength: 128);
    final capability = payload['capability'];
    final status = payload['status'];
    if (workspaceId == null || capability != _gitCapability || status is! Map) {
      return null;
    }
    final map = Map<String, Object?>.from(status);
    final state = _boundedString(map['state'], maxLength: 16);
    final reason = _boundedString(
      map['reason'],
      maxLength: _maxCheckSummaryLength,
    );
    final remediation = _optionalBoundedString(
      map['remediation'],
      maxLength: _maxCheckSummaryLength,
    );
    if (state == null) return null;
    if (state == 'available') {
      return GitUnavailableData(
        workspaceId: workspaceId,
        reason: 'available',
        message: reason ?? 'Git is available',
        remediation: remediation,
      );
    }
    if (reason == null || remediation == null) return null;
    return GitUnavailableData(
      workspaceId: workspaceId,
      reason: state,
      message: reason,
      remediation: remediation,
    );
  }
}

@immutable
class GitState {
  const GitState({this.summary, this.unavailable, this.refreshing = false});
  final GitSummaryData? summary;
  final GitUnavailableData? unavailable;
  final bool refreshing;

  GitState copyWith({
    GitSummaryData? summary,
    GitUnavailableData? unavailable,
    bool? refreshing,
  }) => GitState(
    summary: summary ?? this.summary,
    unavailable: unavailable ?? this.unavailable,
    refreshing: refreshing ?? this.refreshing,
  );
}

GitState reduceGit(GitState state, String type, Map<String, Object?> payload) {
  if (type == 'git.summary' || type == 'git.summary.result') {
    final summary = GitSummaryData.tryParse(payload);
    return summary != null
        ? GitState(summary: summary, refreshing: false)
        : GitState(
            unavailable: const GitUnavailableData(
              workspaceId: '',
              reason: 'invalid_payload',
              message: 'Git summary payload was invalid',
              remediation:
                  'Refresh after the host publishes a valid R6 Git summary.',
            ),
            refreshing: false,
          );
  }
  if (type == 'git.unavailable') {
    final unavailable = GitUnavailableData.tryParse(payload);
    return GitState(
      unavailable:
          unavailable ??
          const GitUnavailableData(
            workspaceId: '',
            reason: 'invalid_payload',
            message: 'Git unavailable payload was invalid',
            remediation:
                'Refresh after the host publishes a valid Git unavailable payload.',
          ),
      refreshing: false,
    );
  }
  if (type == 'git.summary.request') return state.copyWith(refreshing: true);
  return state;
}

String? _boundedString(
  Object? value, {
  required int maxLength,
  RegExp? pattern,
}) {
  if (value is! String || value.isEmpty || value.length > maxLength) {
    return null;
  }
  if (pattern != null && !pattern.hasMatch(value)) return null;
  return value;
}

String? _optionalBoundedString(
  Object? value, {
  required int maxLength,
  RegExp? pattern,
}) {
  if (value == null) return null;
  return _boundedString(value, maxLength: maxLength, pattern: pattern);
}

String? _enumString(Object? value, Set<String> allowed) {
  return value is String && allowed.contains(value) ? value : null;
}

int? _boundedInt(Object? value) {
  if (value is! num) return null;
  final result = value.toInt();
  if (result < 0 || result > _maxGitCount) return null;
  return result;
}

String? _isoUtcString(Object? value) {
  return value is String && _isoUtcPattern.hasMatch(value) ? value : null;
}

GitCommitData? _parseCommit(Object? value) {
  if (value is! Map) return null;
  final map = Map<String, Object?>.from(value);
  final sha = _boundedString(
    map['sha'],
    maxLength: _maxCommitShaLength,
    pattern: _shaPattern,
  );
  final authoredAt = _isoUtcString(map['authoredAt']);
  final url = _safeUrl(map['url']);
  final message = _optionalBoundedString(
    map['message'],
    maxLength: _maxCommitMessageLength,
  );
  final author = _optionalBoundedString(
    map['author'],
    maxLength: _maxCommitAuthorLength,
  );
  if (sha == null || authoredAt == null || url == null) return null;
  return GitCommitData(
    sha: sha,
    authoredAt: authoredAt,
    url: url,
    message: message,
    author: author,
  );
}

GitPullRequestData? _parsePullRequest(Object? value) {
  if (value is! Map) return null;
  final map = Map<String, Object?>.from(value);
  final number = map['number'];
  final title = _boundedString(
    map['title'],
    maxLength: _maxPullRequestTitleLength,
  );
  final url = _safeUrl(map['url']);
  if (number is! num || number.toInt() < 1 || title == null || url == null) {
    return null;
  }
  return GitPullRequestData(number: number.toInt(), title: title, url: url);
}

String? _parseCiState(Object? value) {
  if (value is! Map) return null;
  return _enumString(Map<String, Object?>.from(value)['state'], _gitCiStates);
}

List<GitCheckData>? _parseChecks(Object? value) {
  if (value is! List || value.length > 20) return null;
  final checks = <GitCheckData>[];
  for (final item in value) {
    if (item is! Map) return null;
    final map = Map<String, Object?>.from(item);
    final name = _boundedString(map['name'], maxLength: _maxCheckNameLength);
    final status = _enumString(map['status'], _gitCiStates);
    final summary = _optionalBoundedString(
      map['summary'],
      maxLength: _maxCheckSummaryLength,
    );
    final logSummary = _optionalBoundedString(
      map['logSummary'],
      maxLength: _maxLogSummaryLength,
    );
    final url = map['url'] == null ? null : _safeUrl(map['url']);
    if (name == null ||
        status == null ||
        (map['summary'] != null && summary == null) ||
        (map['logSummary'] != null && logSummary == null) ||
        (map['url'] != null && url == null)) {
      return null;
    }
    checks.add(
      GitCheckData(
        name: name,
        status: status,
        summary: summary,
        logSummary: logSummary,
        url: url,
      ),
    );
  }
  return List<GitCheckData>.unmodifiable(checks);
}

List<String>? _parseActions(Object? value) {
  if (value is! List || value.length > _gitActions.length) return null;
  final actions = <String>[];
  for (final item in value) {
    if (item is! String ||
        !_gitActions.contains(item) ||
        actions.contains(item)) {
      return null;
    }
    actions.add(item);
  }
  return List<String>.unmodifiable(actions);
}

bool isSafeGitExternalUrl(String value) {
  if (value.isEmpty ||
      value.length > _maxExternalUrlLength ||
      RegExp(r'[\s\x00-\x1F\x7F]').hasMatch(value)) {
    return false;
  }
  final uri = Uri.tryParse(value);
  if (uri == null ||
      uri.scheme != 'https' ||
      (uri.host.isEmpty && !uri.hasAuthority)) {
    return false;
  }
  return uri.userInfo.isEmpty;
}

String? _safeUrl(Object? value) {
  return value is String && isSafeGitExternalUrl(value) ? value : null;
}
