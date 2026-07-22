import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import 'git_callbacks.dart';
import 'git_domain.dart';

class GitSummaryCard extends StatelessWidget {
  const GitSummaryCard({
    required this.state,
    this.callbacks = const GitCallbacks(),
    super.key,
  });

  final GitState state;
  final GitCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    final unavailable = state.unavailable;
    if (unavailable != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Git unavailable',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(unavailable.message),
              if (unavailable.remediation != null) ...[
                const SizedBox(height: 4),
                Text(unavailable.remediation!),
              ],
              if (callbacks.onRefresh != null) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: callbacks.onRefresh,
                  child: const Text('Try again'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    final summary = state.summary;
    if (summary == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(PiSpacing.lg),
          child: Text('Git status unavailable'),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              summary.repository,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              summary.detached ? 'Detached HEAD' : 'Branch: ${summary.branch}',
            ),
            Text(
              '${summary.workingTreeState} · ${summary.changedCount} changed · ↑${summary.ahead} ↓${summary.behind}',
            ),
            Text('CI: ${summary.ciState}'),
            const SizedBox(height: 12),
            _Section(
              title: 'Latest commit',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    summary.latestCommit.message ?? summary.latestCommit.sha,
                  ),
                  Text(summary.latestCommit.sha),
                  if (summary.latestCommit.author != null)
                    Text(summary.latestCommit.author!),
                  Text(summary.latestCommit.authoredAt),
                  if (callbacks.onOpenExternal != null &&
                      isSafeGitExternalUrl(summary.latestCommit.url))
                    TextButton(
                      onPressed: () =>
                          callbacks.onOpenExternal!(summary.latestCommit.url),
                      child: const Text('Open commit'),
                    ),
                ],
              ),
            ),
            if (summary.pullRequest != null) ...[
              const SizedBox(height: 12),
              _Section(
                title: 'Pull request',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '#${summary.pullRequest!.number} ${summary.pullRequest!.title}',
                    ),
                    if (callbacks.onOpenExternal != null &&
                        isSafeGitExternalUrl(summary.pullRequest!.url))
                      TextButton(
                        onPressed: () =>
                            callbacks.onOpenExternal!(summary.pullRequest!.url),
                        child: const Text('Open pull request'),
                      ),
                  ],
                ),
              ),
            ],
            if (summary.failedChecks.isNotEmpty) ...[
              const SizedBox(height: 12),
              _Section(
                title: 'Failed checks',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final check in summary.failedChecks) ...[
                      Text('${check.name} · ${check.status}'),
                      if (check.summary != null) Text(check.summary!),
                      if (check.logSummary != null) Text(check.logSummary!),
                      if (callbacks.onOpenExternal != null &&
                          check.url != null &&
                          isSafeGitExternalUrl(check.url!))
                        TextButton(
                          onPressed: () =>
                              callbacks.onOpenExternal!(check.url!),
                          child: const Text('Open check'),
                        ),
                      const SizedBox(height: 8),
                    ],
                  ],
                ),
              ),
            ],
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (summary.canCommit && callbacks.onCommitConfirmed != null)
                  FilledButton(
                    onPressed: callbacks.onCommitConfirmed,
                    child: const Text('Commit through Pi'),
                  ),
                if (summary.canPush && callbacks.onPushConfirmed != null)
                  OutlinedButton(
                    onPressed: callbacks.onPushConfirmed,
                    child: const Text('Push through Pi'),
                  ),
                if (callbacks.onRefresh != null)
                  TextButton(
                    onPressed: callbacks.onRefresh,
                    child: const Text('Refresh'),
                  ),
                if (callbacks.onOpenExternal != null &&
                    isSafeGitExternalUrl(summary.repositoryUrl))
                  TextButton(
                    onPressed: () =>
                        callbacks.onOpenExternal!(summary.repositoryUrl),
                    child: const Text('Open repository'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        child,
      ],
    );
  }
}
