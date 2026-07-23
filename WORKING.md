# Current working state

Last updated: 2026-07-23. Canonical checkout: `main` at HEAD `e1ff5a52f62e373e6e1f68beca203b6967113791`, with an uncommitted implementation patch.

## Implementation status

Automated R1–R12 implementation is complete across protocol schemas, generated fixtures, Bun bridge/runtime services, Flutter persistence/domain/coordinator layers, and mobile UI.

Key completed surfaces include:

- R4 context parsing, session-stream ownership, unavailable handling, and malformed-boundary coverage.
- R7 authoritative attention projection, persistence, resolution commands, and inbox UI.
- R8 authoritative agent supervision protocol, bridge projection, restored tracked reducer/domain behavior, and supervision UI actions.
- R9 host-reported command/tool/MCP catalogue with explicit unavailable states and confirmed toggles.
- R10 persistent global search indexing, exact normalized-token search, destination routing, cancellation safety, and app-bar/sheet UI.
- R11 once-per-frame coordinator notification coalescing without UI `Timer` or `Future.delayed` polling.
- R12 keyboard shortcuts, Back-stack priority, per-chat transcript scroll persistence, follow-mode restoration, and deep-link override behavior.

No tracked files are deleted from baseline HEAD.

## Final automated verification

External verification is green:

- `flutter analyze` — zero issues.
- `flutter test test/search/global_search_sheet_test.dart` — 3/3 passed.
- Full `flutter test` — 556 passed.
- Root `bun test` verifier — 760 passed, 0 failed.
- Actual `dart format lib test` completed before the final aggregate gate.
- `bun run all` — every stage passed; exit 0.
- `git diff --check` — clean.
- `flutter build apk --debug` — succeeded.

Fresh debug APK:

- Path: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`
- Size: 204M
- SHA-256: `8b5d8047ea9215100736a61bdfc90208c3d06ed75b15c5ace141a6e3a07601d5`

## Remaining work

Only physical Android manual evidence remains because no device is attached. The handoff should verify phone/tablet and landscape split behavior, TalkBack labels and focus order, 200% text, hardware-keyboard navigation and shortcuts, Back-stack priority, transcript scroll restoration/deep-link override, and background/notification behavior.
