# Raw RPC rectification — historical progress snapshot

> **Archived snapshot from 24 July 2026.** This file no longer describes the current project status or next work. Use [Project status and roadmap](PROJECT_STATUS.md).

## Purpose of the rectification

The rectification work aligned pi-mob with Pi's normal execution model and removed architectural assumptions that made the bridge a curated, policy-owning wrapper rather than a durable mobile transport.

## Work completed in the rectification

### Shared Pi launch environment

- Added one `PiLaunchConfig` shared by model discovery, primary RPC, and per-session RPC.
- Captured a sanitized owner login-shell environment.
- Preserved the owner's usable PATH and provider configuration.
- Fixed mixed-case and empty environment-variable handling found during real installation.

### Generic raw RPC

- Added `pi.rpc.request`, `pi.rpc.response`, and `pi.rpc.event` protocol envelopes.
- Added the `raw_rpc.v1` capability.
- Implemented a generic dispatcher with bounded outer validation and no Pi method allowlist.
- Passed unknown Pi events through alongside curated projections.
- Added Flutter protocol models, coordinator handling, and an advanced raw-RPC UI.

### Removal of bridge-owned policy and trust workflow

- Removed the default policy extension package and automatic extension injection.
- Removed bridge-owned workspace trust approval and session read-only policy surfaces.
- Kept explicit operator-supplied extension loading.
- Returned behavioural policy to Pi's normal execution model.

### RPC deduplication

- Added one shared adapter helper for direct Pi RPC mappings.
- Routed common session controls, prompt delivery, abort, rename, clone, fork, export, and capability refresh through that helper.

### Tests and reports

- Added cross-language protocol fixtures and integration coverage for environment parity, provider visibility, raw RPC pass-through, unknown methods/events, guardrail regression, and existing behaviour.
- Produced the dated final report retained in [RECTIFICATION_FINAL_REPORT.md](RECTIFICATION_FINAL_REPORT.md).

## What changed after this snapshot

Subsequent work:

- integrated the raw RPC and R7–R12 implementation lines into `main`;
- diagnosed and fixed quadratic external-history recipe projection;
- removed full SQLite integrity verification from ordinary startup;
- added bounded workspace discovery and more stable workspace identities;
- improved mobile connection tolerance for forward-compatible durable events;
- corrected cumulative tool-progress handling and subagent output amplification;
- simplified the primary mobile shell and inline subagent presentation.

## Current interpretation

The rectification succeeded in making the durable core and generic Pi transport real. It did **not** prove that every advanced optional provider in the repository is production-wired.

The default daemon currently wires the durable core, raw RPC, Pi adapter, sessions, attachments, exports, optional notifications, and optional workspace search roots. It does not inject the advanced providers for attention, first-class agent supervision, catalogues, plans, context, file browsing, or process output.

Git integration is out of scope and is not part of the current roadmap.

## Remaining relevant work

- bind the loopback listener before bulk history synchronization;
- add explicit initialization phases and checkpointed history batches;
- prove advertised capabilities through the real daemon construction;
- make isolated known-event projection failures observable;
- wire selected mobile-native providers only with end-to-end production proof;
- harden signing, versioning, platform support, and upgrades.

See [Project status and roadmap](PROJECT_STATUS.md) for the ordered plan.

## Historical evidence

The original detailed snapshot, including host-specific paths, process IDs, test counts, APK hashes, pairing payloads, and unresolved hypotheses, remains available in repository history. Those details were intentionally removed from the active documentation set because they are not stable product guidance and may expose unnecessary host metadata.
