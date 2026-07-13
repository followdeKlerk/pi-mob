# Working

Status: M0–M8 done; M9 activation ready

## Current checkpoint

**M9 — Production transcript, tools, and composer**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Turn the installed, trusted one-session path into a scalable accessible transcript with first-class tool rendering and a reliable composer. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M8-SUMMARY.md`](M8-SUMMARY.md).

## Completed foundation

- **M0–M2:** frozen contracts, scaffold, executable protocol schemas, and cross-language fixtures.
- **M3–M4:** exact Pi `0.80.6` RPC adapter and durable SQLite command/event/replay core.
- **M5–M6:** one-session diagnostic mobile client and supervised truthful failure recovery.
- **M7:** portable x64 macOS release, owner-only install, user LaunchAgent, private Serve pairing, doctor/report, update/rollback/uninstall.
- **M8:** canonical workspace roots, resource trust/fingerprint approval, host-enforced Read-only tool hooks, and mobile workspace/trust policy UI.

## Immediate next actions

### 1. Transcript domain and rendering

- Implement stable turn/item models, reasoning states, built-in tool cards, parallel grouping, and generic unknown tools.
- Render Markdown final answers and safe copy/link behavior.

### 2. Long-session behavior

- Add history paging, stable keys, anchor preservation, jump-to-latest, and isolated streaming paint.
- Profile the 1,000-item target and maximum tool output.

### 3. Composer and accessibility

- Preserve multiline drafts across rejection/reconnect and expose explicit immediate/steer/follow-up modes.
- Add accessible abort, state announcements, text-scale, and reduced-motion baselines.

## Do not start yet

Until M9 exits: multi-session control, attachments, extension dialog production UI, push notifications, and later product surfaces.

## Blockers

None requiring a product decision.
