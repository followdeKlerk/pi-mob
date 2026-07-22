import 'package:flutter/foundation.dart';

@immutable
class GitCommitData {
  const GitCommitData({required this.sha, required this.authoredAt, required this.url, this.message, this.author});
  final String sha;
  final String authoredAt;
  final String url;
  final String? message;
  final String? author;
}

@immutable
class GitSummaryData {
  const GitSummaryData({required this.workspaceId, required this.revision, required this.repositoryUrl, required this.repository, required this.detached, required this.branch, required this.workingTreeState, required this.changedCount, required this.ahead, required this.behind, required this.latestCommit, required this.ciState, required this.failedChecks, required this.supportedActions, required this.lastRefreshedAt});
  final String workspaceId, revision, repositoryUrl, repository;
  final bool detached;
  final String? branch;
  final String workingTreeState;
  final int changedCount, ahead, behind;
  final GitCommitData latestCommit;
  final String ciState;
  final List<GitCheckData> failedChecks;
  final List<String> supportedActions;
  final String lastRefreshedAt;

  bool get canCommit => supportedActions.contains('commit_through_pi');
  bool get canPush => supportedActions.contains('push_through_pi');
  factory GitSummaryData.fromJson(Map<String, Object?> json) {
    Map<String, Object?> map(Object? value) => value is Map ? Map<String, Object?>.from(value) : <String, Object?>{};
    final commit = map(json['latestCommit']);
    return GitSummaryData(
      workspaceId: json['workspaceId']?.toString() ?? '', revision: json['revision']?.toString() ?? '', repositoryUrl: json['repositoryUrl']?.toString() ?? '', repository: json['repository']?.toString() ?? '', detached: json['detached'] == true, branch: json['branch'] as String?, workingTreeState: json['workingTreeState']?.toString() ?? 'unknown', changedCount: _int(json['changedCount']), ahead: _int(json['ahead']), behind: _int(json['behind']),
      latestCommit: GitCommitData(sha: commit['sha']?.toString() ?? '', authoredAt: commit['authoredAt']?.toString() ?? '', url: commit['url']?.toString() ?? '', message: commit['message'] as String?, author: commit['author'] as String?),
      ciState: map(json['ciStatus'])['state']?.toString() ?? 'unknown', failedChecks: (json['failedChecks'] is List ? (json['failedChecks'] as List) : const []).whereType<Map>().map((e) => GitCheckData.fromJson(Map<String, Object?>.from(e))).toList(growable: false), supportedActions: (json['supportedActions'] is List ? (json['supportedActions'] as List) : const []).whereType<String>().toList(growable: false), lastRefreshedAt: json['lastRefreshedAt']?.toString() ?? '',
    );
  }
  static int _int(Object? value) => value is num ? value.toInt() : 0;
}

@immutable
class GitCheckData {
  const GitCheckData({required this.name, required this.status, this.summary, this.logSummary, this.url});
  final String name, status;
  final String? summary, logSummary, url;
  factory GitCheckData.fromJson(Map<String, Object?> json) => GitCheckData(name: json['name']?.toString() ?? '', status: json['status']?.toString() ?? 'unknown', summary: json['summary'] as String?, logSummary: json['logSummary'] as String?, url: json['url'] as String?);
}

@immutable
class GitUnavailableData {
  const GitUnavailableData({required this.workspaceId, required this.reason, required this.message});
  final String workspaceId, reason, message;
}

@immutable
class GitState {
  const GitState({this.summary, this.unavailable, this.refreshing = false});
  final GitSummaryData? summary;
  final GitUnavailableData? unavailable;
  final bool refreshing;
  GitState copyWith({GitSummaryData? summary, GitUnavailableData? unavailable, bool? refreshing}) => GitState(summary: summary ?? this.summary, unavailable: unavailable ?? this.unavailable, refreshing: refreshing ?? this.refreshing);
}

GitState reduceGit(GitState state, String type, Map<String, Object?> payload) {
  if (type == 'git.summary' || type == 'git.summary.result') return GitState(summary: GitSummaryData.fromJson(payload), refreshing: false);
  if (type == 'git.unavailable') return GitState(unavailable: GitUnavailableData(workspaceId: payload['workspaceId']?.toString() ?? '', reason: (payload['status'] is Map ? (payload['status'] as Map)['reason']?.toString() : null) ?? payload['reason']?.toString() ?? 'unavailable', message: (payload['status'] is Map ? (payload['status'] as Map)['message']?.toString() : null) ?? payload['message']?.toString() ?? 'Git is unavailable'), refreshing: false);
  if (type == 'git.summary.request') return state.copyWith(refreshing: true);
  return state;
}

bool isSafeGitExternalUrl(String value) {
  final uri = Uri.tryParse(value);
  return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty && uri.userInfo.isEmpty && uri.fragment.isEmpty && !RegExp(r'[\u0000-\u0020\u007f]').hasMatch(value);
}
