# @pi-mob/protocol-schema

Reserved canonical schema package. M2 populates the TypeBox envelopes,
JSON Schema output, and command/event/error catalogue here. M1 only
ships the protocol identity constants consumed by the bridge and the
fixtures package, plus a stub generator so `bun run schema:generate`
and `bun run schema:check` have a deterministic target.
