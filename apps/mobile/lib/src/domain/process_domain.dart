import 'package:flutter/material.dart';

class MobileProcess {
  const MobileProcess({required this.sessionId, required this.processId, required this.revision, required this.status, required this.command, this.pid, this.ports = const [], this.actions = const [], this.stdout = '', this.stderr = '', this.available = true});
  final String sessionId, processId, revision, status, command;
  final int? pid;
  final List<int> ports;
  final List<String> actions;
  final String stdout, stderr;
  final bool available;
}

class ProcessDomainState {
  const ProcessDomainState({this.items = const [], this.unavailable = false});
  final List<MobileProcess> items;
  final bool unavailable;
}

ProcessDomainState reduceProcess(ProcessDomainState state, Map<String, Object?> event) {
  final type = event['type'];
  if (type == 'process.unavailable') return ProcessDomainState(items: state.items, unavailable: true);
  if (type != 'process.snapshot') return state;
  final payload = event['payload'];
  if (payload is! Map) return state;
  final raw = payload['items'];
  if (raw is! List) return state;
  final items = raw.whereType<Map>().map((item) => MobileProcess(
    sessionId: item['sessionId'] as String,
    processId: item['processId'] as String,
    revision: item['revision'] as String,
    status: item['status'] as String,
    command: item['command'] as String,
    pid: item['pid'] is int ? item['pid'] as int : null,
    actions: (item['supportedActions'] as List? ?? const []).whereType<String>().toList(),
  )).toList();
  return ProcessDomainState(items: List.unmodifiable(items));
}

class ProcessSheet extends StatelessWidget {
  const ProcessSheet({super.key, required this.state, required this.onStop, required this.onRestart, required this.onRerun});
  final ProcessDomainState state;
  final void Function(MobileProcess) onStop, onRestart, onRerun;
  @override Widget build(BuildContext context) => ListView(
    children: [if (state.unavailable) const ListTile(title: Text('Processes unavailable'), subtitle: Text('The host did not provide process metadata.')),
      ...state.items.map((p) => ListTile(title: Text(p.command), subtitle: Text('${p.status}${p.pid == null ? ' · PID unavailable' : ' · PID ${p.pid}'}'), trailing: Wrap(children: [if (p.actions.contains('stop')) IconButton(onPressed: () => onStop(p), icon: const Icon(Icons.stop)), if (p.actions.contains('restart')) IconButton(onPressed: () => onRestart(p), icon: const Icon(Icons.refresh)), if (p.actions.contains('rerun')) IconButton(onPressed: () => onRerun(p), icon: const Icon(Icons.replay))]))),
    ],
  );
}
