const MAX_PROCESS_OUTPUT_LENGTH = 262144;

export type ProcessStatus = "running" | "completed" | "failed" | "stopped";
export type ProcessAction = "stop" | "restart" | "rerun";
export type ProcessStream = "stdout" | "stderr";
export type CapabilityState = "available" | "degraded" | "unavailable" | "stale";

export interface ProcessPort {
  readonly port: number;
  readonly protocol: "tcp" | "udp";
}

export interface ProcessTruncation {
  readonly retainedBytes: number;
  readonly totalBytes: number;
  readonly isTruncated: boolean;
  readonly digest?: string;
}

export interface CapabilityStatus {
  readonly state: CapabilityState;
  readonly reason?: string;
  readonly remediation?: string;
  readonly source?: string;
  readonly revision?: string;
}

export interface ProcessSnapshot {
  readonly sessionId: string;
  readonly processId: string;
  readonly revision: string;
  readonly status: ProcessStatus;
  readonly command: string;
  readonly startedAt: string;
  readonly capability: "runtime.processes.v1";
  readonly stale: boolean;
  readonly supportedActions: readonly ProcessAction[];
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly pid?: number;
  readonly cwd?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly ports?: readonly ProcessPort[];
}

export interface ProcessSnapshotResult {
  readonly items: readonly ProcessSnapshot[];
}

export interface ProcessOutput {
  readonly sessionId: string;
  readonly processId: string;
  readonly revision: string;
  readonly stream: ProcessStream;
  readonly content: string;
  readonly truncation: ProcessTruncation;
  readonly cursor?: string;
  readonly pageToken?: string;
}

export interface ProcessOutputPageRequest {
  readonly sessionId: string;
  readonly processId: string;
  readonly revision: string;
  readonly stream: ProcessStream;
  readonly cursor?: string;
  readonly pageToken?: string;
}

export interface ProcessUnavailable {
  readonly sessionId: string;
  readonly capability: "runtime.processes.v1";
  readonly status: CapabilityStatus;
}

export interface ProcessProjection extends ProcessSnapshot {
  readonly stdout?: ProcessOutput;
  readonly stderr?: ProcessOutput;
  readonly unavailableStatus?: CapabilityStatus;
}

export interface ProcessProjectionRegistry {
  applySnapshot(snapshot: ProcessSnapshot): void;
  applySnapshotResult(result: ProcessSnapshotResult): void;
  applyOutput(output: ProcessOutput): void;
  applyUnavailable(unavailable: ProcessUnavailable): void;
  snapshot(): readonly ProcessProjection[];
  snapshotResult(sessionId: string): ProcessSnapshotResult;
  outputPage(request: ProcessOutputPageRequest): ProcessOutput | undefined;
  get(sessionId: string, processId: string): ProcessProjection | undefined;
}

interface ProcessEntry {
  snapshot: ProcessSnapshot;
  stdout?: ProcessOutput;
  stderr?: ProcessOutput;
}

const PROCESS_CAPABILITY = "runtime.processes.v1" as const;

export class AuthoritativeProcessRegistry implements ProcessProjectionRegistry {
  private readonly records = new Map<string, ProcessEntry>();
  private readonly sessionKeys = new Map<string, Set<string>>();
  private readonly unavailableBySession = new Map<string, ProcessUnavailable>();

  applySnapshot(snapshot: ProcessSnapshot): void {
    const normalized = normalizeSnapshot(snapshot);
    const key = keyOf(normalized.sessionId, normalized.processId);
    const previous = this.records.get(key);
    const revisionChanged = previous?.snapshot.revision !== normalized.revision;
    this.records.set(key, {
      snapshot: normalized,
      ...(revisionChanged
        ? {}
        : {
            ...(previous?.stdout ? { stdout: previous.stdout } : {}),
            ...(previous?.stderr ? { stderr: previous.stderr } : {}),
          }),
    });
    this.index(key, normalized.sessionId);
    this.unavailableBySession.delete(normalized.sessionId);
  }

