import 'package:flutter/material.dart';

class SendIntent extends Intent {
  const SendIntent();
}

class OpenTranscriptSearchIntent extends Intent {
  const OpenTranscriptSearchIntent();
}

class OpenModelPickerIntent extends Intent {
  const OpenModelPickerIntent();
}

class OpenChatsIntent extends Intent {
  const OpenChatsIntent();
}

class OpenCommandsIntent extends Intent {
  const OpenCommandsIntent();
}

/// Lets the app-level shortcut actions invoke the current shell surface
/// without placing the global shortcut bindings inside [AppShell].
final class ShellShortcutDelegate {
  VoidCallback? _openTranscriptSearch;
  VoidCallback? _openModelPicker;
  VoidCallback? _openChats;
  VoidCallback? _openCommands;

  void register({
    required VoidCallback openTranscriptSearch,
    required VoidCallback openModelPicker,
    required VoidCallback openChats,
    required VoidCallback openCommands,
  }) {
    _openTranscriptSearch = openTranscriptSearch;
    _openModelPicker = openModelPicker;
    _openChats = openChats;
    _openCommands = openCommands;
  }

  void openTranscriptSearch() => _openTranscriptSearch?.call();
  void openModelPicker() => _openModelPicker?.call();
  void openChats() => _openChats?.call();
  void openCommands() => _openCommands?.call();

  void clear() {
    _openTranscriptSearch = null;
    _openModelPicker = null;
    _openChats = null;
    _openCommands = null;
  }
}
