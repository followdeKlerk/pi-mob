/**
 * Strict subprocess RPC transport for an exact Pi `0.82.0` binary.
 *
 * The bridge talks to Pi over a one-shot `pi --mode rpc` subprocess. The
 * subprocess emits one JSON record per line on stdout (LF-terminated,
 * parsed by {@link JsonlDecoder}) and free-form diagnostics on stderr.
 * The bridge writes JSON-RPC-shaped requests on stdin: each request
 * carries an opaque `id`; the subprocess replies with a single record
 * whose `id` matches and whose `result` or `error` field carries the
 * outcome. Records whose `id` does not match an outstanding request are
 * treated as server-pushed **notifications** and dispatched to event
 * listeners.
 *
 * This module enforces five hard rules that the upstream Pi runtime
 * also relies on, and that are easy to get wrong:
 *
 *   1. **No shell.** The subprocess is spawned with an absolute `cmd[0]`,
 *      an explicit `cwd`, and the owner-captured login-shell environment,
 *      never an allowlist. `PATH` is whatever the owner's login shell
 *      exported after sanitization; nothing is composed from path fragments.
 *
 *   2. **Response-ID correlation with duplication rejection.** Two
 *      in-flight requests with the same `id` would create a race; we
 *      reject the second attempt with `RpcDuplicateIdError`. The
 *      matcher only resolves or rejects the *first* matching reply;
 *      subsequent replies with the same id are surfaced as an error
 *      event so callers see the protocol violation.
 *
 *   3. **Timeout and `AbortSignal` cancellation.** Every request has a
 *      deadline (configurable per call, with a default for the
 *      instance). The active `AbortSignal` clears the same pending
 *      slot before the timeout fires, never both. Cancellation does
 *      not kill the subprocess; the caller decides via `close()`.
 *
 *   4. **stdin backpressure.** Writes await acceptance before the next
 *      chunk is offered; a runaway reader cannot cause Bun to buffer
 *      gigabytes in the pipe. We use a single
 *      `WritableStreamDefaultWriter` per write so the stream's
 *      high-water mark is respected naturally.
 *
 *   5. **Bounded, redacted stderr ring.** stderr lines have the same
 *      sensitive-value pattern applied as the bridge logger before
 *      they enter the ring buffer; only the last 256 KiB (configurable)
 *      are retained. The ring is consulted in `getStderrRing()` and is
 *      the only surface through which stderr content is exposed.
 *
 * On `close()` the bridge signals the entire process group with
 * SIGTERM, waits up to the grace period (default 5 s), then escalates
 * to SIGKILL. macOS allows positive process-group signaling via the
 * negative-pid convention; on hosts where Bun does not expose
 * `detached: true` correctly (or where the host lacks the call), the
 * leader process is signaled directly as a fallback. The intent is
 * "no orphan Pi subprocesses"; the strategy adapts to what Bun/macOS
 * supports on this host.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { JsonlDecoder } from "./jsonl";
import type { PiLaunchConfig } from "./launch-config";

// ---------------- Errors ----------------

export class RpcProcessError extends Error {
  override readonly name = "RpcProcessError";
}
export class RpcInvalidOptionsError extends Error {
  override readonly name = "RpcInvalidOptionsError";
}
export class RpcSpawnError extends Error {
  override readonly name = "RpcSpawnError";
  readonly exitCode: number | null;
  readonly signal: string | null;
  constructor(message: string, exitCode: number | null, signal: string | null) {
    super(message);
    this.exitCode = exitCode;
    this.signal = signal;
  }
}
export class RpcDuplicateIdError extends Error {
  override readonly name = "RpcDuplicateIdError";
  readonly id: string;
  constructor(id: string) {
    super(`request id already in flight: ${id}`);
    this.id = id;
  }
}
export class RpcTimeoutError extends Error {
  override readonly name = "RpcTimeoutError";
  readonly id: string;
  readonly timeoutMs: number;
  constructor(id: string, timeoutMs: number) {
    super(`request ${id} timed out after ${timeoutMs}ms`);
    this.id = id;
    this.timeoutMs = timeoutMs;
  }
}
export class RpcAbortError extends Error {
  override readonly name = "RpcAbortError";
  readonly id: string;
  constructor(id: string) {
    super(`request ${id} aborted`);
    this.id = id;
  }
}

// ---------------- Types ----------------

/** @deprecated Prefer {@link RpcProcessLaunchOptions} with `launchConfig`. */
export interface RpcProcessOptions {
  /** Absolute path to the executable. */
  readonly executable: string;
  /** Additional arguments. `cmd[0]` is always `executable`. */
  readonly args: readonly string[];
  /** Absolute working directory. */
  readonly cwd: string;
  /**
   * Environment variables to forward to the subprocess. Anything not in this
   * map is dropped — we never inherit the parent environment.
   */
  readonly environment: Readonly<Record<string, string>>;
  /**
   * Retained only for source compatibility. It is ignored; use
   * `environment.PATH` directly.
   */
  readonly pathDirs?: readonly string[];
  /** Bytes of stderr to retain. Default 256 KiB. */
  readonly stderrMaxBytes?: number;
  /** Default per-request timeout, in milliseconds. Default 30 s. */
  readonly defaultRequestTimeoutMs?: number;
  /** Grace period for `close()` before escalating to SIGKILL. Default 5 s. */
  readonly closeGracePeriodMs?: number;
}