  applySnapshotResult(result: ProcessSnapshotResult): void {
    const snapshots = result.items.map(normalizeSnapshot);
    const grouped = new Map<string, ProcessSnapshot[]>();
    for (const snapshot of snapshots) {
      const list = grouped.get(snapshot.sessionId);
      if (list) list.push(snapshot);
      else grouped.set(snapshot.sessionId, [snapshot]);
    }
    for (const [sessionId, items] of grouped) {
      this.clearSession(sessionId);
      this.unavailableBySession.delete(sessionId);
      for (const snapshot of items) this.applySnapshot(snapshot);
    }
  }

  applyOutput(output: ProcessOutput): void {
    const normalized = normalizeOutput(output);
    const key = keyOf(normalized.sessionId, normalized.processId);
    const entry = this.records.get(key);
    if (!entry || entry.snapshot.revision !== normalized.revision) return;
    this.records.set(key, {
      ...entry,
      [normalized.stream]: normalized,
    });
  }

  applyUnavailable(unavailable: ProcessUnavailable): void {
    const normalized = normalizeUnavailable(unavailable);
    this.unavailableBySession.set(normalized.sessionId, normalized);
    for (const key of this.sessionKeys.get(normalized.sessionId) ?? []) {
      const entry = this.records.get(key);
      if (!entry) continue;
      this.records.set(key, {
        ...entry,
        snapshot: {
          ...entry.snapshot,
          supportedActions: [],
        },
      });
    }
  }

  snapshot(): readonly ProcessProjection[] {
    return [...this.records.values()].map((entry) => projectEntry(entry, this.unavailableBySession.get(entry.snapshot.sessionId)));
  }

  snapshotResult(sessionId: string): ProcessSnapshotResult {
    return {
      items: this.snapshot()
        .filter((item) => item.sessionId === sessionId)
        .map(stripProjection),
    };
  }

  outputPage(request: ProcessOutputPageRequest): ProcessOutput | undefined {
    const key = keyOf(request.sessionId, request.processId);
    const entry = this.records.get(key);
    if (!entry || entry.snapshot.revision !== request.revision) return undefined;
    const output = request.stream === "stdout" ? entry.stdout : entry.stderr;
    if (!output) return undefined;
    if (request.cursor !== undefined && request.cursor !== output.cursor) return undefined;
    if (request.pageToken !== undefined && request.pageToken !== output.pageToken) return undefined;
    return cloneOutput(output);
  }

  get(sessionId: string, processId: string): ProcessProjection | undefined {
    const entry = this.records.get(keyOf(sessionId, processId));
    if (!entry) return undefined;
    return projectEntry(entry, this.unavailableBySession.get(sessionId));
  }

  private clearSession(sessionId: string): void {
    for (const key of this.sessionKeys.get(sessionId) ?? []) this.records.delete(key);
    this.sessionKeys.delete(sessionId);
  }

  private index(key: string, sessionId: string): void {
    const current = this.sessionKeys.get(sessionId);
    if (current) current.add(key);
    else this.sessionKeys.set(sessionId, new Set([key]));
  }
}

function projectEntry(entry: ProcessEntry, unavailable?: ProcessUnavailable): ProcessProjection {
  return {
    ...cloneSnapshot(entry.snapshot),
    ...(entry.stdout ? { stdout: cloneOutput(entry.stdout) } : {}),
    ...(entry.stderr ? { stderr: cloneOutput(entry.stderr) } : {}),
    ...(unavailable ? { unavailableStatus: cloneStatus(unavailable.status), supportedActions: [] } : {}),
  };
}

