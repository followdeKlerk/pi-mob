# M8 Summary — Workspaces, trust, and read-only policy

M8 adds host-allowed workspace discovery, explicit project-resource trust, and a real host-side Read-only guardrail.

## Delivered

- Canonical allowed roots with stable UUID-shaped IDs, root-relative mobile display paths, recents, and bounded/cancellable directory-name search.
- Realpath containment and fail-closed traversal/symlink handling; mobile can select only server-returned candidates.
- Pinned Pi `0.80.6` trust discovery for project settings, system prompts, extensions, skills, prompts, and themes. Nested files are sorted and SHA-256 fingerprinted; resource symlinks are rejected.
- Durable SQLite trust approvals and host policy; changed fingerprint/policy invalidates approval.
- Trust is evaluated before Pi starts and again immediately before `Bun.spawn`. New workspaces do not auto-approve.
- Exact turn policy snapshots are durably stored/emitted and published immediately before prompt dispatch.
- A real Pi extension intercepts `tool_call` before execution. Read-only permits conservative read operations and denies write/edit, mutating shell/package/VCS/destructive/unknown tools by default. Full mode remains explicit.
- Mobile workspace picker, unavailable/changed trust review, Full/Read-only choices, persistent indicator, and explicit wording that the feature is a tool guardrail—not an OS sandbox.

## Exit evidence

- Picker/path containment: `m8-bridge-policy.test.ts`, mobile `workspace_policy_test.dart`.
- Trust invalidation/start gate: recursive nested-resource and symlink tests plus real daemon trust-before-spawn proof.
- Host enforcement: `packages/pi-extension/test/policy.test.ts`, `extension.test.ts`, and `m8-real-readonly.test.ts` using real pinned Pi; Read-only blocks a write before execution and Full permits it.
- Durable snapshot: `session.policy` event and restart replay tests.
- Report: [`docs/evidence/m8-trust-policy-report.json`](docs/evidence/m8-trust-policy-report.json).

Read-only is intentionally not described as confinement. Full-mode shell and host permissions can access outside a selected workspace; M8 provides explicit selection/trust scope and a conservative Pi tool-hook guardrail.
