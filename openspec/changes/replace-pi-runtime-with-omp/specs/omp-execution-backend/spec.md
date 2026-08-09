## Purpose

Provides a durable, supervised OMP execution backend for Pi Mob while keeping agent-specific process, command, event, and recovery behavior behind the bridge's existing mobile-facing contract.

## ADDED Requirements

### Requirement: Supervised OMP execution

The system SHALL supervise OMP execution for every active mobile session and SHALL expose bounded lifecycle states for starting, running, draining, stopped, crashed, and indeterminate execution.

#### Scenario: Session starts

- **WHEN** the bridge accepts a command that requires an inactive OMP session
- **THEN** the system SHALL start or resume the OMP session before dispatching the command
- **AND** the session SHALL not be reported as running until OMP is ready to accept work

#### Scenario: OMP exits unexpectedly

- **WHEN** an OMP process or service becomes unavailable while a session is active
- **THEN** the system SHALL record the backend failure
- **AND** the session SHALL enter a bounded recovery state
- **AND** the bridge SHALL not silently report the session as idle

#### Scenario: Bridge drains

- **WHEN** the bridge begins shutdown
- **THEN** the system SHALL stop accepting new backend work
- **AND** it SHALL give active OMP operations their configured drain window
- **AND** unfinished operations SHALL be recovered as completed, failed, cancelled, or indeterminate on the next startup

### Requirement: OMP command and event translation

The system SHALL translate supported bridge commands into OMP operations and SHALL translate OMP execution events into the canonical session-event vocabulary used by mobile clients.

#### Scenario: Prompt produces streamed output

- **WHEN** a valid prompt is dispatched to an OMP session
- **THEN** the system SHALL publish canonical turn and assistant-content events in their committed sequence order
- **AND** replaying those events SHALL produce the same transcript state as receiving them live

#### Scenario: Tool activity is reported

- **WHEN** OMP starts, updates, completes, fails, or cancels a tool operation
- **THEN** the system SHALL emit the corresponding bounded canonical tool event
- **AND** tool output SHALL respect the bridge's existing size and redaction limits

#### Scenario: Unsupported operation

- **WHEN** a client requests a bridge operation that OMP cannot perform with equivalent semantics
- **THEN** the bridge SHALL reject the operation with `unsupported_capability` or the applicable bounded protocol error
- **AND** it SHALL not fabricate a successful result or empty replacement state

### Requirement: Authoritative turn recovery

The system SHALL determine the authoritative outcome of an interrupted OMP turn before restoring a session to an idle or ready state.

#### Scenario: OMP confirms terminal completion after bridge restart

- **WHEN** the bridge restarts after losing an active turn
- **AND** OMP reports an authoritative terminal result
- **THEN** the bridge SHALL persist the terminal canonical events
- **AND** the mobile client SHALL observe the settled, failed, or cancelled outcome through replay

#### Scenario: OMP cannot determine the outcome

- **WHEN** the bridge restarts after losing an active turn
- **AND** OMP cannot prove whether the turn completed
- **THEN** the bridge SHALL mark the turn and session indeterminate
- **AND** it SHALL require an explicit recovery action before accepting a conflicting retry

### Requirement: Truthful OMP capability advertisement

The bridge SHALL advertise an OMP-backed capability only when the normal daemon constructs and wires the corresponding provider and the operation is available for the current host configuration.

#### Scenario: Required OMP capability is available

- **WHEN** OMP and a corresponding bridge provider are configured successfully
- **THEN** `hello.accepted` SHALL include the capability
- **AND** the mobile client SHALL be able to exercise the advertised operation

#### Scenario: Optional OMP capability is unavailable

- **WHEN** an OMP feature or provider is absent, invalid, or unavailable
- **THEN** `hello.accepted` SHALL omit that capability
- **AND** an attempted operation SHALL return a bounded truthful unavailable response
