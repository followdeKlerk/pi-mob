import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// R12 — Keyboard shortcut intents for the chat shell.
///
/// On a physical keyboard (desktop, web, or an external keyboard
/// attached to a tablet), the shell exposes four intent types:
/// send, open-search, and open-chats. Each intent is a
/// [Intent] subclass so it can be routed through Flutter's standard
/// `Shortcuts`/`Actions` framework, which in turn respects focus and
/// IME composition (e.g. text fields keep their key events while a
/// Composer is focused, modal focus wins over the shell).
///
/// On platforms without a keyboard (phones) the actions are inert —
/// they only fire when a `LogicalKeyboardKey` press is observed.
///
/// The catalogue/commands intent is intentionally absent: the
/// catalogue capability is not produced by the normal daemon, so the
/// released surface does not expose a commands/catalogue entry point.

class SubmitComposerIntent extends Intent {
  const SubmitComposerIntent();
}

class OpenSearchIntent extends Intent {
  const OpenSearchIntent();
}

class OpenChatsIntent extends Intent {
  const OpenChatsIntent();
}

/// Returns the canonical `Shortcuts` map for the chat shell. Centralised
/// here so the production shell and any test harness can build the same
/// `ShortcutMap` without duplicating literal key combinations.
Map<ShortcutActivator, Intent> buildChatShellShortcuts() {
  return <ShortcutActivator, Intent>{
    const SingleActivator(LogicalKeyboardKey.enter, control: true):
        const SubmitComposerIntent(),
    const SingleActivator(LogicalKeyboardKey.enter, meta: true):
        const SubmitComposerIntent(),
    const SingleActivator(LogicalKeyboardKey.keyK, control: true):
        const OpenSearchIntent(),
    const SingleActivator(LogicalKeyboardKey.keyK, meta: true):
        const OpenSearchIntent(),
    const SingleActivator(LogicalKeyboardKey.keyO, control: true, shift: true):
        const OpenChatsIntent(),
    const SingleActivator(LogicalKeyboardKey.keyO, meta: true, shift: true):
        const OpenChatsIntent(),
  };
}
