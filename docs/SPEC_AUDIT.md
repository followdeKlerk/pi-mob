# Specification coverage audit

Status: final planning coverage review before scaffold.

This audit answers: **Have we specified enough to begin implementation without carrying hidden product or architecture decisions into code?**

Conclusion: **Yes.** No known product/architecture choice blocks M1. Remaining M0 work is executable evidence against real Pi and actual build toolchains.

## Audit scale

```text
SPECIFIED   normative behaviour and failure semantics exist
VERIFIED    current upstream/platform assumption checked against primary source
PROVE IN M# implementation/test evidence required at named checkpoint
DEFERRED    explicitly post-MVP with review trigger
```

## 1. Product and scope

| Concern | Status | Normative source | Implementation proof |
|---|---|---|---|
| Product job | SPECIFIED | PRODUCT §§1–4 | M5/M17 |
| Primary user | SPECIFIED | PRODUCT §2 | M17 |
| User journeys | SPECIFIED | PRODUCT §6 | M5–M17 |
| Functional requirements | SPECIFIED | PRODUCT §7 | M5–M15 |
| Nonfunctional requirements | SPECIFIED | PRODUCT §8 | M16 |
| MVP boundary | SPECIFIED | PRODUCT §§9–10 | M17 |
| Success criteria | SPECIFIED | PRODUCT §11 | M17 |
| Non-goals | SPECIFIED | PRODUCT §10 | Review backlog |
| Review triggers | SPECIFIED | PRODUCT §12; DECISIONS | Ongoing |

No open scope decision blocks scaffold.

## 2. User/security assumption

| Concern | Status | Source | Proof |
|---|---|---|---|
| One human owner | SPECIFIED | PRODUCT; SECURITY; D-004 | M17 |
| Tailscale-only connection auth | SPECIFIED | SECURITY; D-005 | M7/M16 |
| No app account/password/token | SPECIFIED | SECURITY | M7/M16 |
| No biometric app lock | SPECIFIED | SECURITY | Accepted risk |
| Authorized tailnet-node risk | SPECIFIED | SECURITY §§4,9 | Owner operations |
| Lost unlocked phone | SPECIFIED | SECURITY §§4,7,8 | M16 |
| Multi-user trigger | DEFERRED | SECURITY §11; backlog P3-05 | New design required |
| Public access trigger | DEFERRED | SECURITY §11; backlog P3-06 | New design required |

## 3. Network and pairing

| Concern | Status | Source | Proof |
|---|---|---|---|
| Loopback listener | SPECIFIED | ARCHITECTURE; RUNTIME; SECURITY | M7/M16 |
| Tailscale Serve | SPECIFIED/VERIFIED | RUNTIME; RELEASE | M7 |
| No Funnel | SPECIFIED | SECURITY; RUNTIME | M7/M16 |
| Stable host identity | SPECIFIED | ARCHITECTURE; DATA_MODEL | M4/M7 |
| Host generation after restore | SPECIFIED | PROTOCOL; DATA_MODEL | M4/M16 |
| Pairing QR content | SPECIFIED | PROTOCOL §3 | M7 |
| Manual endpoint recovery | SPECIFIED | PRODUCT; UX | M5/M7 |
| Standard TLS validation | SPECIFIED | PROTOCOL | M7 |
| No certificate pinning | SPECIFIED | PROTOCOL; DECISIONS | M7 |

## 4. Connection and protocol

| Concern | Status | Source | Proof |
|---|---|---|---|
| One socket per host | SPECIFIED | ARCHITECTURE; PROTOCOL; D-008 | M4/M11 |
| Host stream | SPECIFIED | ARCHITECTURE; PROTOCOL | M4 |
| Session streams | SPECIFIED | ARCHITECTURE; PROTOCOL | M4 |
| Subscription detail levels | SPECIFIED | PROTOCOL §§7–8 | M4/M11 |
| Cursor precision | SPECIFIED | PROTOCOL; D-010 | M2/M4 |
| Replay | SPECIFIED | PROTOCOL §9 | M4/M5 |
| Atomic snapshot | SPECIFIED | PROTOCOL §9; DATA_MODEL | M4 |
| Gap/conflicting duplicate | SPECIFIED | PROTOCOL §9 | M4/M6 |
| Host restore invalidation | SPECIFIED | PROTOCOL §§4,25 | M16 |
| Handshake/capabilities | SPECIFIED | PROTOCOL §4 | M2/M4 |
| Error catalogue | SPECIFIED | PROTOCOL §21 | M2/M4 |
| Limits/backpressure | SPECIFIED | PROTOCOL §22 | M4/M6/M16 |
| Heartbeat/reconnect | SPECIFIED | PROTOCOL §23 | M5/M15 |
| Clock skew | SPECIFIED | PROTOCOL §24 | M2/M4 |
| Schema source/generation | SPECIFIED | PROTOCOL §26; D-032 | M2 |
| Cross-language fixtures | SPECIFIED | PROTOCOL §27; TESTING | M2 |