function stripProjection(projection: ProcessProjection): ProcessSnapshot {
  return cloneSnapshot({
    sessionId: projection.sessionId,
    processId: projection.processId,
    revision: projection.revision,
    status: projection.status,
    command: projection.command,
    startedAt: projection.startedAt,
    capability: projection.capability,
    stale: projection.stale,
    supportedActions: projection.supportedActions,
    ...(projection.turnId === undefined ? {} : { turnId: projection.turnId }),
    ...(projection.toolCallId === undefined ? {} : { toolCallId: projection.toolCallId }),
    ...(projection.pid === undefined ? {} : { pid: projection.pid }),
    ...(projection.cwd === undefined ? {} : { cwd: projection.cwd }),
    ...(projection.finishedAt === undefined ? {} : { finishedAt: projection.finishedAt }),
    ...(projection.durationMs === undefined ? {} : { durationMs: projection.durationMs }),
    ...(projection.exitCode === undefined ? {} : { exitCode: projection.exitCode }),
    ...(projection.signal === undefined ? {} : { signal: projection.signal }),
    ...(projection.ports === undefined ? {} : { ports: projection.ports }),
  });
}

function normalizeSnapshot(snapshot: ProcessSnapshot): ProcessSnapshot {
  return {
    sessionId: snapshot.sessionId,
    processId: snapshot.processId,
    revision: snapshot.revision,
    status: snapshot.status,
    command: snapshot.command,
    startedAt: snapshot.startedAt,
    capability: PROCESS_CAPABILITY,
    stale: snapshot.stale,
    supportedActions: [...snapshot.supportedActions],
    ...(snapshot.turnId === undefined ? {} : { turnId: snapshot.turnId }),
    ...(snapshot.toolCallId === undefined ? {} : { toolCallId: snapshot.toolCallId }),
    ...(snapshot.pid === undefined ? {} : { pid: snapshot.pid }),
    ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
    ...(snapshot.finishedAt === undefined ? {} : { finishedAt: snapshot.finishedAt }),
    ...(snapshot.durationMs === undefined ? {} : { durationMs: snapshot.durationMs }),
    ...(snapshot.exitCode === undefined ? {} : { exitCode: snapshot.exitCode }),
    ...(snapshot.signal === undefined ? {} : { signal: snapshot.signal }),
    ...(snapshot.ports === undefined ? {} : { ports: snapshot.ports.map(clonePort) }),
  };
}

function normalizeOutput(output: ProcessOutput): ProcessOutput {
  if (output.content.length > MAX_PROCESS_OUTPUT_LENGTH) {
    throw new RangeError(`process output exceeds ${MAX_PROCESS_OUTPUT_LENGTH} UTF-16 code units`);
  }
  return {
    sessionId: output.sessionId,
    processId: output.processId,
    revision: output.revision,
    stream: output.stream,
    content: output.content,
    truncation: cloneTruncation(output.truncation),
    ...(output.cursor === undefined ? {} : { cursor: output.cursor }),
    ...(output.pageToken === undefined ? {} : { pageToken: output.pageToken }),
  };
}

function normalizeUnavailable(unavailable: ProcessUnavailable): ProcessUnavailable {
  return {
    sessionId: unavailable.sessionId,
    capability: PROCESS_CAPABILITY,
    status: cloneStatus(unavailable.status),
  };
}

function cloneSnapshot(snapshot: ProcessSnapshot): ProcessSnapshot {
  return normalizeSnapshot(snapshot);
}

function cloneOutput(output: ProcessOutput): ProcessOutput {
  return normalizeOutput(output);
}

function cloneStatus(status: CapabilityStatus): CapabilityStatus {
  return {
    state: status.state,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.remediation === undefined ? {} : { remediation: status.remediation }),
    ...(status.source === undefined ? {} : { source: status.source }),
    ...(status.revision === undefined ? {} : { revision: status.revision }),
  };
}

function cloneTruncation(truncation: ProcessTruncation): ProcessTruncation {
  return {
    retainedBytes: truncation.retainedBytes,
    totalBytes: truncation.totalBytes,
    isTruncated: truncation.isTruncated,
    ...(truncation.digest === undefined ? {} : { digest: truncation.digest }),
  };
}

function clonePort(port: ProcessPort): ProcessPort {
  return { port: port.port, protocol: port.protocol };
}

function keyOf(sessionId: string, processId: string): string {
  return `${sessionId}:${processId}`;
}
