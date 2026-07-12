# Planning

Status: research
Scope: Market research and planning for `pi-mob`; research direction is user-led.

## Research questions

- Which mobile stack best balances cross-platform UI performance and delivery speed for `pi-mob`?
- Which design resources and agent tooling support a polished Flutter application?

## Findings

- Flutter is the strongest current cross-platform option for rendering performance and consistent custom UI.
- React Native + Expo is the strongest general-purpose delivery-speed alternative; Kotlin Multiplatform is strongest for deep native integration.
- Cross-framework performance and delivery benchmarks are limited; this decision should be validated with a focused product spike when requirements are defined.
- Flutter's built-in Material 3 widgets cover the established M3 catalog well. The newer Material 3 Expressive components and motion system are not built in; treat them as custom implementation work.
- Favor Flutter's built-in theming, adaptive layout, accessibility, animation, and testing APIs before adding third-party UI frameworks.

Mobile-stack sources:
- https://docs.flutter.dev/perf/impeller
- https://swmansion.com/blog/we-built-the-same-app-in-kmp-and-react-native-here-s-what-we-found/
- https://reactnative.dev/architecture/landing-page
- https://kotlinlang.org/docs/multiplatform/supported-platforms.html

## Flutter design resource lookup

Use this as the canonical lookup map. Consult the first listed source for the question; do not research parallel sources unless it does not answer the question.

### Components and design intent

