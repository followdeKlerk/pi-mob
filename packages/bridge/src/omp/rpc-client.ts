import { isAbsolute } from "node:path";
import { RpcAbortError, RpcProcess, type RpcProcessExitInfo } from "../pi/rpc-process";
import type { PiLaunchConfig } from "../pi/launch-config";

export interface OmpRpcClientOptions {
  readonly executable: string;
  readonly cwd: string;
  readonly sessionDir: string;
  readonly resume?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly closeGracePeriodMs?: number;
  readonly stderrMaxBytes?: number;
}

export interface OmpReadyRecord {
  readonly type: "ready";
  readonly protocolVersion?: number;
  readonly supportedProtocolVersions?: readonly number[];
  readonly maxFrameBytes?: number;
  readonly maxReassembledFrameBytes?: number;
}

export class OmpRpcError extends Error {
  override readonly name = "OmpRpcError";
}

export type OmpNotificationHandler = (record: Record<string, unknown>, raw: string) => void;
export type OmpExitHandler = (info: RpcProcessExitInfo) => void;

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 1_048_576;
const MAX_READY_BYTES = 16 * 1024;

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `omp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export class OmpRpcClient {
  private readonly rpc: RpcProcess;
  private readonly options: OmpRpcClientOptions;
  private readonly notifications = new Set<OmpNotificationHandler>();
  private readonly exits = new Set<OmpExitHandler>();
  private readyRecord: OmpReadyRecord | null = null;
  private readyResolve: ((record: OmpReadyRecord) => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private started = false;
  private closed = false;
  private readonly ready: Promise<OmpReadyRecord>;

  constructor(options: OmpRpcClientOptions) {
    if (!isAbsolute(options.executable)) throw new OmpRpcError("OMP executable must be absolute");
    if (!isAbsolute(options.cwd)) throw new OmpRpcError("OMP cwd must be absolute");
    if (!isAbsolute(options.sessionDir)) throw new OmpRpcError("OMP session directory must be absolute");
    this.options = { ...options };
    const launchConfig: PiLaunchConfig = {
      executable: options.executable,
      cwd: options.cwd,
      args: [],
      env: { ...(options.env ?? {}) },
    };
    const args = ["--mode", "rpc", "--session-dir", options.sessionDir, ...(options.resume ? ["--resume", options.resume] : [])];
    this.rpc = new RpcProcess({
      launchConfig,
      args,
      defaultRequestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      closeGracePeriodMs: options.closeGracePeriodMs ?? 5_000,
      stderrMaxBytes: options.stderrMaxBytes ?? 256 * 1024,
    });
    this.ready = new Promise<OmpReadyRecord>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.rpc.on("notification", (value, raw) => {
      const record = recordOf(value);
      if (!record) return;
      if (record.type === "ready") {
        const ready: OmpReadyRecord = {
          type: "ready",
          ...(typeof record.protocolVersion === "number" ? { protocolVersion: record.protocolVersion } : {}),
          ...(Array.isArray(record.supportedProtocolVersions) ? { supportedProtocolVersions: record.supportedProtocolVersions.filter((v): v is number => typeof v === "number").slice(0, 8) } : {}),
          ...(typeof record.maxFrameBytes === "number" ? { maxFrameBytes: record.maxFrameBytes } : {}),
          ...(typeof record.maxReassembledFrameBytes === "number" ? { maxReassembledFrameBytes: record.maxReassembledFrameBytes } : {}),
        };
        if (JSON.stringify(ready).length > MAX_READY_BYTES) {
          this.rejectReady(new OmpRpcError("OMP ready record exceeds bound"));
          return;
        }
        const frame = ready.maxFrameBytes ?? MAX_FRAME_BYTES;
        if (!Number.isInteger(frame) || frame < 1 || frame > MAX_FRAME_BYTES) {
          this.rejectReady(new OmpRpcError("OMP ready frame limit is invalid"));
          return;
        }
        this.readyRecord = ready;
        this.readyResolve?.(ready);
        this.readyResolve = null;
        this.readyReject = null;
      }
      for (const handler of this.notifications) handler(record, raw.length > MAX_FRAME_BYTES ? raw.slice(0, MAX_FRAME_BYTES) : raw);
    });
    this.rpc.on("exit", (info) => {
      if (!this.readyRecord) this.rejectReady(new OmpRpcError(`OMP exited before ready (code=${info.code}, signal=${info.signal ?? "none"})`));
      for (const handler of this.exits) handler(info);
    });
  }

  get currentState(): "starting" | "running" | "exited" | "failed" { return this.rpc.currentState; }
  get readyInfo(): OmpReadyRecord | null { return this.readyRecord; }
  get diagnostics(): readonly string[] { return this.rpc.getStderrRing().map((item) => item.line); }
  get pid(): number | undefined { return this.rpc.pid; }

  onNotification(handler: OmpNotificationHandler): () => void { this.notifications.add(handler); return () => this.notifications.delete(handler); }
  onExit(handler: OmpExitHandler): () => void { this.exits.add(handler); return () => this.exits.delete(handler); }

  async start(): Promise<OmpReadyRecord> {
    if (this.started) return this.ready;
    if (this.closed) throw new OmpRpcError("OMP client is closed");
    this.started = true;
    try {
      await this.rpc.start();
      const timeoutMs = this.options.startTimeoutMs ?? 10_000;
      return await Promise.race([
        this.ready,
        new Promise<OmpReadyRecord>((_, reject) => setTimeout(() => reject(new OmpRpcError("OMP ready timeout")), timeoutMs)),
      ]);
    } catch (error) {
      this.rejectReady(error instanceof Error ? error : new OmpRpcError(String(error)));
      throw error;
    }
  }

  async request(method: string, params: Record<string, unknown> = {}, options: { readonly id?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<unknown> {
    if (!this.started || this.closed) throw new OmpRpcError("OMP client is not running");
    const requestId = options.id ?? id();
    const payload = JSON.stringify({ id: requestId, type: method, ...params });
    if (payload.length > MAX_REQUEST_BYTES) throw new OmpRpcError("OMP request exceeds 64 KiB");
    try {
      const requestOptions = {
        id: requestId,
        method,
        params,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      };
      return await this.rpc.request(requestOptions);
    } catch (error) {
      if (error instanceof RpcAbortError && method !== "abort") {
        try { await this.rpc.request({ id: `${requestId}-abort`, method: "abort", params: {}, timeoutMs: 5_000 }); } catch { /* cancellation remains local if OMP has already exited */ }
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await this.rpc.close(); }
    catch (error) { throw error instanceof Error ? error : new OmpRpcError(String(error)); }
  }

  private rejectReady(error: Error): void {
    if (!this.readyReject) return;
    this.readyReject(error);
    this.readyResolve = null;
    this.readyReject = null;
  }
}
