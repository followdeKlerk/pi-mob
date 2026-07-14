# M11 Summary — Multi-session control and controller leases

M11 expands the single multiplexed host socket to safely coordinate multiple independent Pi sessions while preserving bounded process, subscription, and controller ownership rules.

## Delivered

- Durable host-stream `session.summary` add/change and `session.removed` events, plus paginated revision-bound list/search/filter/sort operations.
- One full-detail session subscription and at most five bounded summary subscriptions per connection, with per-session decimal cursor tracking.
- Durable acquire, renew, release, reconnect reclaim, explicit takeover, expiry, stale-connection, and SQL uniqueness behavior for controller leases.
- Independent per-session Pi RPC clients, notification routing, process lifecycle, three-process capacity, eligible idle LRU eviction, no-victim errors, idle stop, and lazy restore.
- Mobile session directory, foreground switcher, attention/unread/controller/draft badges, observer and confirmed take-control UX, capacity messaging, bounded subscriptions, and persisted lease/attention state.
- Accessibility and 200% text-scale coverage for the new multi-session widgets.

## Evidence

- `docs/evidence/m11-multi-client-session-report.json`
- `packages/bridge/test/m11-multi-session.test.ts`
- `packages/bridge/test/m11-multi-session-adapter.test.ts`
- `packages/bridge/test/m6-process-supervisor.test.ts`
- `apps/mobile/test/coordinator_multi_session_test.dart`
- `apps/mobile/test/session_directory_test.dart`
- `apps/mobile/test/session_subscriptions_test.dart`
- `apps/mobile/test/controller_lease_test.dart`
- `apps/mobile/test/app_database_m11_test.dart`
- `apps/mobile/test/sessions/sessions_test.dart`
- Root `bun run all`: all typecheck, bridge, fixture, extension, Flutter, schema, documentation, security, and release-build gates passed.