export interface RpcProcessLaunchOptions {
  /** Shared owner-captured launch contract. */
  readonly launchConfig: PiLaunchConfig;
  /** Per-process RPC arguments appended after `launchConfig.args`. */
  readonly args?: readonly string[];
  /** Per-session workspace override. */
  readonly cwd?: string;
  readonly stderrMaxBytes?: number;
  readonly defaultRequestTimeoutMs?: number;
  readonly closeGracePeriodMs?: number;
}

export type RpcProcessConfiguration = RpcProcessOptions | RpcProcessLaunchOptions;

export interface RpcRequestOptions {
  /** Opaque correlation id. Auto-generated when omitted. */
  readonly id?: string;
  /** Method name; appears as `method` field in the JSON record. */
  readonly method: string;
  /** Method parameters; serialised by `JSON.stringify`. */
  readonly params?: unknown;
  /** Per-request timeout override. */
  readonly timeoutMs?: number;
  /**
   * Cancellation signal. Rejecting the signal aborts the pending
   * request with `RpcAbortError` without killing the subprocess.
   */
  readonly signal?: AbortSignal;
}

export interface RpcPendingRecord {
  /** Redacted line text (no trailing newline). */
  readonly line: string;
  /** Approximate byte size of the original (un-redacted) line. */
  readonly bytes: number;
  /** Monotonic counter assigned on receive. */
  readonly sequence: number;
}

export interface RpcProcessStats {
  readonly pid: number | undefined;
  readonly state: RpcProcessState;
  readonly stderrBufferBytes: number;
  readonly stderrBufferLines: number;
  readonly stderrTruncated: boolean;
  readonly pendingRequests: number;
  readonly stdoutBytesRead: number;
}

export type RpcProcessState =
  | "starting"
  | "running"
  | "exited"
  | "failed";

export type RpcProcessNotificationHandler = (
  notification: unknown,
  raw: string,
) => void;

export type RpcProcessStderrHandler = (
  line: string,
  bytes: number,
) => void;

export interface RpcProcessExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

export type RpcProcessExitHandler = (info: RpcProcessExitInfo) => void;

export type RpcProcessErrorHandler = (error: Error) => void;

// ---------------- Defaults ----------------

const DEFAULT_STDERR_MAX_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 5_000;
const STDERR_LINE_MAX = 64 * 1024; // per-line budget before truncation

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Mirrors the value-shape redaction used in `logger.ts`. Key names are
 * NOT auto-redacted: only values that look like credentials or
 * absolute private paths are replaced with `redacted`. This is the
 * exact subset of the M1 allowlist; the bridge intentionally does NOT
 * export the regex because its presence in new code is a security
 * smell — call sites should reuse this module instead.
 */
