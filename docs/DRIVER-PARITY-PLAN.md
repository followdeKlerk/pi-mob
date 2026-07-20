# Mobile Driver Parity Plan

## Product invariant

Pi-mob remains a sessions-first, single-Chat application. The initial gate synchronizes all chats before selection; no parity work may bypass durable command IDs, controller leases, workspace trust, or uncertain-completion safeguards.

## P1 — Driver controls and recovery

- [x] Reachable session control center from Chat.
- [x] Model and thinking selection.
- [x] Context/token/cost visibility.
- [x] Manual/automatic compaction controls.
- [x] Automatic retry state and abort.
- [x] Host-advertised command palette that prefills, never auto-sends.
- [x] Restart Pi and controller-takeover affordances.
- [x] Session title/runtime/controller status in the Chat header.
- [ ] Actionable provider/auth/version diagnostics and host log excerpt.

## P2 — Input and transcript productivity

- [x] Gallery image selection, sanitization, private upload, chips, removal, and prompt attachment IDs.
- [x] Local transcript search for user and assistant text.
- [x] Long-press user prompt actions: copy and edit as a new draft without sending.
- [x] Assistant answer copy/share.
- [ ] Per-code-block copy.
- [ ] Workspace `@file` search and general document attachments.
- [ ] Search match jump/highlight in the transcript.
- [x] HTML export generation, private download, and native share flow.

## P3 — Session power tools

- [x] Clone current branch from session controls.
- [ ] Reachable lineage/tree browser.
- [ ] Fork from an eligible user entry.
- [ ] Restore, repair, trash, and permanent-purge sheets.
- [x] Attention-first drawer ordering.
- [ ] Drawer filters and cross-chat unread inbox.

## P4 — Operational visibility

- [x] Sticky active-turn phase and abort surface.
- [ ] Elapsed timer and grouped tool-progress summary.
- [ ] Pending command progression (created through completed).
- [ ] Long-running threshold notifications.
- [ ] Controller-loss and expired-dialog alerts.
- [ ] Connection test, push self-test, and coalesced return summary.

## P5 — Advanced host parity

- [x] Extension status/widget/title/notify summary in session controls.
- [ ] Optional dangerous-tool permission-gate extension integration.
- [ ] Credential/model remediation without exposing secrets.
- [ ] Reload extensions, skills, templates, context, and session inventory.
- [ ] Offline staged chats/follow-ups with explicit reconnect dispatch.

## Verification gates

Each slice must preserve:

1. Sessions-first synchronization and durable local history.
2. No automatic replay of uncertain prompts.
3. One controller per session and explicit takeover.
4. Host-only paths and credentials.
5. Full-policy workspace trust checks.
6. Existing Tailscale routing and private binary origins.
7. Successful Android APK compilation before delivery.
