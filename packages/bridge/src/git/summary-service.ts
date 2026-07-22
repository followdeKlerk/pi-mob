import { createHash } from "node:crypto";

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
  summary(input: { repository: string; branch: string | null; sha: string }): Promise<{
    pullRequest?: { number: number; title: string; url: string };
    ciStatus: { state: "success" | "failure" | "pending" | "unknown" };
    failedChecks: readonly { name: string; status: "success" | "failure" | "pending" | "unknown"; summary?: string; logSummary?: string; url?: string }[];
  }>;
}

export interface GitSummaryServiceOptions {
  readonly runner: GitCommandRunner;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly provider?: GitCiProvider;
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
  readonly latestCommit: { sha: string; message?: string; author?: string; authoredAt: string; url: string };
  readonly pullRequest?: { number: number; title: string; url: string };
  readonly ciStatus: { state: "success" | "failure" | "pending" | "unknown" };
  readonly failedChecks: readonly { name: string; status: "success" | "failure" | "pending" | "unknown"; summary?: string; logSummary?: string; url?: string }[];
  readonly supportedActions: readonly ("refresh" | "commit_through_pi" | "push_through_pi" | "open_external")[];
  readonly capability: "git-ci.v1";
  readonly lastRefreshedAt: string;
}

export type GitUnavailableReason = "not_repository" | "git_missing" | "remote_missing" | "provider_unavailable" | "timeout" | "invalid_remote" | "unknown";
export interface GitUnavailable { readonly workspaceId: string; readonly capability: "git-ci.v1"; readonly status: "unavailable"; readonly reason: GitUnavailableReason; readonly message: string; }

/** Returns only safe HTTPS links. Credentials, controls, fragments and paths with spaces are rejected. */
export function validateGitHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash || /[\u0000-\u0020\u007f]/u.test(value) || value.length > 1024) return null;
    return url.toString();
  } catch { return null; }
}

function clip(value: string | undefined, length: number): string | undefined {
  if (!value) return undefined;
  const result = value.split(/\r?\n/u, 1)[0].trim();
  return result ? result.slice(0, length) : undefined;
}
function remoteHttps(remote: string): string | null {
  const scp = remote.match(/^git@([^:]+):(.+)$/u);
  const candidate = scp ? `https://${scp[1]}/${scp[2]}` : remote.replace(/^ssh:\/\//u, "https://").replace(/\.git$/u, "");
  return validateGitHttpsUrl(candidate.replace(/\.git$/u, ""));
}

/**
 * Bounded read-only Git projection. No command in this module can stage, diff,
 * checkout, or mutate a repository; commit/push remain Pi commands.
 */
export class GitSummaryService {
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  constructor(private readonly options: GitSummaryServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
  }
  async summarize(workspaceId: string, cwd: string, signal?: AbortSignal): Promise<GitSummary | GitUnavailable> {
    const run = async (args: readonly string[]) => this.options.runner.run("git", args, { cwd, timeoutMs: this.timeoutMs, signal });
    try {
      const root = await run(["rev-parse", "--show-toplevel"]);
      if (root.code !== 0) return this.unavailable(workspaceId, "not_repository", "Workspace is not a Git repository");
      const remote = await run(["remote", "get-url", "origin"]);
      if (remote.code !== 0) return this.unavailable(workspaceId, "remote_missing", "Repository has no origin remote");
      const repositoryUrl = remoteHttps(remote.stdout.trim());
      if (!repositoryUrl) return this.unavailable(workspaceId, "invalid_remote", "Origin is not a safe HTTPS repository URL");
      const repository = new URL(repositoryUrl).pathname.replace(/^\//u, "").replace(/\.git$/u, "");
      const head = await run(["log", "-1", "--format=%H%x00%s%x00%an%x00%aI"]);
      if (head.code !== 0) return this.unavailable(workspaceId, "unknown", "Repository has no readable commit");
      const fields = head.stdout.trim().split("\0");
      const sha = fields[0];
      const commitUrl = validateGitHttpsUrl(`${repositoryUrl}/commit/${sha}`);
      if (!sha || !commitUrl) return this.unavailable(workspaceId, "invalid_remote", "Commit link could not be safely constructed");
      const branchResult = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const detached = branchResult.code !== 0;
      const branch = detached ? null : clip(branchResult.stdout.trim(), 128) ?? null;
      const status = await run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
      const changedCount = status.code === 0 ? status.stdout.split("\0").filter(Boolean).length : 0;
      const upstream = await run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      const counts = upstream.code === 0 ? upstream.stdout.trim().split(/\s+/u).map(Number) : [0, 0];
      const result: GitSummary = {
        workspaceId, revision: createHash("sha256").update(`${sha}:${status.stdout}:${branch ?? "detached"}`).digest("hex").slice(0, 32),
        repositoryUrl, repository: clip(repository, 128) ?? repository, detached, branch,
        workingTreeState: status.code === 0 ? (changedCount ? "dirty" : "clean") : "unknown", changedCount,
        ahead: Number.isFinite(counts[0]) && counts[0] >= 0 ? counts[0] : 0, behind: Number.isFinite(counts[1]) && counts[1] >= 0 ? counts[1] : 0,
        latestCommit: { sha, message: clip(fields[1], 240), author: clip(fields[2], 128), authoredAt: fields[3], url: commitUrl },
        ciStatus: { state: "unknown" }, failedChecks: [], supportedActions: ["refresh", "open_external"], capability: "git-ci.v1", lastRefreshedAt: this.now().toISOString(),
      };
      if (this.options.provider) {
        try {
          const provider = await this.options.provider.summary({ repository, branch, sha });
          const safe = provider.failedChecks.slice(0, 20).map((check) => ({ ...check, summary: clip(check.summary, 512), logSummary: clip(check.logSummary, 4096), url: check.url ? validateGitHttpsUrl(check.url) ?? undefined : undefined }));
          return { ...result, pullRequest: provider.pullRequest && validateGitHttpsUrl(provider.pullRequest.url) ? { ...provider.pullRequest, url: validateGitHttpsUrl(provider.pullRequest.url)! } : undefined, ciStatus: provider.ciStatus, failedChecks: safe, supportedActions: [...result.supportedActions, "commit_through_pi", "push_through_pi"] };
        } catch { return this.unavailable(workspaceId, "provider_unavailable", "Git provider is unavailable"); }
      }
      return result;
    } catch (error) {
      const reason = error instanceof Error && /timeout|abort/u.test(error.message) ? "timeout" : "git_missing";
      return this.unavailable(workspaceId, reason, "Git status is unavailable");
    }
  }
  private unavailable(workspaceId: string, reason: GitUnavailableReason, message: string): GitUnavailable { return { workspaceId, capability: "git-ci.v1", status: "unavailable", reason, message }; }
}
