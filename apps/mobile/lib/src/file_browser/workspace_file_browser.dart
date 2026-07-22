import 'package:flutter/material.dart';

import 'file_browser_models.dart';

export 'file_browser_models.dart';

/// Isolated read-only files sheet. Transport and composer ownership are
/// supplied as callbacks so browsing cannot implicitly pin or send anything.
class WorkspaceFileBrowser extends StatefulWidget {
  const WorkspaceFileBrowser({required this.data, required this.callbacks, super.key});
  final FileBrowserViewData data;
  final FileBrowserCallbacks callbacks;

  @override
  State<WorkspaceFileBrowser> createState() => _WorkspaceFileBrowserState();
}

class _WorkspaceFileBrowserState extends State<WorkspaceFileBrowser> {
  final search = TextEditingController();
  bool contentSearch = false;

  @override
  void dispose() { search.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Read-only workspace files',
    child: Column(children: [
      AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Files'),
        actions: [IconButton(key: const Key('files-refresh'), tooltip: 'Refresh files', onPressed: widget.callbacks.onRefresh, icon: const Icon(Icons.refresh))],
      ),
      Padding(
        padding: const EdgeInsets.all(8),
        child: Row(children: [
          Expanded(child: TextField(key: const Key('files-search-field'), controller: search, decoration: const InputDecoration(labelText: 'Search workspace', prefixIcon: Icon(Icons.search)), onSubmitted: (value) => widget.callbacks.onSearch?.call(value, contentSearch))),
          IconButton(key: const Key('files-search-mode'), tooltip: contentSearch ? 'Search file names' : 'Search file contents', onPressed: () => setState(() => contentSearch = !contentSearch), icon: Icon(contentSearch ? Icons.subject : Icons.drive_file_rename_outline)),
        ]),
      ),
      Expanded(child: _body(context)),
    ]),
  );

  Widget _body(BuildContext context) {
    switch (widget.data.state) {
      case FileBrowserState.loading:
        return const Center(child: CircularProgressIndicator(key: Key('files-loading')));
      case FileBrowserState.unavailable:
        return _Notice(icon: Icons.folder_off, title: 'Files unavailable', message: widget.data.message ?? 'The host does not provide read-only files.');
      case FileBrowserState.failed:
        return _Notice(icon: Icons.error_outline, title: 'Files could not be loaded', message: widget.data.message ?? 'Try refreshing files.');
      case FileBrowserState.ready:
        if (widget.data.document != null) return _document(context, widget.data.document!);
        return _results();
    }
  }

  Widget _results() {
    final children = <Widget>[];
    if (widget.data.recents.isNotEmpty) {
      children.add(const ListTile(title: Text('Recent files')));
      children.addAll(widget.data.recents.map((path) => ListTile(key: Key('recent-$path'), leading: const Icon(Icons.history), title: Text(path), onTap: () => widget.callbacks.onOpen?.call(path))));
      children.add(const Divider());
    }
    if (widget.data.mode == FileBrowserMode.contentSearch) {
      children.addAll(widget.data.contentMatches.map((match) => ListTile(key: Key('content-${match.path}-${match.line}'), title: Text(match.path), subtitle: Text('${match.line}: ${match.lineText}', maxLines: 2), onTap: () => widget.callbacks.onOpen?.call(match.path))));
    } else if (widget.data.mode == FileBrowserMode.filenameSearch) {
      children.addAll(widget.data.filenameMatches.map((path) => ListTile(key: Key('match-$path'), leading: const Icon(Icons.description_outlined), title: Text(path), onTap: () => widget.callbacks.onOpen?.call(path))));
    } else {
      children.addAll(widget.data.nodes.map((node) => ListTile(key: Key('file-${node.path}'), contentPadding: EdgeInsets.only(left: 12 + node.depth * 16, right: 12), leading: Icon(node.kind == WorkspaceFileKind.directory ? Icons.folder_outlined : node.isBinary ? Icons.insert_drive_file : Icons.description_outlined), title: Text(node.path), trailing: node.modified ? const Tooltip(message: 'Modified', child: Icon(Icons.circle, size: 10)) : null, onTap: () => widget.callbacks.onOpen?.call(node.path))));
    }
    if (widget.data.nextPageToken != null) children.add(TextButton(key: const Key('files-load-more'), onPressed: widget.callbacks.onLoadMore, child: const Text('Load more')));
    if (children.isEmpty) children.add(const ListTile(title: Text('No files found')));
    return ListView(key: const Key('files-results'), children: children);
  }

  Widget _document(BuildContext context, WorkspaceFileDocument document) {
    final reference = widget.data.selectedReference;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Material(color: Theme.of(context).colorScheme.surfaceContainerHighest, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [
        Expanded(child: Text(document.path, key: const Key('file-path'), overflow: TextOverflow.ellipsis)),
        IconButton(key: const Key('copy-file-path'), tooltip: 'Copy path', onPressed: () => widget.callbacks.onCopyPath?.call(document.path), icon: const Icon(Icons.copy)),
      ]))),
      if (document.stale) const MaterialBanner(key: Key('file-stale'), content: Text('This file changed. Refresh before attaching a reference.'), actions: [SizedBox.shrink()]),
      if (document.isTruncated) const Padding(padding: EdgeInsets.all(8), child: Text('Bounded view — load another line range to continue.')),
      Expanded(child: ListView.builder(key: const Key('file-lines'), itemCount: document.lines.length, itemBuilder: (context, index) {
        final number = document.rangeStart + index;
        final selected = widget.data.selectedStart != null && widget.data.selectedEnd != null && number >= (widget.data.selectedStart! < widget.data.selectedEnd! ? widget.data.selectedStart! : widget.data.selectedEnd!) && number <= (widget.data.selectedStart! > widget.data.selectedEnd! ? widget.data.selectedStart! : widget.data.selectedEnd!);
        return InkWell(key: Key('line-$number'), onTap: () => widget.callbacks.onSelectLine?.call(number, false), onLongPress: () => widget.callbacks.onSelectLine?.call(number, true), child: ColoredBox(color: selected ? Theme.of(context).colorScheme.primaryContainer : Colors.transparent, child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 52, child: Padding(padding: const EdgeInsets.all(8), child: Text('$number', textAlign: TextAlign.right, style: Theme.of(context).textTheme.bodySmall))),
          Expanded(child: Padding(padding: const EdgeInsets.all(8), child: SelectableText(document.lines[index], style: const TextStyle(fontFamily: 'monospace')))),
        ])));
      })),
      SafeArea(top: false, child: Wrap(alignment: WrapAlignment.end, spacing: 8, children: [
        TextButton(key: const Key('copy-selected-text'), onPressed: widget.callbacks.onCopyText == null ? null : () => widget.callbacks.onCopyText!(document.lines.join('\n')), child: const Text('Copy text')),
        OutlinedButton(key: const Key('insert-file-reference'), onPressed: reference == null || widget.callbacks.onInsertReference == null ? null : () => widget.callbacks.onInsertReference!(reference), child: const Text('Insert reference')),
        FilledButton(key: const Key('prepare-file-attachment'), onPressed: reference == null || widget.callbacks.onPrepareAttachment == null ? null : () => widget.callbacks.onPrepareAttachment!(reference), child: const Text('Prepare attachment')),
      ])),
    ]);
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.title, required this.message});
  final IconData icon; final String title; final String message;
  @override Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 40), const SizedBox(height: 12), Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 8), Text(message, textAlign: TextAlign.center)])));
}
