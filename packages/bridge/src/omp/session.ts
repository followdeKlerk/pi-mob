import type { BackendNotification, BackendRequest, BackendSessionPort, OmpSessionReference, BackendLifecycleState } from "../backend/contract";
import { extractOmpSessionId, normalizeOmpNotification } from "./normalize";
import { OmpRpcClient, type OmpRpcClientOptions } from "./rpc-client";
import type { RedactingLogger } from "../logger";

export interface OmpSessionOptions extends Omit<OmpRpcClientOptions, "sessionDir" | "resume"> {
  readonly drainTimeoutMs?: number;
  readonly logger?: RedactingLogger;
  readonly onReference?: (reference: OmpSessionReference) => void;
}

export interface OmpSessionCreateOptions {
  readonly bridgeSessionId: string;
  readonly sessionDir: string;
  readonly reference?: OmpSessionReference;
}

export class OmpSession implements BackendSessionPort {
  readonly backend = "omp" as const;
  readonly bridgeSessionId: string;
  private readonly options: OmpSessionOptions;
  private readonly sessionDir: string;
  private referenceValue: OmpSessionReference | null;
  private client: OmpRpcClient | null = null;
  private readonly handlers = new Set<(notification: BackendNotification) => void>();
  private state: BackendLifecycleState = "stopped";
  private draining = false;
  private dispatchStarted = false;
  private unsubscribeClient: (() => void) | null = null;

  constructor(options: OmpSessionOptions, create: OmpSessionCreateOptions) {
    this.options = options;
    this.bridgeSessionId = create.bridgeSessionId;
    this.sessionDir = create.sessionDir;
    this.referenceValue = create.reference ? { ...create.reference } : null;
  }

  get sessionReference(): OmpSessionReference | null { return this.referenceValue ? { ...this.referenceValue } : null; }
  lifecycleState(): BackendLifecycleState { return this.state; }
  isDraining(): boolean { return this.draining; }

  async start(): Promise<OmpSessionReference> {
    if (this.state === "running" || this.state === "idle" || this.state === "waiting_for_input" || this.state === "compacting") return this.requireReference();
    if (this.draining) throw new Error("OMP session is draining");
    this.state = "starting";
    const client = new OmpRpcClient({ ...this.options, sessionDir: this.sessionDir, ...(this.referenceValue ? { resume: this.referenceValue.sessionFile } : {}) });
    this.client = client;
    this.unsubscribeClient?.();
    this.unsubscribeClient = client.onNotification((record) => this.handleRecord(record));
    client.onExit((info) => {
      this.options.logger?.log({
        class: "diagnostic",
        event: "omp_exit",
        fields: {
          bridgeSessionId: this.bridgeSessionId,
          code: info.code,
          signal: info.signal,
        },
      });
      if (this.state !== "stopped" && this.state !== "crashed") this.state = this.dispatchStarted ? "indeterminate" : "crashed";
    });
    try {
      await client.start();
      let state: unknown = null;
      try {
        const getStateOptions = this.options.requestTimeoutMs !== undefined
          ? { timeoutMs: this.options.requestTimeoutMs }
          : {};
        state = await client.request("get_state", {}, getStateOptions);
      } catch { /* a fresh OMP process can be ready before get_state is available */ }
      const ompSessionId = extractOmpSessionId(state);
      if (ompSessionId) {
        this.referenceValue = {
          backend: "omp",
          sessionId: ompSessionId,
          sessionFile: this.referenceValue?.sessionFile ?? `${this.sessionDir}/${ompSessionId}.jsonl`,
        };
      } else if (!this.referenceValue) {
        this.referenceValue = {
          backend: "omp",
          sessionId: this.bridgeSessionId,
          sessionFile: `${this.sessionDir}/${this.bridgeSessionId}.jsonl`,
        };
      }
      this.state = "idle";
      const reference = this.requireReference();
      this.options.onReference?.(reference);
      return reference;
    } catch (error) {
      this.state = "crashed";
      try { await client.close(); } catch { /* preserve original startup error */ }
      throw error;
    }
  }

  async request(request: BackendRequest | {
    readonly id?: string;
    readonly method: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    const client = this.client;
    if (!client) throw new Error("OMP session is not started");
    const type = "type" in request ? request.type : request.method;
    const params = request.params ? { ...request.params } : {};
    if (type === "prompt" || type === "steer" || type === "follow_up") this.dispatchStarted = true;
    const response = await client.request(type, params, {
      ...(request.id !== undefined ? { id: request.id } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
    });
    const responseSessionId = extractOmpSessionId(response);
    if (responseSessionId) {
      this.referenceValue = {
        backend: "omp",
        sessionId: responseSessionId,
        sessionFile: this.referenceValue?.sessionFile ?? `${this.sessionDir}/${responseSessionId}.jsonl`,
      };
    }
    if (type === "prompt" || type === "steer" || type === "follow_up") this.state = "running";
    if (type === "abort") this.state = "idle";
    return response;
  }

  onNotification(handler: (notification: BackendNotification) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  on(kind: "notification", handler: (notification: unknown) => void): () => void {
    if (kind !== "notification") throw new Error(`unsupported OMP listener: ${kind}`);
    return this.onNotification((notification) => handler(notification));
  }
  async sendExtensionUiResponse(response: { readonly id: string; readonly value?: string; readonly confirmed?: boolean; readonly cancelled?: true }): Promise<void> {
    await this.request({ type: "extension_ui_response", params: response });
  }

  markDispatchStart(): void { this.dispatchStarted = true; }
  async manualRetry(): Promise<void> { this.draining = false; await this.close(); await this.start(); }

  async drain(): Promise<void> {
    this.draining = true;
    if (this.state === "running" || this.state === "waiting_for_input" || this.state === "compacting") {
      try { await this.request({ type: "abort", params: {}, timeoutMs: this.options.drainTimeoutMs ?? 5_000 }); } catch { /* close still enforces bounded drain */ }
    }
    await this.close();
  }

  async close(): Promise<void> {
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    const client = this.client;
    this.client = null;
    if (client) await client.close();
    this.state = "stopped";
    this.dispatchStarted = false;
  }

  private handleRecord(record: Record<string, unknown>): void {
    const normalized = normalizeOmpNotification(record, this.bridgeSessionId);
    if (!normalized) return;
    const type = normalized.type;
    if (type === "agent_start") this.state = "running";
    else if (type === "extension_ui_request") this.state = "waiting_for_input";
    else if (type === "compaction_start") this.state = "compacting";
    else if (type === "agent_end" || type === "message_end" && normalized.stopReason === "aborted") this.state = "idle";
    for (const handler of this.handlers) handler(normalized);
  }

  private requireReference(): OmpSessionReference {
    if (!this.referenceValue) throw new Error("OMP session reference unavailable after startup");
    return { ...this.referenceValue };
  }
}

export interface OmpSessionFactory {
  create(options: OmpSessionCreateOptions): OmpSession;
}

export function createOmpSessionFactory(options: OmpSessionOptions): OmpSessionFactory {
  return {
    create(createOptions: OmpSessionCreateOptions): OmpSession {
      return new OmpSession(options, createOptions);
    },
  };
}
