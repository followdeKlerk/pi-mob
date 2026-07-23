import type { BridgeStore } from "./store";

export type AgentSnapshotState =
  | "running"
  | "blocked"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "indeterminate";

export const AGENT_ACTIONS = [
  "transcript",
  "steer",
  "cancel",
  "compare",
  "adopt",
  "merge",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export interface AgentRecord {
  readonly agentId: string;
  readonly task: string;
  readonly state: AgentSnapshotState;
  readonly originSessionId: string;
  readonly originTurnId: string;
  readonly revision: string;
  readonly supportedActions: readonly AgentAction[];
  readonly model?: string;
  readonly latestActivity?: string;
  readonly completionSummary?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly transcriptRef?: string;
  readonly worktreeRef?: string;
}

export interface AgentSnapshot {
  readonly revision: string;
  readonly items: readonly AgentRecord[];
}

export interface AgentUnavailable {
  readonly capability: "agents.v1";
  readonly status: {
    readonly state: "available" | "unavailable" | "stale";
    readonly reason?: string;
    readonly remediation?: string;
    readonly source?: string;
    readonly revision?: string;
  };
}

const SUMMARY_CAP = 1024;
const TASK_CAP = 512;
const MAX_ITEMS = 64;

export class AgentSupervisionService {
  private currentRevision = "0";

  constructor(private readonly store: BridgeStore) {}

  publish(sessionId: string, snapshot: AgentSnapshot): AgentSnapshot {
    const revision = String(Number(this.currentRevision) + 1);
    this.currentRevision = revision;
    const clippedItems: AgentRecord[] = snapshot.items.slice(0, MAX_ITEMS).map((item) => {
      const latestActivity = item.latestActivity?.slice(0, SUMMARY_CAP);
      const completionSummary = item.completionSummary?.slice(0, SUMMARY_CAP);
      const next: AgentRecord = {
        ...item,
        task: item.task.slice(0, TASK_CAP),
        revision,
      };
      return {
        ...next,
        ...(latestActivity !== undefined ? { latestActivity } : {}),
        ...(completionSummary !== undefined ? { completionSummary } : {}),
      };
    });
    const clipped: AgentSnapshot = { revision, items: clippedItems };
    this.ensureSession(sessionId);
    this.store.appendEvent(`session:${sessionId}`, "agent.snapshot", { revision: clipped.revision, items: clipped.items });
    return clipped;
  }

  publishUnavailable(reason: string, remediation: string): AgentUnavailable {
    const payload: AgentUnavailable = {
      capability: "agents.v1",
      status: {
        state: "unavailable",
        reason,
        remediation,
        source: "bridge",
      },
    };
    this.store.ensureStream("host", "host");
    this.store.appendEvent("host", "agent.unavailable", { ...payload });
    return payload;
  }

  currentRevisionToken(): string {
    return this.currentRevision;
  }

  private ensureSession(sessionId: string): void {
    this.store.ensureSession(sessionId, {});
    this.store.ensureStream(`session:${sessionId}`, "session", sessionId);
  }
}
