import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/file_browser/workspace_file_browser.dart';

Widget app(FileBrowserViewData data, FileBrowserCallbacks callbacks) => MaterialApp(home: Scaffold(body: SizedBox(width: 420, height: 760, child: WorkspaceFileBrowser(data: data, callbacks: callbacks))));
const digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

void main() {
  test('reference serialization remains revision and range bound', () {
    const reference = WorkspaceFileReference(workspaceId: 'workspace', path: 'src/a.dart', digest: digest, revision: 'revision', ranges: [FileLineRange(2, 4)]);
    expect(reference.toJson(), {'workspaceId': 'workspace', 'path': 'src/a.dart', 'digest': digest, 'revision': 'revision', 'ranges': [{'startLine': 2, 'endLine': 4}]});
  });

  testWidgets('tree, recents, search and paging only invoke read callbacks', (tester) async {
    final opened = <String>[]; var loaded = 0; var search = '';
    await tester.pumpWidget(app(const FileBrowserViewData(workspaceId: 'w', recents: ['README.md'], nodes: [WorkspaceFileNode(path: 'src', kind: WorkspaceFileKind.directory, depth: 0), WorkspaceFileNode(path: 'src/a.dart', kind: WorkspaceFileKind.file, depth: 1, modified: true)], nextPageToken: 'opaque'), FileBrowserCallbacks(onOpen: opened.add, onLoadMore: () => loaded++, onSearch: (query, content) => search = '$content:$query')));
    expect(find.text('Recent files'), findsOneWidget); expect(find.byTooltip('Modified'), findsOneWidget);
    await tester.tap(find.byKey(const Key('file-src/a.dart'))); expect(opened, ['src/a.dart']);
    await tester.tap(find.byKey(const Key('files-load-more'))); expect(loaded, 1);
    await tester.enterText(find.byKey(const Key('files-search-field')), 'needle'); await tester.tap(find.byKey(const Key('files-search-mode'))); await tester.testTextInput.receiveAction(TextInputAction.done);
    expect(search, 'true:needle');
  });

  testWidgets('read selection prepares callbacks but never sends', (tester) async {
    WorkspaceFileReference? inserted; WorkspaceFileReference? prepared; var selected = 0;
    const document = WorkspaceFileDocument(path: 'src/a.dart', revision: 'r1', digest: digest, rangeStart: 1, totalLines: 3, lines: ['one', 'two', 'three'], languageHint: 'dart');
    await tester.pumpWidget(app(const FileBrowserViewData(workspaceId: 'w', mode: FileBrowserMode.read, document: document, selectedStart: 2, selectedEnd: 3), FileBrowserCallbacks(onSelectLine: (line, extend) => selected = line, onInsertReference: (value) => inserted = value, onPrepareAttachment: (value) => prepared = value)));
    tester.widget<InkWell>(find.byKey(const Key('line-1'))).onTap!(); expect(selected, 1);
    await tester.ensureVisible(find.byKey(const Key('insert-file-reference')));
    await tester.tap(find.byKey(const Key('insert-file-reference'))); await tester.tap(find.byKey(const Key('prepare-file-attachment')));
    expect(inserted!.ranges.single.startLine, 2); expect(inserted!.ranges.single.endLine, 3); expect(prepared!.revision, 'r1');
    expect(find.textContaining('Send'), findsNothing);
  });

  testWidgets('stale and unavailable states are explicit and cannot attach', (tester) async {
    const stale = WorkspaceFileDocument(path: 'a.txt', revision: 'old', digest: digest, rangeStart: 1, totalLines: 1, lines: ['old'], stale: true);
    await tester.pumpWidget(app(const FileBrowserViewData(workspaceId: 'w', document: stale), const FileBrowserCallbacks(onInsertReference: null)));
    expect(find.byKey(const Key('file-stale')), findsOneWidget);
    expect(tester.widget<OutlinedButton>(find.byKey(const Key('insert-file-reference'))).onPressed, isNull);
    await tester.pumpWidget(app(const FileBrowserViewData(workspaceId: 'w', state: FileBrowserState.unavailable, message: 'Capability not advertised'), const FileBrowserCallbacks()));
    expect(find.text('Files unavailable'), findsOneWidget); expect(find.text('Capability not advertised'), findsOneWidget);
  });
}