Critical earlier issue closed: protocol cursors are decimal strings rather than unsafe JSON 64-bit numbers.

## 5. Command correctness

| Concern | Status | Source | Proof |
|---|---|---|---|
| Client command ID | SPECIFIED | PROTOCOL §11 | M2/M4 |
| Semantic payload hash | SPECIFIED | PROTOCOL §11; DATA_MODEL | M2/M4 |
| Durable-before-ack | SPECIFIED | PROTOCOL; DATA_MODEL | M4 |
| Same ID/same payload | SPECIFIED | PROTOCOL | M4/M5 |
| Same ID/different payload | SPECIFIED | PROTOCOL | M4 |
| Accepted-before-dispatch recovery | SPECIFIED | PROTOCOL; RUNTIME | M4/M6 |
| Running-at-crash indeterminate | SPECIFIED | PRODUCT; D-012 | M6 |
| No automatic rerun | SPECIFIED | SECURITY; TESTING | M6/M17 |
| Host/session command serialization | SPECIFIED | ARCHITECTURE; RUNTIME | M4 |
| Full command catalogue | SPECIFIED | PROTOCOL §13 | M2/M3 |
| Stable command-state events | SPECIFIED | PROTOCOL §§11,14–15 | M2/M4 |

## 6. Multi-client concurrency

| Concern | Status | Source | Proof |
|---|---|---|---|
| Observer vs controller | SPECIFIED | ARCHITECTURE; UX | M11 |
| One controller lease | SPECIFIED | D-013; PROTOCOL §10 | M4/M11 |
| Renewal/expiry | SPECIFIED | PROTOCOL | M11 |
| Same-install reclaim | SPECIFIED | PROTOCOL | M11 |
| Explicit takeover | SPECIFIED | PROTOCOL; UX | M11 |
| Stale socket rejection | SPECIFIED | PROTOCOL | M11 |
| Dual-acquisition DB race | SPECIFIED | DATA_MODEL; TESTING | M4/M11 |

## 7. Pi upstream integration

| Concern | Status | Source | Proof |
|---|---|---|---|
| Current upstream repo/package | VERIFIED | TOOLCHAIN; D-033 | M0 manifest |
| Exact initial Pi version | VERIFIED | TOOLCHAIN | M3 |
| Subprocess RPC boundary | SPECIFIED/VERIFIED | D-003; ARCHITECTURE | M3 |
| Strict LF JSONL | SPECIFIED/VERIFIED | PROTOCOL adapter boundary; TESTING | M3 |
| `agent_settled` semantics | VERIFIED | PRODUCT/RUNTIME/TESTING | M3 |
| RPC command mapping | SPECIFIED | PROTOCOL catalogue | M3 |
| Extension UI mapping | SPECIFIED | PROTOCOL; UX | M3/M14 |
| Tool policy blocking hook | VERIFIED | SECURITY; RUNTIME | M3/M8 |
| Durable session fixtures | PROVE IN M3 | BACKLOG M3.4 | M3 |
| Resource trust discovery | PROVE IN M0/M8 | WORKING; BACKLOG | M0/M8 |
| Upstream update process | SPECIFIED | RELEASE; TESTING | Ongoing |

Remaining uncertainty is evidence from the pinned executable, not an undecided architecture.

## 8. Process lifecycle and capacity

| Concern | Status | Source | Proof |
|---|---|---|---|
| One process per active session | SPECIFIED | D-014; RUNTIME | M6/M11 |
| Three-process default | SPECIFIED | D-015 | M11 |
| Configurable 1–8 | SPECIFIED | DEFAULTS; RUNTIME | M11 |
| Idle stop | SPECIFIED | RUNTIME | M6/M11 |
| Eligible LRU eviction | SPECIFIED | RUNTIME | M11 |
| No running eviction | SPECIFIED | PRODUCT; RUNTIME | M11 |
| Process groups | SPECIFIED | RUNTIME | M3/M6 |
| Grace/forced cleanup | SPECIFIED | RUNTIME | M6 |
| Restart/crash loop | SPECIFIED | RUNTIME | M6 |
| Host drain/reboot | SPECIFIED | RUNTIME; PROTOCOL | M6/M7 |
| Orphan limitation | SPECIFIED | SECURITY accepted risk | M6 diagnostics |

