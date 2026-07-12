import 'package:flutter/material.dart';

/// pi-mob M1 scaffold entrypoint.
///
/// M1 does not ship any product UI. The placeholder widget exists only so
/// that `flutter run` can launch a debug build during the checkpoint demo,
/// as required by [`BACKLOG.md` M1 exit criteria](../../BACKLOG.md).
void main() {
  runApp(const PiMobM1Scaffold());
}

class PiMobM1Scaffold extends StatelessWidget {
  const PiMobM1Scaffold({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'pi-mob M1 scaffold',
      home: Scaffold(
        body: Center(
          child: Text('pi-mob M1 scaffold'),
        ),
      ),
    );
  }
}