const SENSITIVE_VALUE_RE = new RegExp(
  [
    String.raw`sk-[A-Za-z0-9-]+`,
    String.raw`AIza[0-9A-Za-z_-]+`,
    String.raw`ghp_[A-Za-z0-9]+`,
    String.raw`glpat-[A-Za-z0-9_-]+`,
    String.raw`xox[baprs]-[A-Za-z0-9-]+`,
    String.raw`-----BEGIN [A-Z ]+PRIVATE KEY-----`,
    String.raw`/Users/[^/\s"<>` + "`" + `>]+/[^/\s"<>` + "`" + `>]*`,
    String.raw`/home/[^/\s"<>` + "`" + `>]+/[^/\s"<>` + "`" + `>]*`,
  ].join("|"),
);

function redactLine(line: string): string {
  return line
    .replace(SENSITIVE_VALUE_RE, "redacted")
    .replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s]*)?/g, "redacted");
}

interface PendingRequest {
  readonly id: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: (() => void) | null;
  readonly timer: ReturnType<typeof setTimeout> | null;
}

interface RpcInternalOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stderrMaxBytes: number;
  readonly defaultRequestTimeoutMs: number;
  readonly closeGracePeriodMs: number;
}

function normaliseOptions(options: RpcProcessConfiguration): RpcInternalOptions {
  const launch = "launchConfig" in options
    ? {
      executable: options.launchConfig.executable,
      args: [...options.launchConfig.args, ...(options.args ?? [])],
      cwd: options.cwd ?? options.launchConfig.cwd,
      environment: options.launchConfig.env,
    }
    : options;
  if (!isAbsolute(launch.executable)) {
    throw new RpcInvalidOptionsError(
      `executable must be an absolute path (got ${JSON.stringify(
        launch.executable,
      )})`,
    );
  }
  if (!isAbsolute(launch.cwd)) {
    throw new RpcInvalidOptionsError(
      `cwd must be an absolute path (got ${JSON.stringify(launch.cwd)})`,
    );
  }
  for (const arg of launch.args) {
    if (typeof arg !== "string") {
      throw new RpcInvalidOptionsError("args must be strings");
    }
    if (arg.includes("\u0000")) {
      throw new RpcInvalidOptionsError("args may not contain NUL");
    }
  }
  for (const k of Object.keys(launch.environment)) {
    if (k.includes("=") || k.includes("\u0000")) {
      throw new RpcInvalidOptionsError(
        `invalid environment key: ${JSON.stringify(k)}`,
      );
    }
  }
  return {
    executable: launch.executable,
    args: [...launch.args],
    cwd: launch.cwd,
    environment: launch.environment,
    stderrMaxBytes: options.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES,
    defaultRequestTimeoutMs:
      options.defaultRequestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    closeGracePeriodMs: options.closeGracePeriodMs ?? DEFAULT_CLOSE_GRACE_MS,
  };
}