## 9. Host environment and platform

| Concern | Status | Source | Proof |
|---|---|---|---|
| Bun 1.3.14 | VERIFIED | TOOLCHAIN; RELEASE | M1 |
| macOS 13+ floor | VERIFIED | TOOLCHAIN; RELEASE | M1/M7 |
| Flutter 3.44.4 | VERIFIED | TOOLCHAIN | M1 |
| Dart 3.12.2 pair | SELECTED | TOOLCHAIN | M1 archive check |
| Android minSdk 29 | SPECIFIED/VERIFIED | TOOLCHAIN; DEFAULTS | M1 |
| iOS target 16.1 | SPECIFIED | TOOLCHAIN | M1 |
| Direct Pi spawn | SPECIFIED | D-019; RUNTIME | M3/M7 |
| No login shell/profile | SPECIFIED | RUNTIME; SECURITY | M3/M7 |
| Explicit PATH/env allowlist | SPECIFIED | RUNTIME | M7 |
| Compiled executable | SPECIFIED/VERIFIED | RELEASE | M1/M7 |
| Disable Bun `.env`/bunfig autoload | SPECIFIED/VERIFIED | TOOLCHAIN; RELEASE | M1/M7 |
| Architecture artifacts | PROVE IN M1 | TOOLCHAIN | M1 |
| Xcode/Android build pins | PROVE IN M1 | TOOLCHAIN | M1 |

Critical earlier issue closed: Bun's macOS 13 requirement supersedes obsolete Catalina support language.

## 10. Workspaces and trust

| Concern | Status | Source | Proof |
|---|---|---|---|
| Configured roots | SPECIFIED | DEFAULTS; RUNTIME | M8 |
| Recents/search UX | SPECIFIED | PRODUCT; UX | M8 |
| Search bounds/exclusions | SPECIFIED | RUNTIME | M8 |
| No full filesystem browser | SPECIFIED | PRODUCT | M8 |
| Canonicalization/symlinks | SPECIFIED | SECURITY; RUNTIME | M8/M16 |
| Root-relative mobile paths | SPECIFIED | DATA_MODEL; RUNTIME | M8 |
| Trust resource manifest | SPECIFIED | DATA_MODEL; RUNTIME | M8 |
| Fingerprint invalidation | SPECIFIED | RUNTIME | M8 |
| Approval UX | SPECIFIED | UX | M8 |
| Full/read-only modes | SPECIFIED | D-022 | M8 |
| No sandbox claim | SPECIFIED | D-023; SECURITY | M8/M17 |

## 11. Prompting, steering, and queues

| Concern | Status | Source | Proof |
|---|---|---|---|
| Immediate prompt | SPECIFIED | PROTOCOL §12 | M5 |
| Explicit steer/follow-up | SPECIFIED | PRODUCT; UX | M9 |
| Steering maps to Pi | SPECIFIED | ARCHITECTURE | M3/M9 |
| Bridge-owned follow-up queue | SPECIFIED | D-016; RUNTIME | M14 |
| Queue capacity/order | SPECIFIED | PROTOCOL; DATA_MODEL | M14 |
| Queue remove/clear | SPECIFIED | PROTOCOL; UX | M14 |
| Queue restart recovery | SPECIFIED | RUNTIME; TESTING | M14 |
| Attachment retention in queue | SPECIFIED | DATA_MODEL | M13/M14 |
| Abort does not silently clear | SPECIFIED | PROTOCOL | M14 |
| No automatic offline send | SPECIFIED | D-017; UX | M5/M9 |
| Draft clear after acceptance | SPECIFIED | UX; PROTOCOL | M5 |

## 12. Transcript and tools

