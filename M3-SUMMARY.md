# M3 — Real Pi RPC adapter proven

Status: **DONE**

## Outcome

The bridge now controls exact Pi `0.80.6` through a strict subprocess RPC boundary and exports normalized bridge-domain commands/events only.

## Delivered

- Incremental bounded UTF-8 JSONL decoder using LF framing, optional trailing CR, typed malformed/oversized/trailing-record failures, and chunk-boundary correctness.
- Direct absolute Pi spawn with explicit cwd, allowlisted environment/PATH, no shell, separated stdout/stderr, stdin backpressure, correlated requests, duplicate-ID rejection, timeout/cancellation, process-group cleanup, and a bounded redacted stderr ring.
- Complete Pi `0.80.6` command mapping for prompting, state, models/thinking, queue modes, retry/compaction, bash, session lifecycle, tree/entries/messages/stats/commands, and export.
- Normalization for lifecycle, assistant/reasoning deltas, parallel built-in tools, queue, retry, compaction, metadata, and interactive/presentation extension UI.
- Stored session references are prevalidated as regular files before `switch_session`; upstream errors and host paths do not cross the public adapter boundary.
- Deterministic custom fixture provider allowing a real prompt → built-in `read` tool → final answer → `agent_settled` contract without external provider calls or credentials.
- Real corrupt-session and extension-cancelled lifecycle proofs.

## Exact compatibility evidence

```text
package: @earendil-works/pi-coding-agent@0.80.6
cli SHA-256: af302f231437eaf6f37691bce4b34234fcb626bcb5eb3910d4fc3f6519bf78ca
upstream gitHead: 2b3fda9921b5590f285165287bd442a25817f17b
```

The executable/package integrity and upstream source hashes remain in `docs/compatibility/pi-0.80.6.manifest.json`. Sanitized current run evidence is in `docs/compatibility/fixtures/pi-0.80.6/m3-real-contract-report.json`.

## Validation

```text
bun run --cwd packages/bridge m3:contract
bun test packages/bridge/test/pi-real-contract.test.ts
bun run all
```

The real harness proves prompt acceptance, a built-in tool cycle, durable session state, and `agent_settled` after `agent_end`. The adapter test matrix proves `agent_end` alone never emits `turn.settled`, hostile parent environment is not inherited, diagnostics are bounded/redacted, and missing/corrupt/cancelled lifecycle paths remain truthful.

## Next checkpoint

M4 implements the durable SQLite bridge core, replay streams, command idempotency, snapshots, and controller lease persistence against this normalized adapter boundary.
