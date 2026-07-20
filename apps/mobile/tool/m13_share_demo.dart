import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pi_mob/src/attachments/share_callback.dart';

void main() => runApp(const _ShareDemo());

class _ShareDemo extends StatefulWidget {
  const _ShareDemo();
  @override
  State<_ShareDemo> createState() => _ShareDemoState();
}

class _ShareDemoState extends State<_ShareDemo> {
  String status = 'Preparing explicit native share…';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _share());
  }

  Future<void> _share() async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/pi-m13-share-demo.html');
    await file.writeAsString('<!doctype html><title>Pi M13 private export</title>');
    final result = await const PlatformNativeShareCallback().share(
      ShareRequest(
        exportId: '00000000-0000-4000-8000-000000000013',
        fileName: 'pi-m13-share-demo.html',
        mimeType: 'text/html',
        byteSize: await file.length(),
        localPath: file.path,
      ),
    );
    if (mounted) setState(() => status = 'Share result: ${result.status.name}');
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      appBar: AppBar(title: const Text('M13 explicit share demo')),
      body: Center(child: Text(status, textAlign: TextAlign.center)),
    ),
  );
}