| Concern | Status | Source | Proof |
|---|---|---|---|
| Reasoning/tool/final surfaces | SPECIFIED | UX; DEFAULTS | M9 |
| Streaming and completion | SPECIFIED | PROTOCOL; UX | M9 |
| Built-in tool cards | SPECIFIED | UX | M9 |
| Unknown extension tools | SPECIFIED | UX; PROTOCOL | M9 |
| Parallel tools | SPECIFIED/VERIFIED | UX; TESTING | M3/M9 |
| Tool truncation | SPECIFIED | PROTOCOL | M6/M9 |
| History paging | SPECIFIED | PROTOCOL; UX | M9 |
| Scroll anchor/pinning | SPECIFIED | UX | M9 |
| Copy/selection | SPECIFIED | UX | M9/M16 |
| Unknown event fallback | SPECIFIED | PROTOCOL; UX | M2/M9 |

## 13. Session management

| Concern | Status | Source | Proof |
|---|---|---|---|
| Create/resume/name/list/search | SPECIFIED | PRODUCT; PROTOCOL; UX | M11/M12 |
| Runtime states | SPECIFIED | ARCHITECTURE; UX | M6–M12 |
| Multi-session summaries | SPECIFIED | ARCHITECTURE; PROTOCOL | M11 |
| Switcher/subscriptions | SPECIFIED | UX; PROTOCOL | M11 |
| Tree | SPECIFIED | PRODUCT; UX | M12 |
| Fork/clone | SPECIFIED | PROTOCOL; UX | M12 |
| Extension-cancelled branch operation | SPECIFIED | TESTING | M12 |
| Soft delete | SPECIFIED | DATA_MODEL; UX | M12 |
| Seven-day restore | SPECIFIED | DATA_MODEL | M12 |
| Purge | SPECIFIED | DATA_MODEL; PROTOCOL | M12 |
| Partial deletion repair | SPECIFIED | DATA_MODEL | M12 |

## 14. Models/context/retry/compaction/commands

| Concern | Status | Source | Proof |
|---|---|---|---|
| Configured host model list | SPECIFIED | PRODUCT; UX | M10 |
| Model/thinking set | SPECIFIED | PROTOCOL | M10 |
| Provider setup host-only | SPECIFIED | PRODUCT; SECURITY | M10 |
| Stats/cost unknown states | SPECIFIED | PRODUCT; UX | M10 |
| No spend cap claim | SPECIFIED | DEFAULTS | M10 |
| Retry/abort retry | SPECIFIED | PROTOCOL; UX | M10 |
| Manual/auto compaction | SPECIFIED | PROTOCOL; UX | M10 |
| Command palette discovery | SPECIFIED | PRODUCT; UX | M10 |
| Exclude TUI-only parity | SPECIFIED | PRODUCT | M10 |

## 15. Attachments and exports

| Concern | Status | Source | Proof |
|---|---|---|---|
| HTTPS outside WebSocket | SPECIFIED | D-024; PROTOCOL | M13 |
| JPEG/PNG only | SPECIFIED | D-025 | M13 |
| Mobile strip/resize | SPECIFIED | PRODUCT; UX | M13 |
| Host verify/decode/dimensions | SPECIFIED | SECURITY; RUNTIME | M13 |
| Size/count bounds | SPECIFIED | PROTOCOL | M13 |
| Retry idempotency | SPECIFIED | DATA_MODEL; PROTOCOL | M13 |
| Opaque storage IDs | SPECIFIED | SECURITY | M13 |
| Expiry/cleanup | SPECIFIED | DATA_MODEL | M13 |
| Host-side HTML export | SPECIFIED | D-028 | M13 |
| Private short-lived download | SPECIFIED | PROTOCOL | M13 |
| Explicit OS share | SPECIFIED | UX | M13 |
| No public links | SPECIFIED | PRODUCT | M13 |

## 16. Extension UI

| Concern | Status | Source | Proof |
|---|---|---|---|
| select/confirm/input/editor | SPECIFIED | PROTOCOL; UX | M14 |
| notify/status/widget/title/prefill | SPECIFIED | PROTOCOL; UX | M14 |
| Stable dialog ID | SPECIFIED | DATA_MODEL | M14 |
| Expiry | SPECIFIED | PROTOCOL | M14 |
| Reconnect replay | SPECIFIED | RUNTIME | M14 |
| Duplicate response | SPECIFIED | PROTOCOL | M14 |
| No invented default | SPECIFIED | SECURITY; UX | M14 |
| Focus/keyboard/accessibility | SPECIFIED | UX | M14/M16 |

## 17. Notifications/background

