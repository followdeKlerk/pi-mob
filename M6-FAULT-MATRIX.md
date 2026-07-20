# M6 deterministic failure matrix

Validated against the M6 bridge/mobile implementation on 2026-07-13.

| Fault | Expected truth | Executable evidence |
|---|---|---|
| Close socket after acceptance / lost receipt | Settled or current durable command; one dispatch | `m6-fault-matrix.test.ts`, `m4-demo.test.ts` |
| Close after dispatch / RPC outcome lost | `indeterminate`; never automatic rerun | `one-session-adapter.test.ts`, `m6-supervised-rpc.test.ts` |
| Pause outbound / slow consumer | Client drops; producer settles; ordered replay matches | `m6-slow-consumer.test.ts`, `m4-server.test.ts` |
| Kill Pi after events | Running turn becomes `indeterminate`; process restarts below threshold | `m6-supervised-rpc.test.ts`, `m6-process-supervisor.test.ts` |
| Kill bridge after transition / reboot | Running durable state becomes `indeterminate`; explicit activation required | `m6-daemon-recovery.test.ts`, `m4-domain.test.ts` |
| Invalid/expired/ahead cursor | Reject or atomic repair without affecting other streams | `m4-domain.test.ts`, Flutter reducer/coordinator tests |
| Host generation change | Cache/command quarantine; draft retained; fresh snapshot | Flutter coordinator/database tests |
| Oversized tool output | Turn continues; bounded retained/total/digest metadata | `m6-output.test.ts` |
| Provider interruption | Visible failed/provider-interrupted state; no silent retry | normalizer and Flutter M6 state tests |
| Database full/unavailable/locked | No acceptance; host degraded | `m4-store.test.ts`, `m4-server.test.ts` |
| Cleanup timeout | Forced process-group cleanup; bounded redacted diagnostics | `m6-process-supervisor.test.ts` |
| Crash loop | Three exits/five minutes; no auto-start; manual activation only | `m6-process-supervisor.test.ts`, `m6-daemon-recovery.test.ts` |
| Capacity/idle | LRU eligible idle only; running/attention retained; 30-minute stop | `m6-process-supervisor.test.ts` |
| Host drain | New commands rejected before commit; idle processes stop | `m6-drain-admission.test.ts`, supervisor tests |
| Dialog/file/migration/notification failures | Deterministic one-shot test controls ready for their owning later checkpoints; no execution authority impact | `m6-fault-matrix.test.ts` |

## Test-only controls

`src/testing/fault-injector.ts` contains the explicit test inventory and one-shot/countdown plans. There is no network endpoint. The real server accepts only an in-process test hook. The daemon release dependency graph is built and inspected in `m6-fault-matrix.test.ts`; named controls and `TestFaultInjector` are absent.

## Invariants proven

- Accepted-undispatched work may resume; running/unknown work becomes indeterminate.
- An indeterminate prompt cannot be submitted again until explicit activation.
- Capacity and idle cleanup never evict running, waiting, compacting, queued/attention sessions.
- Shutdown waits for graceful exit or awaited process-group kill.
- Output and diagnostics remain bounded and path/credential-redacted.
