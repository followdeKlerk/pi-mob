## Purpose

Define the supported Pi-backed bridge runtime and its mobile-facing guarantees.

## ADDED Requirements

### Requirement: Normal daemon runs Pi

The production daemon SHALL validate and supervise the configured Pi executable for mobile session execution.

#### Scenario: Start a session

- **WHEN** an operator supplies a valid workspace and Pi configuration
- **THEN** the daemon starts Pi-backed sessions and exposes the bridge services

### Requirement: Bridge identity and delivery remain stable

The bridge SHALL preserve stable bridge session IDs, authenticated pairing, durable command handling, leases, canonical event persistence, replay/live ordering, attachments, exports, notifications when configured, and reconnect restoration.

#### Scenario: Reconnect after process restart

- **WHEN** a client reconnects after Pi or the bridge restarts
- **THEN** it resumes with the same bridge session identity and receives replay or an explicit indeterminate state

### Requirement: Backend details stay host-side

The mobile protocol SHALL expose bridge identifiers and canonical payloads only. Pi arguments, session paths, credentials, and raw RPC frames SHALL remain host-side.

#### Scenario: Mobile request

- **WHEN** the bridge sends session data to a mobile client
- **THEN** the payload contains no process arguments, host paths, credentials, or raw RPC frames

### Requirement: Unsupported operations fail explicitly

When Pi cannot provide an operation with supported semantics, the bridge SHALL return a bounded unsupported/unavailable result and SHALL NOT advertise the capability.

#### Scenario: Unavailable operation

- **WHEN** a client requests an operation not supported by the Pi runtime
- **THEN** the bridge returns a bounded unsupported/unavailable result and does not advertise that capability

### Requirement: Production capabilities are verified

Integration tests and capability reports SHALL prove that the normal daemon constructs Pi and advertises only available providers.

#### Scenario: Capability report

- **WHEN** production-wiring and capability checks run
- **THEN** they verify the normal daemon's Pi construction and the advertised provider set
