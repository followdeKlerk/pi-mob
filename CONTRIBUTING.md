# Contributing

Thanks for contributing to pi-mob.

Start with:

1. [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
2. [`AGENTS.md`](AGENTS.md)
3. the architecture and protocol documents relevant to your change

pi-mob is a working private alpha. The current priority is proving and hardening the production path, not expanding the repository with broad new feature surfaces.

## Product scope

Contributions should preserve these boundaries:

- the host owns repositories, provider credentials, Pi processes, and durable state;
- the Android app is a reconnectable control and presentation surface;
- private Tailscale Serve is the supported remote path;
- public exposure and multi-user tenancy are not supported;
- Pi keeps its normal execution model;
- **Git integration is out of scope**.

Do not add Git status, commit, push, CI summaries, repository actions, or Git roadmap work. A focused removal of unused experimental Git code is acceptable when dependency and compatibility impact is understood.

## Capability discipline

Use these labels in code reviews and documentation:

- **Production-wired** — constructed by the normal daemon and reachable from the released mobile path.
- **Implemented, not production-wired** — code or UI exists, but the default daemon does not provide it.
- **Planned** — accepted remaining work.
- **Out of scope** — intentionally not planned.

A schema, provider class, widget, or isolated unit test is not enough to call a feature shipped. New capability work should include:

1. production daemon construction;
2. handshake advertisement;
3. coordinator and mobile flow;
4. real integration coverage;
5. accurate documentation and release metadata.

## Development setup

Install the pinned Bun and Flutter versions used by CI.

```sh
bun install --frozen-lockfile
cd apps/mobile && flutter pub get
```

## Validation

Full repository checkpoint:

```sh
bun run all
```

Focused bridge and protocol validation:

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
bun run build
```

Mobile validation:

```sh
cd apps/mobile
flutter analyze --no-fatal-infos
flutter test
```

Documentation-only validation:

```sh
bun run docs:check
```

If a required host, SDK, credential, or service is unavailable, record that limitation. Do not claim a check passed when it was not run.

## Change expectations

- Keep changes focused and reviewable.
- Add regression coverage for behavioural fixes.
- Prefer production-path integration tests over isolated feature claims.
- Preserve durable command, replay, controller-lease, and indeterminate-state guarantees.
- Do not fix startup readiness by merely increasing a timeout.
- Keep unknown forward-compatible events tolerant, but make malformed known-event degradation bounded and observable.
- Update `docs/PROJECT_STATUS.md` whenever production wiring, known gaps, or accepted roadmap scope changes.

## Protocol and generated files

Protocol schemas and fixture corpora are generated artifacts. Change source definitions and generators, then run the generation and check commands. Do not hand-edit generated output.

Consider compatibility before removing existing protocol types, including unused experimental surfaces. Git is out of roadmap scope, but cleanup still requires dependency analysis.

## Security and privacy

Do not commit:

- credentials, private keys, service-account files, or device tokens;
- private host paths or environment values;
- production logs or databases;
- prompts, answers, transcripts, raw tool output, or repository content.

Report vulnerabilities through [SECURITY.md](SECURITY.md).
