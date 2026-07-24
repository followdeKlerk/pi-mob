export type AgentAction = "transcript" | "steer" | "cancel" | "compare" | "adopt" | "merge";
export interface AgentRecord {
  readonly agentId: string;
  readonly task: string;
  readonly model?: string;
  readonly state: "running" | "blocked" | "needs_input" | "completed" | "failed" | "cancelled" | "indeterminate";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly originSessionId: string;
  readonly originTurnId: string;
  readonly latestActivity?: string;
  readonly completionSummary?: string;
  readonly transcriptRef?: string;
  readonly worktreeRef?: string;
  readonly supportedActions: readonly AgentAction[];
  readonly revision: string;
}
export interface AgentSupervisionService {
  snapshot(signal?: AbortSignal): Promise<{ revision: string; items: readonly AgentRecord[] }>;
  transcript(input: { agentId: string; pageSize: number; pageToken?: string | null }): Promise<{ agentId: string; items: readonly Record<string, unknown>[]; nextPageToken?: string }>;
  act(input: { type: "agent.steer" | "agent.cancel" | "agent.adopt" | "agent.merge"; sessionId: string; agentId: string; expectedRevision: string; instruction?: string }): Promise<Record<string, unknown>>;
}