| Concern | Status | Source | Proof |
|---|---|---|---|
| Host continues after disconnect | SPECIFIED | PRODUCT; RUNTIME | M5/M15 |
| iOS background socket not guaranteed | SPECIFIED/VERIFIED | DEFAULTS; UX | M15 |
| Android foreground restriction | SPECIFIED/VERIFIED | DEFAULTS; RELEASE | M15 |
| APNs/FCM host credentials | SPECIFIED | SECURITY; RUNTIME | M15 |
| Token lifecycle | SPECIFIED | DATA_MODEL | M15 |
| Status-only payload | SPECIFIED | D-026; SECURITY | M15/M16 |
| No mutating notification action | SPECIFIED | D-027 | M15 |
| Stale deep-link reconciliation | SPECIFIED | UX | M15 |
| Push failure degrades only push | SPECIFIED | RUNTIME | M15 |
| Live Activity content/lifecycle | SPECIFIED | UX | M15 |

## 18. Persistence, retention, migration, recovery

| Concern | Status | Source | Proof |
|---|---|---|---|
| SQLite WAL | SPECIFIED | D-018; DATA_MODEL | M4 |
| Complete entity model | SPECIFIED | DATA_MODEL | M4–M15 |
| Mobile Drift cache | SPECIFIED | DATA_MODEL | M5 |
| Event/command retention | SPECIFIED | DATA_MODEL | M4/M16 |
| Attachment/export retention | SPECIFIED | DATA_MODEL | M13 |
| Backups | SPECIFIED | DATA_MODEL; RUNTIME | M16 |
| Restore/host generation | SPECIFIED | DATA_MODEL; PROTOCOL | M16 |
| Migration classification | SPECIFIED | DATA_MODEL; RELEASE | M4/M16 |
| Database full/read-only | SPECIFIED | RUNTIME; TESTING | M4/M6 |
| Integrity/repair | SPECIFIED | DATA_MODEL; RUNTIME | M16 |
| Forget host/local deletion | SPECIFIED | DATA_MODEL; UX | M5/M16 |

## 19. Logging, diagnostics, incident response

| Concern | Status | Source | Proof |
|---|---|---|---|
| Structured metadata logs | SPECIFIED | RUNTIME | M1/M16 |
| Content/secret exclusions | SPECIFIED | SECURITY; RUNTIME | M16 |
| Rotation | SPECIFIED | RUNTIME | M7 |
| `/healthz` and `/readyz` | SPECIFIED | RUNTIME | M4/M7 |
| Doctor checks | SPECIFIED | RUNTIME; UX | M7/M16 |
| Redacted report | SPECIFIED | SECURITY; UX | M7/M16 |
| Lost-phone procedure | SPECIFIED | SECURITY | M16 |
| Host-compromise procedure | SPECIFIED | SECURITY | Operations |
| Accidental-public exposure response | SPECIFIED | SECURITY | M16 |

## 20. Accessibility, performance, and bounds

| Concern | Status | Source | Proof |
|---|---|---|---|
| VoiceOver/TalkBack | SPECIFIED | PRODUCT; UX; TESTING | M16 |
| 200% text | SPECIFIED | UX; TESTING | M16 |
| Switch/keyboard/voice | SPECIFIED | UX; TESTING | M16 |
| Reduced motion | SPECIFIED | UX | M16 |
| Streaming announcements | SPECIFIED | UX | M9/M16 |
| Transcript performance | SPECIFIED | PRODUCT; TESTING | M9/M16 |
| High refresh best effort | SPECIFIED/VERIFIED | TOOLCHAIN; DEFAULTS | M16 |
| Bounded messages/output/queues | SPECIFIED | PROTOCOL | M4/M16 |
| Cache/journal/log caps | SPECIFIED | DATA_MODEL; RUNTIME | M16 |
| Soak/resource tests | SPECIFIED | TESTING | M16 |

## 21. Build, install, update, rollback, distribution

