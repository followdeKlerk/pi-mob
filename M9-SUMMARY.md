# M9 Summary — Production transcript, tools, and composer

M9 replaces the diagnostic raw-event surface with a scalable, accessible one-session transcript and a reliable delivery-aware composer.

## Delivered

- Stable immutable turn/item domain with real Pi-normalized assistant, reasoning, tool, lifecycle, unknown-event, truncation, and parallel-step reduction.
- Active-expanded/completed-collapsed reasoning, selectable safe Markdown answers, HTTP(S)-only links, and bounded unknown content.
- First-class `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` cards plus generic extension tools, explicit running/completed/error/cancelled/policy-denied states, retained/total byte and digest metadata, and expandable large-output details.
- Lazy transcript construction with stable keys, per-turn paint isolation, near-tail pinning, unread/jump-to-latest behavior, anchor-preserving older-history insertion, and a 1,000-turn structural performance gate.
- Durable `session.history.page` over the SQLite journal: 100-item maximum, canonical order, opaque tamper-evident query-bound tokens, revision detection, mobile deduplication, and 100/100/50 boundary proof.
- Persistent multiline composer mode per session. Idle sends immediately; a running turn requires an explicit Steer or Follow up choice. Offline, observer, trust-required, empty, and pending states explain why submission is disabled; Read-only still permits prompts.
- Draft text and mode survive send errors and reconnects and clear only after durable acceptance/current reconciliation.
- Accessible abort semantics, significant-state live regions (never token announcements), selection/copy, 200% text-scale and reduced-motion widget baselines.

## Evidence

- [`docs/evidence/m9-transcript-profile-report.json`](docs/evidence/m9-transcript-profile-report.json)
- `apps/mobile/test/transcript/transcript_domain_test.dart`
- `apps/mobile/test/transcript/widgets/`
- `apps/mobile/test/connection_coordinator_test.dart`
- `packages/bridge/test/session-history-page.test.ts`
- `packages/bridge/test/m4-store.test.ts`

Physical-device frame traces, VoiceOver/TalkBack journey evidence, and release-profile soak remain the comprehensive M16 hardening gate; M9 establishes the deterministic production surface and checkpoint-specific automated baselines.
