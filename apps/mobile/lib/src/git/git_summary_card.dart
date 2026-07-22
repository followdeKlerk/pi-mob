import 'package:flutter/material.dart';
import '../ui/theme/pi_tokens.dart';
import 'git_domain.dart';
import 'git_callbacks.dart';

class GitSummaryCard extends StatelessWidget {
  const GitSummaryCard({required this.state, this.callbacks = const GitCallbacks(), super.key});
  final GitState state;
  final GitCallbacks callbacks;
  @override Widget build(BuildContext context) {
    final unavailable = state.unavailable;
    if (unavailable != null) return Card(child: Padding(padding: const EdgeInsets.all(PiSpacing.lg), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Git unavailable', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 8), Text(unavailable.message), if (callbacks.onRefresh != null) TextButton(onPressed: callbacks.onRefresh, child: const Text('Try again'))])));
    final summary = state.summary;
    if (summary == null) return const Card(child: Padding(padding: EdgeInsets.all(PiSpacing.lg), child: Text('Git status unavailable')));
    return Card(child: Padding(padding: const EdgeInsets.all(PiSpacing.lg), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(summary.repository, style: Theme.of(context).textTheme.titleMedium), Text(summary.detached ? 'Detached HEAD' : 'Branch: ${summary.branch}'), Text('${summary.workingTreeState} · ${summary.changedCount} changed · ↑${summary.ahead} ↓${summary.behind}'), Text('CI: ${summary.ciState}'), const SizedBox(height: 8), Wrap(spacing: 8, children: [if (summary.canCommit && callbacks.onCommitConfirmed != null) FilledButton(onPressed: callbacks.onCommitConfirmed, child: const Text('Commit through Pi')), if (summary.canPush && callbacks.onPushConfirmed != null) OutlinedButton(onPressed: callbacks.onPushConfirmed, child: const Text('Push through Pi')), if (callbacks.onOpenExternal != null && isSafeGitExternalUrl(summary.repositoryUrl)) TextButton(onPressed: () => callbacks.onOpenExternal!(summary.repositoryUrl), child: const Text('Open repository'))])])));
  }
}
