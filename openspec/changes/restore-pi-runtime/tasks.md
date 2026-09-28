## Runtime and state

- [x] Configure the normal daemon and operator CLI to launch supervised Pi RPC sessions.
- [x] Preserve bridge session IDs, durable state, leases, replay, attachments, exports, and configured notifications.
- [x] Keep Pi process details, credentials, and raw RPC host-side; bound transport and output.
- [x] Reconcile Pi history on restart and require explicit recovery when a turn outcome is indeterminate.

## Mobile and capability contract

- [x] Preserve the existing mobile protocol and canonical transcript/event path.
- [x] Update pairing, connection recovery, transcript rendering, activity navigation, composer, and theme.
- [x] Verify production wiring and advertise only implemented capabilities.
- [x] Align project, build, release, and privacy documentation with the Pi runtime and actual release state.

## Validation

- [x] `bun install --frozen-lockfile`, typecheck, schema, fixture, test, build, and docs checks pass on the project CI platform.
- [x] Flutter analyze and tests pass.
- [x] Validate this change with `openspec validate restore-pi-runtime --type change`.