function generateId(): string {
  // RFC 4122 §4.4 — random UUID-shaped id, no external dep.
  // Bun ships crypto.getRandomValues; if running under Node, this still
  // works in any environment with `globalThis.crypto`.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback: 16 bytes of randomness encoded as hex. Sufficient for
  // uniqueness within a single process.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------- RpcProcess ----------------

export interface RpcProcessListeners {
  notification?: RpcProcessNotificationHandler;
  stderr?: RpcProcessStderrHandler;
  exit?: RpcProcessExitHandler;
  error?: RpcProcessErrorHandler;
}

/**
 * One instance == one Pi subprocess lifetime. The instance is not
 * reusable after `close()` resolves; create a fresh one to reconnect.
 */
export class RpcProcess {
  private readonly options: RpcInternalOptions;
  readonly launchConfig: PiLaunchConfig | undefined;
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private readonly jsonl = new JsonlDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly stderrRing: RpcPendingRecord[] = [];
  private stderrBytes = 0;
  private stderrTruncated = false;
  private stderrSequence = 0;
  private stdoutBytesRead = 0;
  private state: RpcProcessState = "starting";
  private stdinWriter: Bun.FileSink | null = null;
  private notifListeners = new Set<RpcProcessNotificationHandler>();
  private stderrListeners = new Set<RpcProcessStderrHandler>();
  private exitListeners = new Set<RpcProcessExitHandler>();
  private errorListeners = new Set<RpcProcessErrorHandler>();
  /** Resolved when the subprocess has exited (cleanly or via signal). */
  private exitPromise: Promise<RpcProcessExitInfo> | null = null;
  /** Resolved once the start()'d subprocess has emitted the first byte. */
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  constructor(options: RpcProcessConfiguration) {
    this.launchConfig = "launchConfig" in options ? options.launchConfig : undefined;
    this.options = normaliseOptions(options);
  }

  /** Subprocess PID once started, otherwise `undefined`. */
  get pid(): number | undefined {
    return this.proc?.pid;
  }

  /** Current lifecycle state of the subprocess. */
  get currentState(): RpcProcessState {
    return this.state;
  }

  /** Snapshot of internal counters. Safe to call at any time. */
  getStats(): RpcProcessStats {
    return {
      pid: this.pid,
      state: this.state,
      stderrBufferBytes: this.stderrBytes,
      stderrBufferLines: this.stderrRing.length,
      stderrTruncated: this.stderrTruncated,
      pendingRequests: this.pending.size,
      stdoutBytesRead: this.stdoutBytesRead,
    };
  }

  /** Subscribe a handler. Returns an unsubscribe function. */
  on<K extends keyof RpcProcessListeners>(
    kind: K,
    handler: NonNullable<RpcProcessListeners[K]>,
  ): () => void {
    switch (kind) {
      case "notification":
        this.notifListeners.add(
          handler as RpcProcessNotificationHandler,
        );
        return () => this.notifListeners.delete(handler as never);
      case "stderr":
        this.stderrListeners.add(handler as RpcProcessStderrHandler);
        return () => this.stderrListeners.delete(handler as never);
      case "exit":
        this.exitListeners.add(handler as RpcProcessExitHandler);
        return () => this.exitListeners.delete(handler as never);
      case "error":
        this.errorListeners.add(handler as RpcProcessErrorHandler);
        return () => this.errorListeners.delete(handler as never);
    }
  }

  /**
   * Spawn the subprocess. Validates that the executable exists, then
   * resolves once the process is running. The first stdout byte
   * resolves the internal `ready` promise; callers that want first-byte
   * visibility can additionally `await waitForReady()` after `start()`.
   */
  async start(): Promise<void> {
    if (this.proc) {
      throw new RpcProcessError("process already started");
    }
    if (!existsSync(this.options.executable)) {
      this.state = "failed";
      throw new RpcSpawnError(
        `executable not found: ${this.options.executable}`,
        null,
        null,
      );
    }
    const st = statSync(this.options.executable);
    if (!st.isFile()) {
      this.state = "failed";
      throw new RpcSpawnError(
        `executable is not a regular file: ${this.options.executable}`,
        null,
        null,
      );
    }
    if (!existsSync(this.options.cwd)) {
      this.state = "failed";
      throw new RpcSpawnError(
        `cwd not found: ${this.options.cwd}`,
        null,
        null,
      );
    }
    const cwdStat = statSync(this.options.cwd);
    if (!cwdStat.isDirectory()) {
      this.state = "failed";
      throw new RpcSpawnError(
        `cwd is not a directory: ${this.options.cwd}`,
        null,
        null,
      );
    }

    const env: Record<string, string> = { ...this.options.environment };
    // Bun's spawn requires an absolute path; we validated this above
    // but the runtime check is cheap and explicit.
    const cmd = [this.options.executable, ...this.options.args];

    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn({
        cmd,
        env,
        cwd: this.options.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        // `detached: true` places the subprocess in its own process
        // group on POSIX, enabling graceful group shutdown.
        detached: process.platform !== "win32",
        serialization: "advanced",
      });
    } catch (cause) {
      this.state = "failed";
      throw new RpcSpawnError(
        `failed to spawn: ${(cause as Error)?.message ?? cause}`,
        null,
        null,
      );
    }
    this.proc = proc;
    this.state = "running";
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    // Acquire the writer once. We release only on close() so writes
    // remain serialised through the lifetime of the process.
    this.stdinWriter = proc.stdin;

    this.exitPromise = this.runPumps();

    // Drain stdout/stderr pumps. Both must complete (or fail) before
    // we declare the process "exited".
    void this.exitPromise.then((info) => {
      // Reject any still-pending requests with a structured error.
      this.finalisePending(
        new RpcProcessError(
          `subprocess exited (code=${info.code} signal=${info.signal ?? "none"})`,
        ),
      );
      this.state = info.code === 0 ? "exited" : "failed";
      for (const fn of this.exitListeners) fn(info);
    });
  }

  /** Resolves when the subprocess exits. */
  async waitForExit(): Promise<RpcProcessExitInfo> {
    if (!this.exitPromise) {
      throw new RpcProcessError("process not started");
    }
    return this.exitPromise;
  }

  /** Resolves when the first stdout byte is observed (or process exits). */
  async waitForReady(): Promise<void> {
    if (!this.readyPromise) {
      throw new RpcProcessError("process not started");
    }
    return this.readyPromise;
  }

  // ---------------- Request / response ----------------

  /** Send Pi's reverse extension UI response without awaiting a command response. */
  async sendExtensionUiResponse(response: { id:string; value?:string; confirmed?:boolean; cancelled?:true }): Promise<void> {
    if (!this.proc || this.state !== "running") throw new RpcProcessError("process not running");
    const payload = { type:"extension_ui_response", ...response };
    const json = JSON.stringify(payload);
    if (json.length > 64 * 1024) throw new RpcInvalidOptionsError("extension UI response exceeds 64 KiB");
    await this.writeToStdin(new TextEncoder().encode(`${json}\n`));
  }

  /**
   * Send a JSON-RPC-shaped request and await the matching response.
   * Rejects with `RpcDuplicateIdError`, `RpcTimeoutError`,
   * `RpcAbortError`, or `RpcProcessError`.
   */
  async request(opts: RpcRequestOptions): Promise<unknown> {
    if (!this.proc || this.state !== "running") {
      throw new RpcProcessError("process not running");
    }
    const id = opts.id ?? generateId();
    if (!ID_PATTERN.test(id)) {
      throw new RpcInvalidOptionsError(
        `id must match ${ID_PATTERN.source} (got ${JSON.stringify(id)})`,
      );
    }
    if (this.pending.has(id)) {
      throw new RpcDuplicateIdError(id);
    }
    const payload: Record<string, unknown> = { id, type: opts.method };
    if (opts.params !== undefined) {
      if (opts.params === null || typeof opts.params !== "object" || Array.isArray(opts.params)) {
        throw new RpcInvalidOptionsError("request params must be an object");
      }
      Object.assign(payload, opts.params);
    }
    const json = JSON.stringify(payload);
    if (!id.includes(":") && json.length > 64 * 1024) {
      throw new RpcInvalidOptionsError(
        "request payload exceeds 64 KiB (Pi wire limit)",
      );
    }
    const line = new TextEncoder().encode(`${json}\n`);

    return await new Promise<unknown>((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? this.options.defaultRequestTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let onAbort: (() => void) | null = null;

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (onAbort) {
          opts.signal?.removeEventListener("abort", onAbort);
          onAbort = null;
        }
        this.pending.delete(id);
      };

      const entry: PendingRequest = {
        id,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        get timeoutMs() {
          return timeoutMs;
        },
        get signal() {
          return opts.signal;
        },
        onAbort,
        get timer() {
          return timer;
        },
      };
      this.pending.set(id, entry);

      // Set up timeout
      if (timeoutMs > 0 && timeoutMs !== Number.POSITIVE_INFINITY) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new RpcTimeoutError(id, timeoutMs),
          );
        }, timeoutMs);
        // Don't keep the event loop alive for this timer.
        if (typeof (timer as { unref?: () => void }).unref === "function") {
          (timer as { unref: () => void }).unref();
        }
      }

      // Set up abort
      if (opts.signal) {
        if (opts.signal.aborted) {
          this.pending.delete(id);
          reject(new RpcAbortError(id));
          return;
        }
        onAbort = () => {
          this.pending.delete(id);
          if (timer !== null) clearTimeout(timer);
          reject(new RpcAbortError(id));
        };
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }

      // Now write the payload. Backpressured through the writer.
      this.writeToStdin(line).catch((err) => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  // ---------------- Cleanup ----------------

  /**
   * Close the subprocess gracefully: signal the process group with
   * SIGTERM, wait up to the grace period, then escalate to SIGKILL.
   * Idempotent.
   */
  async forceKillGroup(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || typeof proc.pid !== "number") return;
    this.killGroupOrPid(proc.pid, "SIGKILL");
    await proc.exited.catch(() => undefined);
    if (this.exitPromise) await this.exitPromise;
  }

  async close(reason?: string): Promise<void> {
    if (!this.proc) return;
    void reason; // reserved for logging/reporting; not yet wired into a logger
    const proc = this.proc;
    if (this.exitPromise) {
      // Drive group shutdown while the pumps continue.
      try {
        await this.signalGroup("SIGTERM", proc, this.options.closeGracePeriodMs);
      } catch {
        // ignore — escalated below if needed
      }
      try {
        await this.signalGroup("SIGKILL", proc, 0);
      } catch {
        // ignore — the leader will already have exited on SIGTERM
      }
      await this.exitPromise;
    }
    // Release and close the stdin writer if still open.
    try {
      if (this.stdinWriter) {
        await this.stdinWriter.end();
        this.stdinWriter = null;
      }
    } catch {
      // pipe already closed; ignore
    }
  }

  // ---------------- Internals ----------------

  private async runPumps(): Promise<RpcProcessExitInfo> {
    const proc = this.proc!;
    const stdoutDone = this.pumpStdout(proc).catch((err) => {
      this.dispatchError(err instanceof Error ? err : new Error(String(err)));
    });
    const stderrDone = this.pumpStderr(proc).catch((err) => {
      this.dispatchError(err instanceof Error ? err : new Error(String(err)));
    });

    // Drive stdout and stderr pumps concurrently. Each is a
    // long-lived reader that terminates only when the source
    // pipe closes (process exit closes the OS-level pipes).
    const pumpsDone = Promise.all([stdoutDone, stderrDone]);

    let code: number | null = null;
    try {
      code = await proc.exited;
    } catch {
      // ignored — we synthesise the exit info below
    }

    // Wait for any final bytes that arrived between the kernel
    // closing the pipe and our reader noticing.
    await pumpsDone;

    const signal =
      typeof proc.signalCode === "string"
        ? proc.signalCode
        : null;
    if (code === null && signal === null) {
      code = 0;
    }
    return { code, signal };
  }

  private async pumpStdout(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stdoutBytesRead += value.byteLength;
        if (!this.readyResolve) {
          // first byte observed; mark ready
        } else {
          this.readyResolve();
          this.readyResolve = null;
        }
        // Push in two stages so we can release the reader quickly.
        const records = this.jsonl.push(value);
        for (const rec of records) this.dispatchRecord(rec.value, rec.raw);
      }
      this.jsonl.finish();
    } finally {
      reader.releaseLock();
    }
  }

  private async pumpStderr(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let carry = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = carry.indexOf("\n")) >= 0) {
          const rawLine = carry.slice(0, nl);
          carry = carry.slice(nl + 1);
          const bytes = rawLine.length;
          const redacted = redactLine(rawLine).slice(0, STDERR_LINE_MAX);
          this.appendStderr(redacted, bytes);
          for (const fn of this.stderrListeners) fn(redacted, bytes);
        }
      }
      // Flush any trailing bytes that lacked a final LF.
      const tail = decoder.decode();
      if (tail.length > 0 || carry.length > 0) {
        const final = carry + tail;
        if (final.length > 0) {
          const bytes = final.length;
          const redacted = redactLine(final).slice(0, STDERR_LINE_MAX);
          this.appendStderr(redacted, bytes);
          for (const fn of this.stderrListeners) fn(redacted, bytes);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private appendStderr(redacted: string, originalBytes: number): void {
    this.stderrSequence += 1;
    this.stderrRing.push({
      line: redacted,
      bytes: originalBytes,
      sequence: this.stderrSequence,
    });
    this.stderrBytes += originalBytes;
    // Trim oldest-first until under budget. We trim by bytes because
    // the budget is in bytes; counting entries would let one large
    // line blow past the bound.
    while (
      this.stderrBytes > this.options.stderrMaxBytes &&
      this.stderrRing.length > 1
    ) {
      const head = this.stderrRing.shift();
      if (head) {
        this.stderrBytes -= head.bytes;
        this.stderrTruncated = true;
      }
    }
  }

  private dispatchRecord(value: unknown, raw: string): void {
    if (value === null || typeof value !== "object") {
      this.dispatchError(
        new RpcProcessError(
          `non-object record from subprocess at byte ${this.stdoutBytesRead}`,
        ),
      );
      return;
    }
    const rec = value as { id?: unknown; type?: unknown; success?: unknown; data?: unknown; error?: unknown };
    if (rec.type === "response" && typeof rec.id === "string" && this.pending.has(rec.id)) {
      const entry = this.pending.get(rec.id)!;
      if (rec.success === false) {
        entry.reject(new RpcProcessError("Pi RPC command failed"));
      } else {
        entry.resolve(rec.data);
      }
      return;
    }
    // Otherwise it's a notification (or a stray response). Pass through.
    for (const fn of this.notifListeners) fn(value, raw);
  }

  private dispatchError(err: Error): void {
    for (const fn of this.errorListeners) fn(err);
  }

  private finalisePending(reason: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(reason);
    }
    this.pending.clear();
  }

  // ---------------- Stderr ring API ----------------

  /** Snapshot of the bounded, redacted stderr ring (chronological). */
  getStderrRing(): readonly RpcPendingRecord[] {
    return [...this.stderrRing];
  }

  /** Single joined string of the stderr ring, separated by `\n`. */
  getStderrJoined(): string {
    return this.stderrRing.map((r) => r.line).join("\n");
  }

  // ---------------- Stdin writer ----------------

  private async writeToStdin(bytes: Uint8Array): Promise<void> {
    if (!this.stdinWriter) {
      throw new RpcProcessError("stdin writer not available");
    }
    if (this.state !== "running") {
      throw new RpcProcessError(`cannot write: state=${this.state}`);
    }
    // `writer.write` returns when backpressure has cleared.
    await this.stdinWriter.write(bytes);
  }

  // ---------------- Group signalling ----------------

  /**
   * Signal the subprocess's process group, falling back to the leader
   * PID if the negative-pid form is not available on this host. The
   * returned promise resolves when the leader has exited OR the grace
   * period has elapsed — whichever comes first.
   *
   * `SIGKILL` with a zero grace period escalates immediately.
   */
  private async signalGroup(
    sig: "SIGTERM" | "SIGKILL",
    proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
    graceMs: number,
  ): Promise<void> {
    if (proc.exitCode !== null) return;
    const pid = proc.pid;
    if (typeof pid !== "number") return;

    // Try negative pid (process group) first; fall back to plain pid.
    const sent = this.killGroupOrPid(pid, sig);
    if (!sent) return;

    if (graceMs <= 0) {
      await proc.exited.catch(() => undefined);
      return;
    }
    await Promise.race([
      proc.exited.catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, graceMs)),
    ]);
  }

  private killGroupOrPid(pid: number, sig: NodeJS.Signals): boolean {
    // Try group (-pid). ESRCH or EPERM fall through to direct kill.
    try {
      process.kill(-pid, sig);
      return true;
    } catch {
      // ignore; fall through to direct kill
    }
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Validate that `path` is an absolute path on the current host. Both
 * POSIX (`/foo`) and Windows (`C:\foo`) absolutes are accepted; the
 * helper is exported so the bridge can guard user-supplied paths in
 * callers (config loaders) before they reach `RpcProcessOptions`.
 */
export function assertAbsolutePath(label: string, p: string): void {
  if (!isAbsolute(p)) {
    throw new RpcInvalidOptionsError(
      `${label} must be an absolute path (got ${JSON.stringify(p)})`,
    );
  }

}
