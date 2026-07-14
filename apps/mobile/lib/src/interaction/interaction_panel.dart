import 'package:flutter/material.dart';
import '../domain/interaction_state.dart';

class FollowUpQueuePanel extends StatelessWidget {
  const FollowUpQueuePanel({
    required this.items,
    required this.onRemove,
    required this.onClear,
    super.key,
  });
  final List<FollowUpItem> items;
  final ValueChanged<String> onRemove;
  final VoidCallback onClear;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Semantics(
      container: true,
      label: '${items.length} queued follow-ups',
      child: Card(
        key: const Key('follow-up-queue'),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Queued follow-ups (${items.length}/10)',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  TextButton(
                    key: const Key('queue-clear'),
                    onPressed: onClear,
                    child: const Text('Clear all'),
                  ),
                ],
              ),
              for (final item in items)
                ListTile(
                  key: Key('queue-${item.queueItemId}'),
                  title: Text(
                    item.message,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    'Position ${item.position}${item.attachmentIds.isEmpty ? '' : ' · ${item.attachmentIds.length} attachments'}',
                  ),
                  trailing: IconButton(
                    tooltip: 'Remove queued follow-up ${item.position}',
                    onPressed: () => onRemove(item.queueItemId),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class ExtensionDialogPanel extends StatefulWidget {
  const ExtensionDialogPanel({
    required this.dialog,
    required this.now,
    required this.onRespond,
    super.key,
  });
  final ExtensionDialogState dialog;
  final DateTime Function() now;
  final void Function({String? value, bool? confirmed, bool cancelled})
  onRespond;
  @override
  State<ExtensionDialogPanel> createState() => _ExtensionDialogPanelState();
}

class _ExtensionDialogPanelState extends State<ExtensionDialogPanel> {
  late final TextEditingController _text = TextEditingController(
    text: widget.dialog.prefill,
  );
  final FocusNode _focus = FocusNode();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final expired = widget.dialog.isExpired(widget.now());
    return Semantics(
      container: true,
      label: 'Extension ${widget.dialog.method.name} request',
      child: Card(
        key: Key('extension-dialog-${widget.dialog.dialogId}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.dialog.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (widget.dialog.message.isNotEmpty) Text(widget.dialog.message),
              if (widget.dialog.method == ExtensionDialogMethod.select)
                for (final option in widget.dialog.options)
                  ListTile(
                    key: Key('extension-option-$option'),
                    title: Text(option),
                    trailing: const Icon(Icons.chevron_right),
                    enabled: !expired,
                    onTap: expired
                        ? null
                        : () =>
                              widget.onRespond(value: option, cancelled: false),
                  ),
              if (widget.dialog.method == ExtensionDialogMethod.input ||
                  widget.dialog.method == ExtensionDialogMethod.editor)
                TextField(
                  key: const Key('extension-dialog-input'),
                  controller: _text,
                  focusNode: _focus,
                  readOnly: expired,
                  decoration: InputDecoration(
                    labelText: widget.dialog.placeholder.isEmpty
                        ? 'Response'
                        : widget.dialog.placeholder,
                    helperText: expired
                        ? 'Expired. Text remains available to copy.'
                        : null,
                  ),
                  onSubmitted: expired
                      ? null
                      : (value) =>
                            widget.onRespond(value: value, cancelled: false),
                ),
              if (widget.dialog.method == ExtensionDialogMethod.confirm)
                Wrap(
                  spacing: 8,
                  children: [
                    FilledButton(
                      onPressed: expired
                          ? null
                          : () => widget.onRespond(
                              confirmed: true,
                              cancelled: false,
                            ),
                      child: const Text('Confirm'),
                    ),
                    OutlinedButton(
                      onPressed: expired
                          ? null
                          : () => widget.onRespond(
                              confirmed: false,
                              cancelled: false,
                            ),
                      child: const Text('No'),
                    ),
                  ],
                ),
              if (widget.dialog.method == ExtensionDialogMethod.input ||
                  widget.dialog.method == ExtensionDialogMethod.editor)
                FilledButton(
                  key: const Key('extension-dialog-submit'),
                  onPressed: expired
                      ? null
                      : () => widget.onRespond(
                          value: _text.text,
                          cancelled: false,
                        ),
                  child: const Text('Submit'),
                ),
              TextButton(
                onPressed: expired
                    ? null
                    : () => widget.onRespond(cancelled: true),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
