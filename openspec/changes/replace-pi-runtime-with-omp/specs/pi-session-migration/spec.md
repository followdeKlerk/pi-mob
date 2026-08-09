## Purpose

Provides an explicit and recoverable migration path for existing Pi-owned sessions and bridge metadata before OMP becomes the sole production execution backend, without silently discarding user history or leaving ambiguous active turns.

> **Implementation status:** The normal daemon became OMP-only before this migration gate was implemented. No source Pi session data has been proven migrated. This is a known nonconformance in the active change; the requirements below remain unchanged and open.

## ADDED Requirements

### Requirement: Migration preflight and backup

The migration SHALL validate the bridge state directory, Pi session inputs, OMP availability, required storage capacity, and supported session formats before changing durable state.

#### Scenario: Preflight succeeds

- **WHEN** all required inputs are present and valid
- **THEN** the migration SHALL create or verify a protected backup reference
- **AND** it SHALL produce a migration plan before importing any session

#### Scenario: Preflight fails

- **WHEN** an input is missing, malformed, inaccessible, or unsupported
- **THEN** the migration SHALL fail before mutating source session state
- **AND** it SHALL report a bounded actionable reason without exposing credentials or raw transcript content

### Requirement: Session and history migration

The migration SHALL preserve stable bridge session identity where possible and SHALL transfer bounded session metadata and canonical history into the OMP-backed session model.

#### Scenario: Pi session imports successfully

- **WHEN** a Pi session has valid metadata and history
- **THEN** the migration SHALL create the corresponding OMP session or canonical archived history
- **AND** it SHALL associate the result with the original bridge session identifier
- **AND** it SHALL record that session as migrated

#### Scenario: Session history is partially invalid

- **WHEN** a Pi session contains malformed or unsupported history entries
- **THEN** the migration SHALL preserve valid bounded history where safe
- **AND** it SHALL record the session as partially migrated
- **AND** it SHALL not claim that the session is fully resumable

### Requirement: Active-turn safety

The migration SHALL refuse to silently resume or discard an active Pi turn whose terminal outcome cannot be established.

#### Scenario: Active turn has an authoritative terminal result

- **WHEN** Pi history proves that the active turn settled, failed, or was cancelled
- **THEN** the migration SHALL import the terminal outcome into the OMP-backed session state
- **AND** it SHALL not recreate the turn as pending work

#### Scenario: Active turn is ambiguous

- **WHEN** the migration cannot determine whether an active turn completed
- **THEN** it SHALL mark the migrated session indeterminate
- **AND** it SHALL require an explicit recovery decision before accepting a retry

### Requirement: Resumable migration reporting

The migration SHALL record per-session outcomes and SHALL be safe to rerun without duplicating successfully migrated sessions or canonical events.

#### Scenario: Migration is interrupted

- **WHEN** the migration stops after processing only part of the session set
- **THEN** a subsequent run SHALL resume from durable per-session progress
- **AND** it SHALL leave already completed sessions unchanged

#### Scenario: Migration completes

- **WHEN** every input session has a recorded terminal migration outcome
- **THEN** the migration SHALL report counts for migrated, archived, partial, failed, and indeterminate sessions
- **AND** production cutover SHALL be blocked until every active session has an explicit safe outcome

### Requirement: Pi removal after cutover

After migration acceptance and production cutover, the normal daemon SHALL require OMP and SHALL not launch, resume, or advertise Pi as an execution backend.

#### Scenario: Post-cutover daemon starts

- **WHEN** the normal daemon starts after the OMP cutover
- **THEN** it SHALL construct only the OMP execution provider
- **AND** it SHALL reject missing or invalid OMP configuration before accepting mobile commands

#### Scenario: Legacy Pi artifact remains

- **WHEN** a migrated host still contains Pi session files
- **THEN** those files SHALL be treated only according to the documented archive or cleanup policy
- **AND** they SHALL not be implicitly reattached as live production sessions
