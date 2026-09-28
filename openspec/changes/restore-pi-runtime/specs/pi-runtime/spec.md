## Purpose

Provide a supervised Pi execution backend for the bridge while keeping mobile clients dependent on the stable durable bridge protocol rather than backend-specific wire formats.

## ADDED Requirements

### Requirement: The normal daemon SHALL run Pi as its execution backend
The production daemon SHALL validate and launch the configured Pi executable for session execution, and SHALL NOT require OMP to start or serve normal mobile sessions.

#### Scenario: Start the daemon with Pi
- **WHEN** an operator supplies a valid workspace and Pi executable
- **THEN** the daemon starts with Pi-backed session execution and exposes the existing mobile bridge services

#### Scenario: OMP is unavailable
- **WHEN** OMP is absent or unavailable but the configured Pi executable is valid
- **THEN** the daemon remains capable of starting Pi-backed sessions

### Requirement: Existing bridge and mobile protocol behavior SHALL remain stable
Switching the execution backend SHALL preserve authenticated pairing, durable command handling, controller leases, stream replay/live delivery, canonical session events, session lifecycle operations, attachments, exports, notifications, and reconnect restoration at the existing mobile-facing contract.

#### Scenario: Reconnect after backend restart
- **WHEN** a mobile client reconnects after the Pi subprocess restarts or the bridge restarts
- **THEN** the client receives the same bridge-scoped session identity and can restore permitted durable state through replay or an explicit indeterminate state

#### Scenario: Canonical event delivery
- **WHEN** Pi emits supported transcript, tool, lifecycle, or terminal events
- **THEN** the bridge normalizes and persists the corresponding canonical events before publishing them to mobile clients

### Requirement: Backend-private data SHALL remain host-side
The mobile protocol SHALL expose bridge session identifiers and canonical payloads only; Pi process arguments, private session paths, raw RPC frames, credentials, and host filesystem details SHALL NOT be exposed.

#### Scenario: Pi session reference is persisted
- **WHEN** the bridge creates or resumes a Pi session
- **THEN** any Pi-specific reference is stored host-side and mobile requests continue to use the bridge session identifier

### Requirement: Unsupported Pi operations SHALL fail boundedly
When a requested mobile or host operation has no supported Pi equivalent, the bridge SHALL return the existing bounded unsupported or unavailable result without silently claiming success or advertising an unavailable capability.

#### Scenario: Unsupported backend operation
- **WHEN** a client requests an operation not supported by the Pi backend
- **THEN** the bridge returns a stable bounded error or unavailable result and keeps the session state consistent

### Requirement: Pi production wiring SHALL be verified
The repository SHALL include construction-path integration coverage and capability/reporting checks proving that the normal daemon constructs Pi and that advertised capabilities correspond to available providers.

#### Scenario: Production capability report
- **WHEN** the capability and production-wiring checks run
- **THEN** they identify Pi as the constructed execution backend and do not require OMP-only providers for the baseline capability set

#### Scenario: Pi subprocess contract
- **WHEN** the real or contract-tested Pi RPC subprocess is started
- **THEN** readiness, request correlation, notifications, bounded frames, cancellation, shutdown, and failure/indeterminate handling are validated
