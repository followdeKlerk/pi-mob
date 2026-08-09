import type { EventType } from "@pi-mob/protocol-schema";

export type BackendKind = "omp";

export type BackendLifecycleState =
  | "starting"
  | "idle"
  | "running"
  | "waiting_for_input"
  | "compacting"
  | "stopped"
  | "crashed"
  | "crash_loop"
  | "indeterminate";

/** Durable reference owned by the bridge for one OMP session. */
export interface OmpSessionReference {
  readonly backend: BackendKind;
  readonly sessionId: string;
  readonly sessionFile: string;
}

export interface BackendRequest {
  readonly id?: string;
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface BackendNotification {
  readonly type: string;
  readonly sessionId?: string;
  readonly [key: string]: unknown;
}

export interface BackendCanonicalEvent {
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type BackendNotificationHandler = (notification: BackendNotification) => void;

/**
 * Runtime-facing contract for a supervised agent session. The bridge owns the
 * stable session identity; the backend owns only its private session reference
 * and execution protocol.
 */
export interface BackendSessionPort {
  readonly backend: BackendKind;
  readonly bridgeSessionId: string;
  readonly sessionReference: OmpSessionReference | null;

  lifecycleState(): BackendLifecycleState;
  start(): Promise<OmpSessionReference>;
  request(request: BackendRequest): Promise<unknown>;
  onNotification(handler: BackendNotificationHandler): () => void;
  markDispatchStart(): void;
  manualRetry(): Promise<void>;
  isDraining(): boolean;
  drain(): Promise<void>;
  close(): Promise<void>;
}


export interface BackendRecoveryResult {
  readonly authoritativeTerminal: boolean;
  readonly state: "settled" | "failed" | "cancelled" | "indeterminate";
  readonly events: readonly BackendCanonicalEvent[];
}
