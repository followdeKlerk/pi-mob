import 'package:flutter/foundation.dart';

@immutable
class GitCallbacks {
  const GitCallbacks({
    this.onRefresh,
    this.onOpenExternal,
    this.onCommitConfirmed,
    this.onPushConfirmed,
  });
  final VoidCallback? onRefresh;
  final ValueChanged<String>? onOpenExternal;
  final VoidCallback? onCommitConfirmed;
  final VoidCallback? onPushConfirmed;
}
