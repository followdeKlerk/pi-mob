import { createHash } from "node:crypto";
import {
  EXTERNAL_URL_PATTERN,
  GIT_ACTIONS,
  GIT_BRANCH_PATTERN,
  GIT_CI_CAPABILITY,
  GIT_REPOSITORY_LABEL_PATTERN,
  ISO_UTC_PATTERN,
  LIMITS,
} from "@pi-mob/protocol-schema";

const externalUrlPattern = new RegExp(EXTERNAL_URL_PATTERN);
const repositoryPattern = new RegExp(GIT_REPOSITORY_LABEL_PATTERN);
const branchPattern = new RegExp(GIT_BRANCH_PATTERN);
const isoUtcPattern = new RegExp(ISO_UTC_PATTERN);
const gitCiStates = new Set(["success", "failure", "pending", "unknown"] as const);
const gitActions = new Set(GIT_ACTIONS);

type GitCiState = "success" | "failure" | "pending" | "unknown";
type GitSupportedAction = (typeof GIT_ACTIONS)[number];

/** Small, injectable process boundary for Git. It deliberately has no shell. */
export interface GitCommandRunner {
  run(command: string, args: readonly string[], options: {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

export interface GitCiProvider {
  /** Provider data is authoritative only when this callback is supplied. */
  summary(input: { repository: string; branch: string | null; sha: string }): Promise<unknown>;
}

export interface GitSummaryServiceOptions {
  readonly runner: GitCommandRunner;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly provider?: GitCiProvider;
  readonly supportedActions?: readonly GitSupportedAction[];
}

export interface GitCheckRun {
  readonly name: string;
  readonly status: GitCiState;
  readonly summary?: string;
  readonly logSummary?: string;
  readonly url?: string;
}

export interface GitPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

export interface GitSummary {
  readonly workspaceId: string;
  readonly revision: string;
  readonly repositoryUrl: string;
  readonly repository: string;
  readonly detached: boolean;
  readonly branch: string | null;
  readonly workingTreeState: "clean" | "dirty" | "unknown";
  readonly changedCount: number;
  readonly ahead: number;
  readonly behind: number;
  readonly latestCommit: {
    sha: string;
    message?: string;
    author?: string;
    authoredAt: string;
    url: string;
  };
  readonly pullRequest?: GitPullRequest;
  readonly ciStatus: { state: GitCiState };
  readonly failedChecks: readonly GitCheckRun[];
  readonly supportedActions: readonly GitSupportedAction[];
  readonly capability: typeof GIT_CI_CAPABILITY;
  readonly lastRefreshedAt: string;
}

export type GitUnavailableReason = "not_repository" | "git_missing" | "remote_missing" | "provider_unavailable" | "timeout" | "invalid_remote" | "unknown";
export interface GitUnavailable {
  readonly workspaceId: string;
  readonly capability: typeof GIT_CI_CAPABILITY;
  readonly status: {
    readonly state: "unavailable";
    readonly reason: string;
    readonly remediation: string;
  };
}

type ValidatedProviderSummary = {
  readonly pullRequest?: GitPullRequest;
  readonly ciStatus: { readonly state: GitCiState };
  readonly failedChecks: readonly GitCheckRun[];
};

/** Returns only safe HTTPS links that match the protocol schema. */
export function validateGitHttpsUrl(value: string): string | null {
  if (value.length > LIMITS.maxExternalUrlLength || !externalUrlPattern.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clipFirstLine(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const line = value.split(/\r?\n/u, 1)[0]?.trim();
  return line ? line.slice(0, maxLength) : undefined;
}

function toCanonicalUtc(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const iso = date.toISOString();
  return isoUtcPattern.test(iso) ? iso : null;
}

function normalizeRemoteToHttps(remote: string): string | null {
  const trimmed = remote.trim();
  const scp = trimmed.match(/^git@([^:]+):(.+)$/u);
  if (scp) return validateGitHttpsUrl(`https://${scp[1]}/${scp[2]!.replace(/\.git$/u, "")}`);
  if (trimmed.startsWith("ssh://")) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname) return null;
      return validateGitHttpsUrl(`https://${url.hostname}${url.pathname.replace(/\.git$/u, "")}`);
    } catch {
      return null;
    }
  }
  return validateGitHttpsUrl(trimmed.replace(/\.git$/u, ""));
}

function parseNonNegativeCount(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= LIMITS.maxGitCount ? parsed : null;
}

function parseProviderSummary(value: unknown): ValidatedProviderSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const ciStatus = asRecord(record.ciStatus);
  const ciState = ciStatus?.state;
  if (typeof ciState !== "string" || !gitCiStates.has(ciState as GitCiState)) return null;

  const rawChecks = record.failedChecks;
  if (!Array.isArray(rawChecks) || rawChecks.length > LIMITS.maxFailedChecks) return null;
  const failedChecks: GitCheckRun[] = [];
  for (const rawCheck of rawChecks) {
    const check = asRecord(rawCheck);
    if (!check || typeof check.name !== "string" || !check.name || check.name.length > LIMITS.maxCheckNameLength || !gitCiStates.has(check.status as GitCiState)) {
      return null;
    }
    const summary = typeof check.summary === "string" ? check.summary : undefined;
    const logSummary = typeof check.logSummary === "string" ? check.logSummary : undefined;
    const url = typeof check.url === "string" ? (validateGitHttpsUrl(check.url) ?? undefined) : undefined;
    if ((summary !== undefined && (!summary || summary.length > LIMITS.maxCheckSummaryLength)) || (logSummary !== undefined && (!logSummary || logSummary.length > LIMITS.maxLogSummaryLength)) || (typeof check.url === "string" && !url)) {
      return null;
    }
    failedChecks.push({
      name: check.name,
      status: check.status as GitCiState,
      ...(summary !== undefined ? { summary } : {}),
      ...(logSummary !== undefined ? { logSummary } : {}),
      ...(url !== undefined ? { url } : {}),
    });
  }

  let pullRequest: GitPullRequest | undefined;
  if (record.pullRequest !== undefined) {
    const pr = asRecord(record.pullRequest);
    const url = typeof pr?.url === "string" ? validateGitHttpsUrl(pr.url) : null;
    if (!pr || !Number.isSafeInteger(pr.number) || (pr.number as number) < 1 || (pr.number as number) > Number.MAX_SAFE_INTEGER || typeof pr.title !== "string" || !pr.title || pr.title.length > LIMITS.maxGitPullRequestTitleLength || !url) {
      return null;
    }
    pullRequest = { number: pr.number as number, title: pr.title, url };
  }

  return {
    ...(pullRequest !== undefined ? { pullRequest } : {}),
    ciStatus: { state: ciState as GitCiState },
    failedChecks,
  };
}

function dedupeActions(actions: readonly GitSupportedAction[]): readonly GitSupportedAction[] {
  const unique: GitSupportedAction[] = [];
  for (const action of actions) {
    if (!gitActions.has(action) || unique.includes(action)) continue;
    unique.push(action);
  }
  return unique;
}

function summaryRevision(input: Omit<GitSummary, "workspaceId" | "lastRefreshedAt" | "revision">): string {
  return `git-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 28)}`;
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && /abort|cancelled|canceled/u.test(`${error.name} ${error.message}`);
}

function isTimeoutLike(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out/u.test(`${error.name} ${error.message}`);
}

function abortPromise(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

export class GitSummaryService {
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly supportedActions: readonly GitSupportedAction[];

  constructor(private readonly options: GitSummaryServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.supportedActions = dedupeActions(options.supportedActions ?? ["refresh", "open_external"]);
  }

  async summarize(workspaceId: string, cwd: string, signal?: AbortSignal): Promise<GitSummary | GitUnavailable> {
    const run = async (args: readonly string[]) => this.options.runner.run("git", args, {
      cwd,
      timeoutMs: this.timeoutMs,
      ...(signal !== undefined ? { signal } : {}),
    });
    try {
      const root = await run(["rev-parse", "--show-toplevel"]);
      if (root.code !== 0) return this.unavailable(workspaceId, "not_repository", "Workspace is not a Git repository", "Open a workspace whose root is a Git repository and refresh.");

      const remote = await run(["remote", "get-url", "origin"]);
      if (remote.code !== 0) return this.unavailable(workspaceId, "remote_missing", "Repository has no origin remote", "Configure an HTTPS-capable origin remote and refresh.");

      const repositoryUrl = normalizeRemoteToHttps(remote.stdout);
      if (!repositoryUrl) return this.unavailable(workspaceId, "invalid_remote", "Origin is not a safe HTTPS repository URL", "Use an origin remote that can be converted to a safe HTTPS URL and refresh.");

      const repository = new URL(repositoryUrl).pathname.replace(/^\//u, "");
      if (!repositoryPattern.test(repository)) {
        return this.unavailable(workspaceId, "invalid_remote", "Repository label is outside the Git summary bounds", "Use an origin remote whose repository label fits the protocol bounds and refresh.");
      }

      const head = await run(["log", "-1", "--format=%H%x00%s%x00%an%x00%aI"]);
      if (head.code !== 0) return this.unavailable(workspaceId, "unknown", "Repository has no readable commit", "Create or fetch a readable commit and refresh.");

      const [sha = "", subject = "", author = "", authoredAtRaw = ""] = head.stdout.trim().split("\0");
      const authoredAt = toCanonicalUtc(authoredAtRaw);
      const commitUrl = validateGitHttpsUrl(`${repositoryUrl}/commit/${sha}`);
      if (!/^[0-9a-f]{7,64}$/u.test(sha) || !commitUrl || !authoredAt) {
        return this.unavailable(workspaceId, "unknown", "Latest commit metadata is outside the Git summary bounds", "Refresh after the repository metadata is available in canonical Git form.");
      }

      const branchResult = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const detached = branchResult.code !== 0;
      const branch = detached ? null : branchResult.stdout.trim();
      if (branch !== null && !branchPattern.test(branch)) {
        return this.unavailable(workspaceId, "unknown", "Git branch name is outside the Git summary bounds", "Checkout a branch whose name fits the protocol bounds and refresh.");
      }

      const status = await run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
      const changedCount = status.code === 0 ? status.stdout.split("\0").filter(Boolean).length : 0;
      if (changedCount > LIMITS.maxGitCount) {
        return this.unavailable(workspaceId, "unknown", "Working tree change count is outside the Git summary bounds", "Refresh after the repository returns a bounded working tree summary.");
      }

      let ahead = 0;
      let behind = 0;
      if (!detached) {
        const upstream = await run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
        if (upstream.code !== 0) {
          return this.unavailable(workspaceId, "unknown", "Upstream tracking status is unavailable", "Configure an upstream branch or refresh after upstream tracking is available.");
        }
        const [aheadRaw = "", behindRaw = ""] = upstream.stdout.trim().split(/\s+/u);
        const parsedAhead = parseNonNegativeCount(aheadRaw);
        const parsedBehind = parseNonNegativeCount(behindRaw);
        if (parsedAhead === null || parsedBehind === null) {
          return this.unavailable(workspaceId, "unknown", "Upstream tracking counts are outside the Git summary bounds", "Refresh after Git returns bounded upstream counts.");
        }
        ahead = parsedAhead;
        behind = parsedBehind;
      }

      const commitMessage = clipFirstLine(subject, LIMITS.maxCommitMessageLength);
      const commitAuthor = clipFirstLine(author, LIMITS.maxCommitAuthorLength);
      const latestCommit: GitSummary["latestCommit"] = {
        sha,
        authoredAt,
        url: commitUrl,
        ...(commitMessage !== undefined ? { message: commitMessage } : {}),
        ...(commitAuthor !== undefined ? { author: commitAuthor } : {}),
      };
      const baseSummary: Omit<GitSummary, "workspaceId" | "lastRefreshedAt" | "revision"> = {
        repositoryUrl,
        repository,
        detached,
        branch,
        workingTreeState: status.code === 0 ? (changedCount === 0 ? "clean" : "dirty") : "unknown",
        changedCount,
        ahead,
        behind,
        latestCommit,
        ciStatus: { state: "unknown" as const },
        failedChecks: [] as const,
        supportedActions: this.supportedActions,
        capability: GIT_CI_CAPABILITY,
      };

      let validatedProvider: ValidatedProviderSummary | undefined;
      if (this.options.provider) {
        let providerSummary: unknown;
        try {
          providerSummary = await Promise.race([
            this.options.provider.summary({ repository, branch, sha }),
            abortPromise(signal),
          ]);
        } catch (error) {
          if (isAbortLike(error) || isTimeoutLike(error)) throw error;
          return this.unavailable(workspaceId, "provider_unavailable", "Git provider is unavailable", "Retry after the Git provider is reachable and authenticated.");
        }
        validatedProvider = parseProviderSummary(providerSummary) ?? undefined;
        if (!validatedProvider) {
          return this.unavailable(workspaceId, "provider_unavailable", "Git provider returned an invalid summary payload", "Fix the provider response so it matches the R6 Git summary schema, then refresh.");
        }
      }

      const withoutRevision: Omit<GitSummary, "revision"> = {
        workspaceId,
        ...baseSummary,
        ...(validatedProvider?.pullRequest !== undefined
            ? { pullRequest: validatedProvider.pullRequest }
            : {}),
        ciStatus: validatedProvider?.ciStatus ?? baseSummary.ciStatus,
        failedChecks: validatedProvider?.failedChecks ?? baseSummary.failedChecks,
        lastRefreshedAt: this.now().toISOString(),
      };
      return {
        ...withoutRevision,
        revision: summaryRevision(withoutRevision),
      };
    } catch (error) {
      if (isAbortLike(error) || isTimeoutLike(error)) {
        return this.unavailable(workspaceId, "timeout", "Git summary refresh timed out or was cancelled", "Retry the Git summary request when the repository and provider are reachable.");
      }
      return this.unavailable(workspaceId, "git_missing", "Git status is unavailable", "Install Git and retry after the repository is reachable from the bridge.");
    }
  }

  private unavailable(workspaceId: string, _reason: GitUnavailableReason, reason: string, remediation: string): GitUnavailable {
    return {
      workspaceId,
      capability: GIT_CI_CAPABILITY,
      status: {
        state: "unavailable",
        reason,
        remediation,
      },
    };
  }
}
