import type { ProcessSupervisor, ProcessSupervisorSnapshot, ProcessRecord } from "./process-supervisor";

/** Authoritative projection for R5 process metadata. It never infers PID, ports, or actions. */
export interface ProcessProjection {
  readonly sessionId: string;
  readonly processId: string;
  readonly revision: string;
  readonly status: string;
  readonly command: string;
  readonly pid?: number;
  readonly ports?: readonly { readonly port: number; readonly protocol: "tcp" | "udp" }[];
  readonly supportedActions: readonly ("stop" | "restart" | "rerun")[];
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface ProcessMetadata {
  readonly processId: string;
  readonly revision: string;
  readonly status: string;
  readonly command: string;
  readonly pid?: number;
  readonly ports?: readonly { readonly port: number; readonly protocol: "tcp" | "udp" }[];
  readonly supportedActions?: readonly ("stop" | "restart" | "rerun")[];
}

export interface ProcessProjectionRegistry {
  upsert(sessionId: string, metadata: ProcessMetadata): void;
  output(sessionId: string, stream: "stdout" | "stderr", content: string, truncated?: boolean): void;
  unavailable(sessionId: string): void;
  snapshot(): readonly ProcessProjection[];
  get(sessionId: string, processId: string): ProcessProjection | undefined;
}

const MAX_OUTPUT = 64 * 1024;
const unavailableActions = [] as const;

export class AuthoritativeProcessRegistry implements ProcessProjectionRegistry {
  private readonly records = new Map<string, ProcessProjection>();
  constructor(private readonly supervisor?: ProcessSupervisor) {}

  upsert(sessionId: string, metadata: ProcessMetadata): void {
    const previous = this.records.get(sessionId);
    this.records.set(sessionId, {
      sessionId, processId: metadata.processId, revision: metadata.revision,
      status: metadata.status, command: metadata.command,
      ...(metadata.pid === undefined ? {} : { pid: metadata.pid }),
      ...(metadata.ports === undefined ? {} : { ports: metadata.ports.map((port) => ({ ...port })) }),
      supportedActions: metadata.supportedActions ? [...metadata.supportedActions] : unavailableActions,
      stdout: previous?.processId === metadata.processId ? previous.stdout : "",
      stderr: previous?.processId === metadata.processId ? previous.stderr : "",
      stdoutTruncated: previous?.processId === metadata.processId ? previous.stdoutTruncated : false,
      stderrTruncated: previous?.processId === metadata.processId ? previous.stderrTruncated : false,
    });
  }

  output(sessionId: string, stream: "stdout" | "stderr", content: string, truncated = false): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    const value = content.slice(-MAX_OUTPUT);
    this.records.set(sessionId, { ...record, [stream]: value, [`${stream}Truncated`]: truncated || value.length !== content.length });
  }

  unavailable(sessionId: string): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    this.records.set(sessionId, { ...record, pid: undefined, ports: undefined, supportedActions: unavailableActions });
  }

  snapshot(): readonly ProcessProjection[] { return [...this.records.values()].map((record) => ({ ...record })); }
  get(sessionId: string, processId: string): ProcessProjection | undefined {
    const record = this.records.get(sessionId);
    return record?.processId === processId ? { ...record } : undefined;
  }
}

/** Converts supervisor data without fabricating runtime metadata. */
export function projectSupervisor(snapshot: ProcessSupervisorSnapshot, registry: ProcessProjectionRegistry): readonly ProcessRecord[] {
  return snapshot.sessions.map((record) => record);
}