- **What should a Material component look like, do, or announce?** [Material 3 catalog](https://m3.material.io/) — Google’s design specification: anatomy, states, token tables, usage, and accessibility guidance. Use its component page for design intent only.
- **How is that component implemented in Flutter?** [Flutter Material widget catalog](https://docs.flutter.dev/ui/widgets/material) — SDK widget inventory and API links; this is the implementation source of truth.
- **How does Material 3 fit into Flutter overall?** [Material design for Flutter](https://docs.flutter.dev/ui/design/material) and [M3 for Flutter](https://m3.material.io/develop/flutter) — migration, learning paths, codelabs, reference apps, and Flutter-specific status. Do not use these for individual constructor/API details.
- **Need runnable composition examples?** [Flutter Material 3 demo](https://github.com/flutter/samples/tree/main/material_3_demo) — official executable examples of themes and components in context. Prefer it over searching miscellaneous UI repositories.
- **Need visual design assets or Figma components?** [Material 3 Figma design kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) — official components, styles, variables, and mockups. It is not Flutter code and may include Expressive assets Flutter does not implement.

### Theme and tokens

- **What do M3 token names and relationships mean?** [M3 design tokens](https://m3.material.io/foundations/design-tokens) — authoritative token taxonomy, component-token relationships, and naming.
- **What should execute in Flutter?** [`ThemeData`](https://api.flutter.dev/flutter/material/ThemeData-class.html), [`ColorScheme.fromSeed`](https://api.flutter.dev/flutter/material/ColorScheme/ColorScheme.fromSeed.html), and [`ThemeExtension`](https://api.flutter.dev/flutter/material/ThemeExtension-class.html) — first choice for app themes, dynamic palettes, and typed custom tokens.
- **Need portable token interchange later?** [DTCG format](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) — vendor-neutral interchange reference, not Material values and not a W3C standard.
- **Do not use as the current Flutter baseline:** [Material tokens repository](https://github.com/material-foundation/material-tokens) is an archived 2022 DSP snapshot. It is useful only for legacy comparison. [Material Web](https://github.com/material-components/material-web) is a maintenance-mode Lit/web-component implementation; use it only as a secondary behavior/reference source, never as Flutter code.
- **Optional automation only after a real external token pipeline exists:** [`design_builder`](https://pub.dev/packages/design_builder) generates `ThemeExtension` code from its own JSON schema. It is young and not fully DTCG-compatible; prefer handwritten Flutter themes until generation has a concrete payoff.

### Adaptive design, motion, accessibility, and performance

- **Phone/tablet/foldable/layout behavior:** [Adaptive and responsive design](https://docs.flutter.dev/ui/adaptive-responsive) — `MediaQuery`, `LayoutBuilder`, insets, input modes, and breakpoints. Prefer it over adaptive-wrapper packages.
- **Motion strategy and animation choice:** [Flutter animations](https://docs.flutter.dev/ui/animations) — implicit vs explicit, hero, staggered, and transition patterns. For exact simulation APIs use [Flutter physics](https://api.flutter.dev/flutter/physics/). For Material motion intent return to the M3 catalog.
- **Ship-quality accessibility:** [Flutter accessibility](https://docs.flutter.dev/ui/accessibility) — release checklist, semantics, contrast, text scaling, and TalkBack/VoiceOver validation. Widget-specific behavior belongs in that widget’s API documentation.
- **Avoid and diagnose jank:** [Performance best practices](https://docs.flutter.dev/perf/best-practices) for code patterns; [DevTools performance](https://docs.flutter.dev/tools/devtools/performance) for frame timelines and traces. Do not use DevTools as a design-spec source.

### Previewing and visual verification

- **Primary widget-level preview:** [Flutter Widget Previewer](https://docs.flutter.dev/tools/widget-previewer) — official `@Preview` workflow for theme, size, locale, text scale, and wrappers. Its API is still marked unstable; recheck before depending on it broadly.
- **Whole-app runtime viewport simulation:** [`device_preview`](https://pub.dev/packages/device_preview) — optional for locale/orientation/text-scale/device-frame checks; validate final behavior on real devices.
- **Testing tiers and device execution:** [Testing overview](https://docs.flutter.dev/testing/overview) for unit/widget/integration selection; [integration tests](https://docs.flutter.dev/testing/integration-tests) for devices/emulators.
- **Visual regression:** built-in `matchesGoldenFile` for small cases; [`alchemist`](https://pub.dev/packages/alchemist) is the retained optional framework for multi-scenario, CI-stable goldens. Pin the Flutter version and CI rendering environment.

### Agent and code-intelligence tooling

- **Flutter code, package API, errors, widget tree, and runtime diagnosis:** [official Dart and Flutter MCP server](https://docs.flutter.dev/ai/mcp-server), with [source/tool inventory](https://github.com/dart-lang/ai/tree/main/pkgs/dart_mcp_server). It can analyze code, inspect resolved package source, run tests/formatting, manage pub dependencies, and inspect a connected app.
  - Configure it only for trusted workspaces. Some tools can mutate files/dependencies, run processes, access runtime state, or broaden workspace roots; keep mutation-capable tools approval-gated.
  - It complements the Material spec; it does not host an indexed M3 catalog.
- **Community Material catalog MCP:** [material3-mcp-server](https://github.com/weppa-cloud/material3-mcp-server) is an optional, audited convenience for rough discovery/icons only. It has stale/mock/heuristic data paths; do not trust it for components, tokens, accessibility, Flutter availability, or generated production code.

### Narrow community additions

- **Decorative or multi-step motion:** [`flutter_animate`](https://pub.dev/packages/flutter_animate) — optional chainable animation DSL. Use built-in implicit animations first; its release cadence is slow.
- **Designer-supplied After Effects/Bodymovin assets:** [`lottie`](https://pub.dev/packages/lottie) — retain as the dedicated path for those assets; Flutter has no built-in equivalent.
- **Interactive vector state machines:** consider [Rive](https://rive.app/docs/runtimes/flutter/flutter) only when a design workflow explicitly requires it; do not add it by default.

### Availability constraint

- Material 3 Expressive design assets/specification are ahead of Flutter’s built-in widget set. Before designing around an Expressive-only component, check [Flutter issue #91605](https://github.com/flutter/flutter/issues/91605) and the component’s Flutter API availability.

## Resource decision tree

```text
Need Flutter code for a Material component?
  -> Flutter Material widget catalog -> widget API -> official Dart/Flutter MCP source inspection if needed.

Need visual behavior, anatomy, states, or design rationale?
  -> Material 3 catalog component page -> cross-check Flutter availability.

Need a runnable M3 composition?
  -> Flutter material_3_demo.

Need Figma assets?
  -> Official M3 Figma kit.

Need theme values?
  -> ThemeData + ColorScheme.fromSeed + ThemeExtension.
  -> Consult M3 tokens for naming/relationships, not as executable Dart values.

Need adaptive layout, a11y, motion, or performance guidance?
  -> Official Flutter adaptive, accessibility, animations, or performance docs respectively.

Need visual confidence?
  -> Widget Previewer during development -> integration tests on devices -> alchemist only for CI-scale goldens.

Need agent assistance with actual project code?
  -> Official Dart/Flutter MCP server; require approval for writes, pub, lifecycle, and VM-service actions.
```

## Pi mapping

### Integration contract

- Flutter does not run Pi directly. A host must run `pi --mode rpc`; a bridge converts Pi's stdin/stdout JSONL into a mobile WebSocket transport carried by the user-controlled Tailscale network.
- Pi RPC framing is strict: split records only on LF (`\n`), strip a trailing `\r`, correlate responses with optional command IDs, and never use generic line readers that split Unicode separators.
- The bridge owns Pi process lifecycle, cwd selection, session mapping, credentials, trust decisions, RPC validation, replay/reconnect, and extension-dialog routing. The mobile app owns presentation, local cursor storage, drafts, gestures, images, and native notifications.
- `agent_settled`, not `agent_end`, is the idle boundary: retries, compaction, and queued follow-ups can continue after an agent-end event.

Primary Pi sources: installed Pi `README.md`; `docs/rpc.md`, `docs/security.md`, `docs/settings.md`, `docs/sessions.md`, `docs/session-format.md`, `docs/extensions.md`, `docs/sdk.md`, `docs/skills.md`, `docs/prompt-templates.md`, `docs/providers.md`, and `docs/containerization.md`.

### Mobile journeys

- **Connect and select project:** pair with a trusted host, choose a host workspace/cwd, disclose its trust state and enabled-tool policy, then resume or create a session.
- **Chat:** submit text/images; render streaming text, collapsible thinking, tool cards, queue state, errors, and stop reasons. Support abort, steer, and follow-up rather than concurrent turns in one session.
- **Model controls:** use `get_available_models`, `set_model`, and thinking-level commands; expose context/cost state from session stats.
- **Commands:** use `get_commands` for a categorized mobile command palette covering extension commands, skills, and prompt templates. Built-in TUI slash commands are not RPC commands; map their useful behavior to dedicated mobile controls.
- **Extension UI:** map select/confirm/input/editor to native sheets/dialogs; map notify/status/widget/title/editor-prefill to mobile surfaces. Do not promise arbitrary TUI custom components because they are unavailable in RPC mode.
- **Sessions:** persist the last seen entry ID; reconnect with `get_entries(since)` and fall back to `get_messages` if the cursor is invalid. Phase 2 adds browsing, switch, fork, clone, tree, labels, export, and sharing.
- **Compaction and retries:** display compaction/retry progress, permit aborting a retry, and distinguish length, provider, tool, extension, and compaction failures.

### Capability boundaries

**MVP directly backed by Pi RPC**

- Prompting with text/images; streaming text, thinking, and tool events; abort/steer/follow-up queues.
- Session state, model/thinking selection, session statistics, session naming, durable entry sync, compaction/retry controls, and available command discovery.
- Invocation of skills, prompt templates, and extension commands.
- Extension dialogs plus basic notifications/editor prefill.
- Generic rendering of built-in tool calls (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) and their output/errors.

**Phase 2 / bridge adaptation required**

- Host-side session listing and full tree navigation, project/workspace browser, fork/clone UX, provider/OAuth/API-key management, custom models, general settings, package management, and tool-policy configuration.
- Rich extension widgets/status surfaces, bridge-owned sandbox profiles, remote notifications, and detailed subagent UX.
- Pi has no built-in subagent API. Extension/package subagents appear as tool calls unless a specific bridge contract is built for them.

**Do not target as generic parity**

- Terminal themes, keybindings, terminal editor/clipboard behavior, TUI footer/header/overlays, and arbitrary extension-rendered terminal components. Rebuild only the mobile behavior that is product-useful.

### Runtime and security constraints

- Pi has no HTTP server, mobile transport, in-band bridge authentication, permission-popup framework, or sandbox. By product decision, the user-controlled Tailscale network is the sole connection security boundary; pi-mob adds no application-layer authentication.
- Project trust controls loading project settings/resources/extensions; it is not a sandbox. In RPC mode Pi does not show a trust prompt. The bridge must apply the selected per-project trust policy and show what project resources would load.
- Pi and extensions execute with the host process user's permissions. pi-mob is private-tailnet-only: do not use a public bridge or Tailscale Funnel.
- API keys/OAuth tokens remain host-side. The mobile client must never receive or persist provider credentials.
- Pi has a documented Android on-device route through Termux; no iOS on-device execution route is documented. A remote or paired host is therefore required for iOS parity.
- Mobile background continuation and push notifications are outside Pi. The bridge must turn Pi lifecycle events into a product-specific notification strategy.

### Architecture choices still open

1. Host topology: paired LAN host, private tunnel, remote host, or Android-only Termux mode.
2. Private connection endpoint: direct Tailscale address with app TLS handling, or Tailscale Serve plus a MagicDNS `wss://` endpoint.
3. Process/session model: one Pi RPC process per active mobile session, or a bridge strategy based on session switching.
4. Workspace policy: how a phone can discover/select host directories for its selected host workspace.
5. Trust policy: explicit per-project approve/deny flow versus curated pre-trusted workspaces.
6. Tool UX policy: how host `bash` and write/edit execution are represented and confirmed in the mobile UI.
7. Background policy: continue work while the app is backgrounded, then notify; or pause/disconnect deliberately.
8. Privacy defaults: telemetry/update checks, local session mirror/retention, cost guardrails, and share/export consent.

### Research-supported defaults awaiting owner confirmation

- **Host topology:** use an always-on private host (for example, a Mac mini or equivalent) running the bridge and Pi; retain a paired laptop as fallback. Defer Android Termux to a power-user phase because it lacks iOS parity and is constrained by Android background execution.
- **Pi session model:** run one `pi --mode rpc` subprocess per active mobile session. This matches Pi's cwd-bound sessions, isolates crashes, permits multi-workspace concurrency, and reuses the proven registry/replay model.
- **Workspace selection:** make recent sessions/folders the primary entry; use search-first host-folder selection as the secondary path. Do not recreate a full terminal filesystem browser or add a new workspace index initially.
- **Pi project trust:** surface Pi's project-resource decision before starting an unknown workspace with trust-bearing resources. This is Pi resource-loading behavior, not an additional connection-security layer; noninteractive RPC otherwise silently ignores those resources under its default policy.
- **Tool UX:** all tool activity is visible in transcript cards. Whether to confirm writes/non-read-only shell commands, block sensitive paths, or ship a read-only mode remains an owner choice; Pi supports these controls through a host extension and its existing extension-UI protocol.
- **Background policy:** maximize practical connection persistence. The host always continues running Pi; keep a heartbeat-backed WebSocket while foregrounded; reconnect/replay immediately after any disconnect. On Android, use a user-visible foreground service when sustained background connectivity is enabled. iOS cannot guarantee a background WebSocket, so use native lifecycle recovery plus remote push/Live Activity updates rather than claiming persistent sockets.
- **Notifications:** include remote notifications from the first connected release: APNs on iOS and FCM on Android for settled/error/attention-needed events; use an iOS Live Activity for active agent status where supported. Local notifications remain a fallback for foreground/recently-backgrounded state.
- **Privacy and cost:** proposed host defaults are `PI_OFFLINE=1`, disabled install telemetry, and disabled version checks. Keep Pi's auto-compaction/retry defaults, expose `get_session_stats` cost/context state, show advisory thresholds rather than claiming a spend cap, and keep provider credentials host-only.

### QR pairing and Tailscale connection

- **One entry point:** a Pi extension registers a `/pi-mob` command, resolves the already-running bridge endpoint, and displays a QR code. The Flutter app scans it once and stores the paired bridge URL locally.
- **Extension scope:** the extension renders/publishes connection metadata only. It does not start Pi, own RPC lifecycle, or replace the bridge. Pi supports slash commands, inline custom messages, and TUI overlays suitable for a QR; use universal Unicode QR rendering so it works in ordinary terminals.
- **QR payload:** a stable MagicDNS WebSocket endpoint plus a fresh bridge-session identifier, for example `wss://<bridge>.<tailnet>.ts.net/ws?session=<id>`. The final path/envelope is a bridge contract to define. No QR token expiry, rotation, or additional app authentication is planned; Tailscale is the sole boundary.
- **Endpoint:** prefer Tailscale Serve in front of a loopback bridge. It provides a MagicDNS `*.ts.net` hostname and publicly trusted TLS certificate while remaining tailnet-only. Do not use Tailscale Funnel because it exposes a service to the public internet.
- **Pairing recovery:** re-scan only on first install, deliberate forget/unpair, or a changed host endpoint. A Pi or bridge restart should reconnect using the stored endpoint rather than require another scan.
- **Mobile lifecycle:** do not assume a Flutter WebSocket survives backgrounding, sleep, or Wi-Fi/cellular transitions. On foreground/reconnect: reopen the socket, query `get_state`, recover entries through `get_entries(since: lastEntryId)`, then use `agent_settled` as the idle boundary. Persist drafts, selected session/host, and last entry ID locally.
- **Notifications:** Pi supplies lifecycle events but no mobile push integration. Completion/error notifications are a later bridge/mobile capability; they are not required for initial pairing or reconnect.
- **Operator assumptions:** MagicDNS and Tailscale HTTPS/Serve must be enabled; the QR extension must refuse to display loopback or wildcard hostnames because they are not phone-reachable.

Connection sources:
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/how-to/set-up-https-certificates
- https://tailscale.com/docs/features/magicdns
- https://tailscale.com/docs/install/ios
- https://tailscale.com/docs/install/android
- https://docs.flutter.dev/ui/adaptive-responsive
- Installed Pi `docs/extensions.md`, `docs/tui.md`, and `docs/rpc.md`.

## Product requirements captured

- **Session control:** create sessions, load historical sessions and messages, switch/fork/clone where useful, and delete sessions through a mobile-native flow.
- **Model controls:** expose model selection and a thinking-level toggle in the application.
- **Directory selection:** provide a host-home-directory map optimized for recent projects and search, not a full terminal file browser.
- **Stored notes:** add application notes after the first MVP; research Obsidian synchronization rather than committing to an integration now.
- **Reasoning display:** make the thinking/reasoning section polished, collapsible, readable, and separate from final response/tool output; research suitable interaction patterns and assets before specifying it.

## Phase-2 product research

### Reasoning/thinking display

- Use three distinct surfaces inside each assistant turn: a reasoning container, one tool-activity card per call, and a final answer surface.
- Render reasoning as a collapsible card with elapsed time and length cues; default to expanded while streaming and collapsed after the turn ends. Auto-expand on the user's explicit request.
- Render tool activity as a compact card per call with status pill, args preview, and collapsible result; surface errors inline with retry actions.
- Stream the final answer incrementally at ~60 fps using a `StreamController` per turn; wrap the streaming bubble in a `RepaintBoundary` to isolate paint; gate any optional typewriter behind a user setting with at least a 16 ms cadence.
- Pin scroll only when the user is near the bottom; show a “Jump to latest” FAB otherwise.
- Apply Flutter accessibility primitives: state-transition live regions only (never inside the streaming bubble), `MediaQuery.disableAnimations` and `AccessibilityFeatures.reduceMotion` for reduced motion, `SelectionArea` for copy on the final answer, keyboard reachability for cancel.
- Optimise long sessions with stable keys, lazy history paging, `itemExtent`/`prototypeItem`, and end-to-end cancel via `Completer` and `http.AbortableStreamedRequest`.

Primary sources:
- https://pub.dev/packages/flutter_markdown_stream
- https://pub.dev/packages/flutter_streaming_text_markdown
- https://pub.dev/packages/flutter_gen_ai_chat_ui
- https://github.com/Daan-hub/better_chat_scrolling_ai
- https://docs.flutter.dev/perf/best-practices
- https://m3.material.io/
- https://tianpan.co/blog/2026-04-17-ai-accessibility-streaming-screen-readers

### 120 fps motion target

- Flutter already follows the panel’s vsync, so it can render at 120 fps on ProMotion iPhones, iPad Pros, and high-refresh Android panels without engine changes.
- Ship with Impeller as the default renderer; it is the only renderer on iOS and the Metal/Vulkan target on Android API 29+.
- iOS requires `CADisableMinimumFrameDurationOnPhone = true` in `Info.plist` for any refresh rate above 60 Hz on iPhone; iPad Pro does not need it.
- Android typically needs an explicit `Surface.setFrameRate(120, …)` call via a platform channel; on Android 15 the default can be 60 Hz without it.
- Stay well under the 8 ms frame budget on the streaming and scroll paths; isolate streaming bubble paint with a `RepaintBoundary` and use `SchedulerBinding.addTimingsCallback` to track build/raster timing.
- Profile with the Flutter DevTools Performance overlay in `--profile` mode on a real 120 Hz device and a 60 Hz baseline device; do not rely on simulators/emulators.
- Use Apple’s variable-refresh-rate guidance: keep generic UI at the default rate and reserve 80–120 Hz for high-impact animations.

Primary sources:
- https://docs.flutter.dev/perf/impeller
- https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays
- https://developer.apple.com/documentation/quartzcore/cadisplaylink/preferredframeraterange
- https://developer.android.com/media/optimize/performance/frame-rate
- https://api.flutter.dev/flutter/scheduler/SchedulerBinding/addTimingsCallback.html
- https://api.flutter.dev/flutter/dart-ui/FrameTiming-class.html

### Notes storage and Obsidian sync (post-MVP)

- Vaults are plain Markdown on disk with optional YAML frontmatter; pi-mob should treat that as the authoritative shape rather than store notes in a structured editor’s JSON.
- On Android, use SAF-based pickers for vault location; on iOS, use the document browser plus security-scoped bookmarks. An Obsidian-compatibile vault cannot live in the iOS sandbox without the user picking that path.
- For MVP sync, prefer a small Bun/Node delta service (ETag + SHA-256 + mtime) on the same host as the bridge, exposed via Tailscale Serve. Use Flutter `drift` (SQLite) for app-side metadata/caches and never store notes twice.
- If Obsidian-app interop on both phones is required later, switch to self-hosted LiveSync (CouchDB) over Tailscale Serve. The community `Local REST API` plugin has a known path-traversal CVE and should not be used.
- Do not register the `obsidian://` URI scheme; conflict with the official Obsidian app. Use HTTPS Universal/App Links or a custom scheme.
- Handle `obsidian://` URIs the OS routes into pi-mob via `app_links`.
- Defer: CRDT, full Obsidian plugin parity, excalidraw/canvas/bases editors, custom at-rest encryption, and any public-internet exposure.

Primary sources:
- https://obsidian.md/help/data-storage
- https://help.obsidian.md/uri
- https://github.com/vrtmrz/obsidian-livesync
- https://github.com/vrtmrz/self-hosted-livesync-server
- https://github.com/coddingtonbear/obsidian-local-rest-api/security/advisories/GHSA-62gx-5q78-wrvx
- https://pub.dev/packages/flutter_smooth_markdown
- https://pub.dev/packages/drift
- https://pub.dev/packages/file_picker_next
- https://pub.dev/packages/app_links

## Decisions

- Use Flutter and Dart for the `pi-mob` mobile application.
- Revisit only if product requirements reveal deep platform-native integration that Flutter plugins/platform channels cannot support acceptably.
- Use Material 3 and Flutter's built-in Material widget catalog as the initial design/implementation baseline; do not commit to a third-party component library yet.
- Treat the lookup map above as the durable design-research index; add a new source only when it covers a gap not already mapped.
- Use a Pi-extension-generated QR code as pi-mob's single pairing entry point.
- Treat the user-controlled Tailscale network as pi-mob's sole connection security boundary; do not add application-layer authentication.
- Prefer Tailscale Serve plus a MagicDNS `wss://` bridge endpoint; do not use public Tailscale Funnel.
- Prioritize aggressive connectivity: persistent host execution, foreground WebSocket heartbeats, Android foreground-service support, iOS push/Live Activity updates, and immediate cursor-based replay after every reconnect.

## Next

- Define the first product/research question for the Flutter application.
- When product requirements are known, identify the first screens and create a small design spike with theming, responsive layout, accessibility, and golden-test coverage.
