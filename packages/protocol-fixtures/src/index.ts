import manifest from "../corpus/fixtures-manifest.json" with { type: "json" };
import { compareDecimalCursors } from "@pi-mob/protocol-schema";

export const PROTOCOL_FIXTURES_VERSION = "1.0" as const;
export interface FixtureEntry { readonly file: string; readonly valid: boolean; readonly kind: "hello" | "command" | "control" | "event" | "response" | "error" | "pairing" | "attachment" | "export"; }
export const fixtureManifest: readonly FixtureEntry[] = manifest as readonly FixtureEntry[];
export function listFixtures(): readonly string[] { return fixtureManifest.map((fixture) => fixture.file).sort(); }

export interface ScenarioStep { readonly fixture: string; readonly action: string; readonly expect: string; }
export interface ProtocolScenario { readonly name: string; readonly steps: readonly ScenarioStep[]; readonly outcome: string; }

const transitions: Readonly<Record<string, readonly [string, string]>> = {
  "pairing.accept": ["initial", "paired"], "pairing.reject_invalid": ["paired", "rejected"],
  "hello.accept": ["initial", "connected"], "hello.generation_changed": ["connected", "snapshot_required"],
  "stream.apply": ["initial", "contiguous"], "stream.gap": ["contiguous", "paused"], "stream.conflicting_duplicate": ["paused", "snapshot_required"],
  "snapshot.begin": ["initial", "receiving"], "snapshot.part_one": ["receiving", "part_one"], "snapshot.part_two": ["part_one", "part_two"], "snapshot.end": ["part_two", "snapshot_complete"], "snapshot.post_baseline": ["snapshot_complete", "post_baseline_replayed"], "snapshot.sync": ["post_baseline_replayed", "synced"],
  "controller.acquire": ["initial", "controlled"], "controller.disconnect": ["controlled", "reclaimable"], "controller.reclaim": ["reclaimable", "controlled"], "controller.takeover": ["controlled", "revoked"], "controller.expire": ["revoked", "expired"], "controller.stale_mutation": ["expired", "stale_controller"],
  "command.accept": ["initial", "accepted"], "command.duplicate": ["accepted", "duplicate_no_dispatch"], "command.conflict": ["duplicate_no_dispatch", "idempotency_conflict"], "command.accept_recoverable": ["idempotency_conflict", "accepted_undispatched"], "command.restart": ["accepted_undispatched", "dispatch_once"], "command.running": ["dispatch_once", "running"], "command.crash": ["running", "indeterminate"], "command.resend": ["indeterminate", "no_redispatch"],
  "prompt.immediate": ["initial", "immediate_dispatched"], "prompt.steer": ["immediate_dispatched", "steered"], "prompt.follow_up": ["steered", "queued"], "queue.restart": ["queued", "queue_recovered"], "queue.remove": ["queue_recovered", "removed"], "queue.add": ["removed", "queued_again"], "queue.clear": ["queued_again", "empty"], "queue.fill": ["empty", "full"], "queue.overflow": ["full", "queue_full"],
  "attachment.upload": ["initial", "stored"], "attachment.retry": ["stored", "deduplicated"], "attachment.conflict": ["deduplicated", "idempotency_conflict"], "attachment.replace": ["idempotency_conflict", "stored_again"], "attachment.expire": ["stored_again", "expired"], "attachment.reference": ["expired", "attachment_unavailable"], "attachment.malformed": ["attachment_unavailable", "malformed_rejected"], "attachment.oversized": ["malformed_rejected", "payload_too_large"],
  "export.complete": ["initial", "export_ready"], "export.expire": ["export_ready", "export_expired"], "export.delete": ["export_expired", "export_unavailable"], "dialog.open": ["export_unavailable", "dialog_pending"], "dialog.reconnect": ["dialog_pending", "dialog_replayed"], "dialog.timeout": ["dialog_replayed", "dialog_expired"], "dialog.duplicate_response": ["dialog_expired", "invalid_state"], "pagination.first": ["invalid_state", "page_loaded"], "pagination.revision_changed": ["page_loaded", "refresh_required"],
  "failure.oversized_json": ["initial", "payload_too_large"], "failure.slow_consumer": ["payload_too_large", "slow_consumer"], "failure.host_draining": ["slow_consumer", "host_draining"], "failure.pi_mismatch": ["host_draining", "pi_version_mismatch"], "failure.database_unavailable": ["pi_version_mismatch", "database_unavailable"], "failure.storage_full": ["database_unavailable", "storage_full"],
  "capability.optional_event": ["initial", "retained_optional"], "capability.required_unknown": ["retained_optional", "unsupported_capability"],
};