| Concern | Status | Source | Proof |
|---|---|---|---|
| Repository scaffold | SPECIFIED | ARCHITECTURE; BACKLOG | M1 |
| Exact dependency policy | SPECIFIED | RELEASE; TOOLCHAIN | M1 |
| CI layers | SPECIFIED | RELEASE; TESTING | M1+ |
| Compiled bridge | SPECIFIED/VERIFIED | RELEASE; TOOLCHAIN | M1/M7 |
| Deterministic config autoload | SPECIFIED/VERIFIED | RELEASE; TOOLCHAIN | M1/M7 |
| LaunchAgent | SPECIFIED | RUNTIME; RELEASE | M7 |
| Serve installer | SPECIFIED | RELEASE | M7 |
| Update/drain/backup | SPECIFIED | RELEASE | M7/M16 |
| Rollback classes | SPECIFIED | RELEASE | M7/M16 |
| Uninstall variants | SPECIFIED | RELEASE | M7 |
| TestFlight/private Android | SPECIFIED | PRODUCT; RELEASE | M17 |
| Public store launch | DEFERRED | BACKLOG P3-12 | New review |
| Automatic updater | DEFERRED | D-030 | New design |

## 22. Test and fault coverage

| Concern | Status | Source | Proof |
|---|---|---|---|
| Protocol fixtures | SPECIFIED | TESTING | M2 |
| Pi property/fuzz | SPECIFIED | TESTING | M3 |
| Real Pi contracts | SPECIFIED | TESTING | M3 |
| DB/migration faults | SPECIFIED | TESTING | M4/M6 |
| Idempotency crash windows | SPECIFIED | TESTING | M4–M6 |
| Lease races | SPECIFIED | TESTING | M11 |
| Queue crash/removal | SPECIFIED | TESTING | M14 |
| Trust/path/policy | SPECIFIED | TESTING | M8/M16 |
| Device lifecycle/push | SPECIFIED | TESTING | M15 |
| Accessibility/performance/security | SPECIFIED | TESTING | M16 |
| Install/update/rollback | SPECIFIED | TESTING | M7/M16 |
| Release failure matrix | SPECIFIED | TESTING | M17 |

## 23. Delivery and backlog

| Concern | Status | Source |
|---|---|---|
| Achievable checkpoints | SPECIFIED | BACKLOG M0–M17 |
| Dependencies | SPECIFIED | BACKLOG checkpoint map |
| Task IDs/priorities/effort | SPECIFIED | BACKLOG |
| Checkpoint demos | SPECIFIED | BACKLOG |
| Exit criteria/evidence | SPECIFIED | BACKLOG |
| Cross-cutting work | SPECIFIED | BACKLOG C-01–C-06 |
| Post-MVP boundaries | SPECIFIED | BACKLOG P3-01–P3-12 |
| Immediate next work | SPECIFIED | WORKING |

## 24. Hard decisions resolved in this audit

The second audit explicitly resolved:

1. One multiplexed WebSocket per host, not per session.
2. Independent replayable host and session streams.
3. Decimal-string cursors rather than unsafe 64-bit JSON numbers.
4. Atomic snapshot plus post-baseline replay.
5. One controller lease per session for multi-client race prevention.
6. Bridge-owned durable follow-up queue.
7. No automatic sending of offline drafts.
8. Direct Pi spawn with explicit environment; no login shell.
9. Stable host generation after state rollback/restore.
10. Complete host/mobile data model and repair states.
11. Soft delete/restore/purge and partial deletion repair.
12. Host-side HTML export plus explicit OS sharing; no public links.
13. Status-only notifications and no mutating push actions.
14. Private TestFlight/signed Android distribution first.
15. Current Pi repository/package/version source of truth.
16. Bun `1.3.14` and macOS `13+` host floor.
17. Disable automatic `.env` and `bunfig.toml` loading in compiled bridge.
18. M0–M17 checkpoint decomposition with independent demos.

## 25. Remaining uncertainties

These are implementation evidence, not product design gaps:

- exact pinned Pi executable/package/document hashes,
- real Pi durable session and resource-discovery behaviour,
- exact Flutter archive checksum for the development architecture,
- actual Xcode/iOS and Android build-tool versions that pass generated release builds,
- actual bridge architecture artifacts to ship,
- performance numbers on selected real devices,
- APNs/FCM/ActivityKit behaviour with real credentials/devices,
- plugin choices after M1/M2 constraints are executable.

Each is assigned to a backlog checkpoint with a failure path.

## 26. Final readiness judgment

The repository is sufficiently specified to start M1.

Do not perform another broad planning pass before scaffold unless:

- a real upstream/toolchain test contradicts a normative assumption,
- the single-user/Tailscale-only premise changes,
- the product expands into terminal/IDE/public/multi-user/sandbox territory,
- Pi removes or materially changes RPC mode.

Otherwise, new discoveries should become bounded backlog tasks or decision updates, not reopen the entire architecture.
