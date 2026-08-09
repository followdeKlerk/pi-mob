## Purpose

Defines stable bridge session identity and persistence independent of Pi-specific session files, so mobile sessions can reconnect, replay history, and resume OMP execution across daemon restarts.

## ADDED Requirements

### Requirement: Stable bridge session identity

The system SHALL assign each mobile session a stable bridge session identifier that remains valid across reconnects, OMP restarts, and bridge restarts.

#### Scenario: Mobile reconnects

- **WHEN** a paired mobile client reconnects with a previously known session identifier
- **THEN** the bridge SHALL resolve that identifier to the same durable session record
- **AND** it SHALL not create a second session solely because the OMP process was replaced

#### Scenario: OMP reference changes

- **WHEN** OMP replaces or migrates its internal session reference
- **THEN** the bridge SHALL update the backend reference atomically with the session state
- **AND** the mobile-facing session identifier SHALL remain unchanged

### Requirement: Durable session lifecycle

The system SHALL persist session lifecycle, workspace, backend-reference, deletion, and recovery state before exposing the corresponding state to mobile clients.

#### Scenario: Session creation

- **WHEN** a session-create command completes successfully
- **THEN** the bridge SHALL persist the bridge session record and OMP reference
- **AND** it SHALL publish the session as available for subsequent commands

#### Scenario: Session deletion

- **WHEN** a session-delete command is accepted
- **THEN** the bridge SHALL persist the deletion state before reporting deletion to the client
- **AND** it SHALL prevent new commands from targeting the deleted session

#### Scenario: Startup recovery

- **WHEN** the daemon starts with persisted sessions
- **THEN** it SHALL restore session records without relying on insertion order
- **AND** each session SHALL converge to a truthful stopped, running, indeterminate, or unavailable state

### Requirement: Canonical transcript continuity

The system SHALL store canonical session events using one monotonic sequence per bridge session and SHALL preserve replay/live equivalence after OMP migration.

#### Scenario: Replayed OMP history

- **WHEN** a client subscribes after a durable cursor
- **THEN** the bridge SHALL replay only events after that cursor in sequence order
- **AND** the resulting state SHALL match the state produced by receiving the same events live

#### Scenario: Sequence gap

- **WHEN** the client or bridge detects a missing canonical event sequence
- **THEN** the client SHALL request replay from the last durable sequence
- **AND** the bridge SHALL not silently apply later events as if the gap did not exist

### Requirement: Backend reference isolation

The system SHALL prevent host paths, OMP credentials, raw backend payloads, and backend-private identifiers from being exposed through mobile session summaries, logs, fixtures, or exported protocol payloads unless explicitly bounded and authorized.

#### Scenario: Session summary is sent to mobile

- **WHEN** the bridge sends a session summary
- **THEN** it SHALL include the stable bridge session identity and bounded display metadata
- **AND** it SHALL exclude backend credentials, private filesystem paths, and unbounded raw OMP payloads