const evidenceTypes: Readonly<Record<string, string>> = {
  "pairing.accept": "pi-mob-host", "pairing.reject_invalid": "pi-mob-host",
  "hello.accept": "hello.accepted", "hello.generation_changed": "hello.accepted",
  "stream.apply": "turn.started", "stream.gap": "turn.started", "stream.conflicting_duplicate": "turn.started",
  "snapshot.begin": "stream.snapshot.begin", "snapshot.part_one": "stream.snapshot.part", "snapshot.part_two": "stream.snapshot.part", "snapshot.end": "stream.snapshot.end", "snapshot.post_baseline": "session.state", "snapshot.sync": "stream.sync.complete",
  "controller.acquire": "controller.acquire", "controller.disconnect": "controller.state", "controller.reclaim": "controller.acquire", "controller.takeover": "controller.takeover", "controller.expire": "controller.state", "controller.stale_mutation": "error",
  "command.accept": "command.state", "command.duplicate": "command.receipt", "command.conflict": "error", "command.accept_recoverable": "command.state", "command.restart": "command.state", "command.running": "command.state", "command.crash": "command.state", "command.resend": "command.receipt",
  "prompt.immediate": "prompt.submit", "prompt.steer": "prompt.submit", "prompt.follow_up": "prompt.submit", "queue.restart": "queue.snapshot", "queue.remove": "queue.remove", "queue.add": "turn.queued", "queue.clear": "queue.clear", "queue.fill": "queue.snapshot", "queue.overflow": "error",
  "attachment.upload": "turn.accepted", "attachment.retry": "turn.accepted", "attachment.conflict": "error", "attachment.replace": "turn.accepted", "attachment.expire": "error", "attachment.reference": "error", "attachment.malformed": "error", "attachment.oversized": "error",
  "export.complete": "command.state", "export.expire": "error", "export.delete": "error", "dialog.open": "extension.dialog", "dialog.reconnect": "extension.dialog", "dialog.timeout": "error", "dialog.duplicate_response": "error", "pagination.first": "session.list.result", "pagination.revision_changed": "session.list.result",
  "failure.oversized_json": "error", "failure.slow_consumer": "error", "failure.host_draining": "error", "failure.pi_mismatch": "error", "failure.database_unavailable": "error", "failure.storage_full": "error",
  "capability.optional_event": "future.event", "capability.required_unknown": "future.event",
};

export class ProtocolScenarioMachine {
  #phase = "initial";
  #hostGeneration?: string;
  #snapshotId?: string;
  get phase(): string { return this.#phase; }

  #validateEvidence(action: string, values: Record<string, unknown>): void {
    const payload = values.payload as Record<string, unknown> | undefined;
    const require = (condition: boolean, detail: string): void => {
      if (!condition) throw new Error(`scenario action ${action} requires ${detail}`);
    };
    if (action === "hello.accept" || action === "hello.generation_changed") {
      const generation = payload?.hostGeneration;
      require(typeof generation === "string", "decimal hostGeneration");
      if (action === "hello.generation_changed") {
        require(this.#hostGeneration !== undefined && compareDecimalCursors(generation as string, this.#hostGeneration) > 0, "increased hostGeneration");
      }
      this.#hostGeneration = generation as string;
    }
    if (action === "stream.gap") {
      require(typeof payload?.expectedCursor === "string" && typeof payload.receivedCursor === "string" && compareDecimalCursors(payload.expectedCursor, payload.receivedCursor) < 0, "an increasing cursor gap");
    }
    if (action === "stream.conflicting_duplicate") {
      require(typeof payload?.conflictingEventId === "string" && payload.conflictingEventId !== values.eventId, "a different conflicting event ID");
    }
    if (action === "snapshot.begin") {
      require(typeof payload?.snapshotId === "string", "snapshotId");
      this.#snapshotId = payload?.snapshotId as string;
    }
    if (action === "snapshot.part_one" || action === "snapshot.part_two") {
      require(payload?.snapshotId === this.#snapshotId, "the active snapshotId");
      require(payload?.part === (action.endsWith("one") ? 0 : 1), "ordered snapshot parts 0 then 1");
    }
    if (action === "snapshot.end") {
      require(payload?.snapshotId === this.#snapshotId && payload?.partCount === 2, "snapshotId and partCount 2");
    }
    if (action === "snapshot.post_baseline") require(payload?.afterBaseline === true, "post-baseline evidence");
    if (action === "command.duplicate" || action === "command.resend") require(payload?.duplicate === true, "duplicate receipt");
    if (action === "command.conflict") require(payload?.code === "idempotency_conflict", "idempotency_conflict");
    if (action === "queue.fill") require(Array.isArray(payload?.items) && payload.items.length === 10, "ten queued items");
    if (action === "queue.overflow") require(payload?.code === "queue_full", "queue_full");
    if (action === "controller.stale_mutation") require(payload?.code === "stale_controller", "stale_controller");
  }

  apply(action: string, fixture?: { readonly message?: unknown }): string {
    const transition = transitions[action];
    if (!transition) throw new Error(`unknown scenario action: ${action}`);
    if (this.#phase !== transition[0]) throw new Error(`scenario action ${action} requires ${transition[0]}, got ${this.#phase}`);
    if (fixture) {
      const message = fixture.message;
      if (message === null || typeof message !== "object") throw new Error(`scenario action ${action} has no protocol message`);
      const values = message as Record<string, unknown>;
      const actualType = values.type ?? values.kind;
      if (actualType !== evidenceTypes[action]) throw new Error(`scenario action ${action} requires ${evidenceTypes[action]} evidence, got ${String(actualType)}`);
      this.#validateEvidence(action, values);
    }
    this.#phase = transition[1];
    return this.#phase;
  }
}
