import { createHash } from "node:crypto";

/** Version of the policy rules themselves. Bump whenever an allow/deny rule changes. */
export const HOST_POLICY_VERSION = "1.0.0" as const;
export const HOST_POLICY_MANIFEST_SCHEMA_VERSION = 1 as const;
export const HOST_POLICY_MANIFEST_NAME = "pi-mob.host-tool-policy" as const;
export const HOST_POLICY_FINGERPRINT_ALGORITHM = "sha256" as const;

export const HOST_POLICY_CAPABILITIES = Object.freeze([
  "policy.host_tool_hook.v1",
  "policy.mode.full.v1",
  "policy.mode.read_only.v1",
  "policy.read_only.default_deny_unknown.v1",
  "policy.read_only.shell_lexical_allowlist.v1",
  "policy.turn_snapshot.v1",
  "policy.guardrail_not_os_sandbox.v1",
] as const);

export const READ_ONLY_ALLOWED_TOOLS = Object.freeze(["read", "grep", "find", "ls", "bash"] as const);

const DIRECT_READ_ONLY_TOOLS = new Set<string>(["read", "grep", "find", "ls"]);
const WRITE_TOOL_NAMES = new Set<string>([
  "write",
  "edit",
  "apply_patch",
  "patch",
  "multi_edit",
  "create_file",
  "delete_file",
  "move_file",
  "rename_file",
]);
const DESTRUCTIVE_TOOL_NAMES = new Set<string>([
  "delete",
  "remove",
  "destroy",
  "session.delete",
  "session.purge",
  "queue.clear",
  "workspace.delete",
]);

const PACKAGE_MANAGERS = new Set<string>([
  "npm", "npx", "pnpm", "pnpx", "yarn", "corepack", "bun", "bunx", "deno",
  "pip", "pip3", "pipx", "uv", "poetry", "conda", "mamba", "cargo", "go",
  "gradle", "gradlew", "mvn", "mvnw", "sbt", "gem", "bundle", "composer", "nuget",
  "dotnet", "mix", "luarocks", "cabal", "stack", "apt", "apt-get", "apt-cache", "brew",
  "port", "dnf", "yum", "pacman", "zypper", "apk", "winget", "choco",
]);
const FILE_MUTATORS = new Set<string>([
  "rm", "rmdir", "mv", "cp", "mkdir", "touch", "install", "chmod", "chown", "chgrp",
  "ln", "tee", "truncate", "dd", "shred", "mktemp", "rsync", "tar", "zip", "unzip",
]);
const ARBITRARY_EXECUTORS = new Set<string>([
  "sh", "bash", "zsh", "fish", "dash", "env", "command", "eval", "exec", "xargs",
  "node", "python", "python3", "perl", "ruby", "php", "osascript",
  "sudo", "doas", "su", "kill", "pkill", "killall", "shutdown", "reboot",
  "systemctl", "service", "launchctl",
]);
const OTHER_VCS_TOOLS = new Set<string>(["hg", "svn", "fossil"]);

export const READ_ONLY_SHELL_COMMANDS = Object.freeze([
  "cat", "head", "tail", "grep", "egrep", "fgrep", "ls", "pwd", "wc", "file", "stat",
  "du", "df", "realpath", "readlink", "dirname", "basename", "cut", "tr", "fold", "paste",
  "nl", "od", "hexdump", "strings", "cmp", "diff", "comm", "jq", "echo", "printf", "test",
  "true", "false", "which", "whereis", "whoami", "id", "uname", "date", "cal", "uptime",
  "ps", "printenv", "md5", "md5sum", "sha1sum", "sha256sum", "shasum",
  "find", "rg", "sort", "uniq", "tree", "git",
] as const);
const SIMPLE_READ_COMMANDS = new Set<string>(READ_ONLY_SHELL_COMMANDS);

export type PolicyMode = "full" | "read_only";

/** Durable policy data supplied by the bridge. All three fields are snapshotted for a turn. */
export interface HostPolicyState {
  readonly mode: PolicyMode;
  readonly version: string;
  readonly fingerprint: string;
}

export interface TurnPolicySnapshot extends HostPolicyState {
  /** Fingerprint of the executable rules, separate from the bridge-supplied trust fingerprint. */
  readonly engineFingerprint: string;
}

export interface HostToolCall {
  readonly toolName: string;
  readonly input?: unknown;
  readonly toolCallId?: string;
}

export type PolicyRefusalCategory =
  | "write_tool"
  | "mutating_shell"
  | "destructive_operation"
  | "unknown_tool"
  | "invalid_tool_input";

export interface PolicyRefusal {
  readonly code: "host_policy_denied";
  readonly category: PolicyRefusalCategory;
  readonly message: string;
  readonly toolName: string;
  readonly policy: TurnPolicySnapshot;
  readonly details?: {
    readonly shellCode: ShellRefusalCode;
    readonly command?: string;
  };
  readonly enforcement: "host_tool_call_hook";
  /** Explicitly avoids representing the tool hook as a containment boundary. */
  readonly sandbox: "not_provided";
}

export interface PolicyAllowed {
  readonly allowed: true;
  readonly policy: TurnPolicySnapshot;
}

export interface PolicyDenied {
  readonly allowed: false;
  readonly refusal: PolicyRefusal;
}

export type PolicyDecision = PolicyAllowed | PolicyDenied;

export type ShellRefusalCode =
  | "empty_command"
  | "command_too_long"
  | "command_substitution"
  | "redirection"
  | "unsupported_shell_operator"
  | "invalid_shell_syntax"
  | "package_manager"
  | "vcs_mutation"
  | "file_mutation"
  | "arbitrary_execution"
  | "command_not_allowlisted"
  | "unsafe_command_arguments"
  | "pipe_into_mutator";

export interface ReadOnlyShellAllowed {
  readonly allowed: true;
  readonly commands: readonly string[];
}

export interface ReadOnlyShellDenied {
  readonly allowed: false;
  readonly code: ShellRefusalCode;
  readonly command?: string;
}

export type ReadOnlyShellDecision = ReadOnlyShellAllowed | ReadOnlyShellDenied;

export interface HostPolicyManifest {
  readonly schemaVersion: typeof HOST_POLICY_MANIFEST_SCHEMA_VERSION;
  readonly name: typeof HOST_POLICY_MANIFEST_NAME;
  readonly policyVersion: typeof HOST_POLICY_VERSION;
  readonly fingerprintAlgorithm: typeof HOST_POLICY_FINGERPRINT_ALGORITHM;
  readonly fingerprint: string;
  readonly capabilities: typeof HOST_POLICY_CAPABILITIES;
  readonly modes: readonly PolicyMode[];
  readonly readOnly: {
    readonly allowedTools: typeof READ_ONLY_ALLOWED_TOOLS;
    readonly shellCommands: typeof READ_ONLY_SHELL_COMMANDS;
    readonly unknownTools: "deny";
    readonly shellValidation: "conservative_lexical_allowlist";
  };
  readonly enforcement: "host_tool_call_hook";
  readonly securityBoundary: "tool_level_guardrail_not_os_sandbox";
}

type ManifestBody = Omit<HostPolicyManifest, "fingerprint" | "fingerprintAlgorithm">;

function policyManifestBody(): ManifestBody {
  return {
    schemaVersion: HOST_POLICY_MANIFEST_SCHEMA_VERSION,
    name: HOST_POLICY_MANIFEST_NAME,
    policyVersion: HOST_POLICY_VERSION,
    capabilities: HOST_POLICY_CAPABILITIES,
    modes: Object.freeze(["full", "read_only"] as const),
    readOnly: Object.freeze({
      allowedTools: READ_ONLY_ALLOWED_TOOLS,
      shellCommands: READ_ONLY_SHELL_COMMANDS,
      unknownTools: "deny" as const,
      shellValidation: "conservative_lexical_allowlist" as const,
    }),
    enforcement: "host_tool_call_hook",
    securityBoundary: "tool_level_guardrail_not_os_sandbox",
  };
}

/**
 * Trust-bearing description of the exact host policy rules. Consumers can persist
 * its fingerprint and require renewed trust when the rules or policy version move.
 */
export function buildHostPolicyManifest(): HostPolicyManifest {
  const body = policyManifestBody();
  const fingerprint = createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
  return Object.freeze({
    ...body,
    fingerprintAlgorithm: HOST_POLICY_FINGERPRINT_ALGORITHM,
    fingerprint,
  });
}

export const HOST_POLICY_MANIFEST = buildHostPolicyManifest();

function validatePolicyState(policy: HostPolicyState): void {
  if (policy.mode !== "full" && policy.mode !== "read_only") {
    throw new TypeError(`Unsupported host policy mode: ${String(policy.mode)}`);
  }
  if (policy.version.length === 0) throw new TypeError("Host policy version must not be empty");
  if (policy.fingerprint.length === 0) throw new TypeError("Host policy fingerprint must not be empty");
}

/** Copy and freeze effective policy at the bridge's turn-start boundary. */
export function snapshotPolicyAtTurnStart(policy: HostPolicyState): TurnPolicySnapshot {
  validatePolicyState(policy);
  return Object.freeze({
    mode: policy.mode,
    version: policy.version,
    fingerprint: policy.fingerprint,
    engineFingerprint: HOST_POLICY_MANIFEST.fingerprint,
  });
}

function policyRefusal(
  snapshot: TurnPolicySnapshot,
  toolName: string,
  category: PolicyRefusalCategory,
  details?: PolicyRefusal["details"],
): PolicyDenied {
  const message = `Host read-only policy denied ${toolName || "the tool call"}. `
    + "This is a tool-level guardrail and does not provide an OS sandbox.";
  return {
    allowed: false,
    refusal: Object.freeze({
      code: "host_policy_denied",
      category,
      message,
      toolName,
      policy: snapshot,
      ...(details === undefined ? {} : { details: Object.freeze(details) }),
      enforcement: "host_tool_call_hook",
      sandbox: "not_provided",
    }),
  };
}

/** Evaluate exactly the supplied turn snapshot; mutable current policy is never consulted. */
export function evaluateHostToolCall(snapshot: TurnPolicySnapshot, call: HostToolCall): PolicyDecision {
  if (snapshot.mode === "full") return { allowed: true, policy: snapshot };

  const toolName = call.toolName;
  if (DIRECT_READ_ONLY_TOOLS.has(toolName)) return { allowed: true, policy: snapshot };
  if (WRITE_TOOL_NAMES.has(toolName)) return policyRefusal(snapshot, toolName, "write_tool");
  if (DESTRUCTIVE_TOOL_NAMES.has(toolName)) return policyRefusal(snapshot, toolName, "destructive_operation");

  if (toolName === "bash") {
    const input = isRecord(call.input) ? call.input : undefined;
    const command = input?.command;
    if (typeof command !== "string") return policyRefusal(snapshot, toolName, "invalid_tool_input");
    const shellDecision = validateReadOnlyShell(command);
    return shellDecision.allowed
      ? { allowed: true, policy: snapshot }
      : policyRefusal(snapshot, toolName, "mutating_shell", {
          shellCode: shellDecision.code,
          ...(shellDecision.command === undefined ? {} : { command: shellDecision.command }),
        });
  }

  // Fail closed: a newly installed extension tool is not read-only merely because its name sounds safe.
  return policyRefusal(snapshot, toolName, "unknown_tool");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface LexicalWord {
  value: string;
  hasUnquotedGlob: boolean;
}

interface ShellPipeline {
  stages: LexicalWord[][];
}

type LexResult = { ok: true; pipeline: ShellPipeline } | { ok: false; code: ShellRefusalCode };

const MAX_SHELL_COMMAND_LENGTH = 32 * 1024;

/**
 * A deliberately small shell lexer, not a shell parser. It recognizes words,
 * quotes, escapes, and a plain pipeline. Every construct outside that grammar is
 * denied before command allowlisting; the result is a guardrail, not a sandbox.
 */
function lexReadOnlyPipeline(command: string): LexResult {
  if (command.trim().length === 0) return { ok: false, code: "empty_command" };
  if (command.length > MAX_SHELL_COMMAND_LENGTH) return { ok: false, code: "command_too_long" };
  if (command.includes("\0")) return { ok: false, code: "invalid_shell_syntax" };
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(command)) {
    return { ok: false, code: "invalid_shell_syntax" };
  }

  const stages: LexicalWord[][] = [];
  let words: LexicalWord[] = [];
  let value = "";
  let wordStarted = false;
  let hasUnquotedGlob = false;
  let quote: "single" | "double" | undefined;

  const finishWord = (): void => {
    if (!wordStarted) return;
    words.push({ value, hasUnquotedGlob });
    value = "";
    wordStarted = false;
    hasUnquotedGlob = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (quote === "single") {
      if (char === "'") quote = undefined;
      else value += char;
      continue;
    }

    if (quote === "double") {
      if (char === "\"") {
        quote = undefined;
        continue;
      }
      if (char === "$" || char === "`") return { ok: false, code: "command_substitution" };
      if (char === "\\") {
        const next = command[index + 1];
        if (next === undefined || next === "\n" || next === "\r") {
          return { ok: false, code: "invalid_shell_syntax" };
        }
        // In POSIX double quotes, backslash is special only before these characters.
        value += next === "$" || next === "`" || next === "\"" || next === "\\"
          ? next
          : `\\${next}`;
        index += 1;
        continue;
      }
      value += char;
      continue;
    }

    if (char === "'") {
      quote = "single";
      wordStarted = true;
      continue;
    }
    if (char === "\"") {
      quote = "double";
      wordStarted = true;
      continue;
    }
    if (char === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\n" || next === "\r") {
        return { ok: false, code: "invalid_shell_syntax" };
      }
      value += next;
      wordStarted = true;
      index += 1;
      continue;
    }
    if (char === "$" || char === "`") return { ok: false, code: "command_substitution" };
    if (char === ">" || char === "<") return { ok: false, code: "redirection" };
    if (char === "|" && command[index + 1] === "|") {
      return { ok: false, code: "unsupported_shell_operator" };
    }
    if (char === "|") {
      finishWord();
      if (words.length === 0) return { ok: false, code: "invalid_shell_syntax" };
      stages.push(words);
      words = [];
      continue;
    }
    if (char === ";" || char === "&" || char === "\n" || char === "\r"
      || char === "(" || char === ")" || char === "{" || char === "}" || char === "#") {
      return { ok: false, code: "unsupported_shell_operator" };
    }
    if (char === " " || char === "\t") {
      finishWord();
      continue;
    }
    // Shell token boundaries are ASCII blanks. Treat Unicode whitespace as
    // unsupported instead of parsing a different command than the shell does.
    if (/\s/u.test(char)) return { ok: false, code: "invalid_shell_syntax" };
    if (char === "*" || char === "?" || char === "[") hasUnquotedGlob = true;
    value += char;
    wordStarted = true;
  }

  if (quote !== undefined) return { ok: false, code: "invalid_shell_syntax" };
  finishWord();
  if (words.length === 0) return { ok: false, code: "invalid_shell_syntax" };
  stages.push(words);
  return { ok: true, pipeline: { stages } };
}

interface StageAllowed {
  allowed: true;
  command: string;
}
interface StageDenied {
  allowed: false;
  code: ShellRefusalCode;
  command: string;
  mutator: boolean;
}
type StageDecision = StageAllowed | StageDenied;

function denyStage(command: string, code: ShellRefusalCode, mutator = false): StageDenied {
  return { allowed: false, code, command, mutator };
}

function hasOption(words: readonly LexicalWord[], option: string): boolean {
  return words.slice(1).some(({ value }) => value === option || value.startsWith(`${option}=`));
}

function hasShortFlag(words: readonly LexicalWord[], flag: string): boolean {
  let optionsEnded = false;
  for (const { value } of words.slice(1)) {
    if (value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && /^-[^-]/u.test(value) && value.slice(1).includes(flag)) return true;
  }
  return false;
}

function validateFind(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  const unsafeActions = new Set([
    "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprintf", "-fprint", "-fprint0",
  ]);
  if (words.slice(1).some((word) => word.hasUnquotedGlob || unsafeActions.has(word.value))) {
    return denyStage(command, "unsafe_command_arguments", true);
  }
  return { allowed: true, command };
}

function validateRipgrep(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  if (words.some((word, index) => index > 0 && word.hasUnquotedGlob)) {
    return denyStage(command, "unsafe_command_arguments");
  }
  if (hasOption(words, "--pre") || hasOption(words, "--hostname-bin")) {
    return denyStage(command, "arbitrary_execution", true);
  }
  return { allowed: true, command };
}

function validateSort(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  const args = words.slice(1);
  if (args.some((word) => word.hasUnquotedGlob)
    || hasOption(words, "--output") || hasOption(words, "--compress-program")
    || hasOption(words, "--temporary-directory")
    || args.some(({ value }) => value === "-o" || /^-o.+/u.test(value)
      || value === "-T" || /^-T.+/u.test(value))) {
    return denyStage(command, "unsafe_command_arguments", true);
  }
  return { allowed: true, command };
}

function validateUniq(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  const args = words.slice(1);
  if (args.some((word) => word.hasUnquotedGlob)) return denyStage(command, "unsafe_command_arguments", true);

  let positional = 0;
  let optionsEnded = false;
  const optionsWithSeparateValue = new Set(["-f", "--skip-fields", "-s", "--skip-chars", "-w", "--check-chars"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!.value;
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && optionsWithSeparateValue.has(arg)) {
      index += 1;
      if (index >= args.length) return denyStage(command, "unsafe_command_arguments");
    } else if (!optionsEnded && arg.startsWith("-")) {
      continue;
    } else {
      positional += 1;
    }
  }
  // uniq's optional second positional operand is an output file.
  return positional > 1
    ? denyStage(command, "unsafe_command_arguments", true)
    : { allowed: true, command };
}

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "blame", "shortlog", "describe", "rev-parse",
  "ls-files", "ls-tree", "ls-remote", "grep",
]);

function validateGit(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  const args = words.slice(1);
  if (args.some((word) => word.hasUnquotedGlob)) return denyStage(command, "unsafe_command_arguments", true);

  let index = 0;
  while (args[index]?.value === "-C" || args[index]?.value === "--no-pager") {
    if (args[index]!.value === "-C") {
      if (args[index + 1] === undefined) return denyStage(command, "unsafe_command_arguments");
      index += 2;
    } else {
      index += 1;
    }
  }
  const subcommand = args[index]?.value;
  if (subcommand === undefined) return denyStage(command, "unsafe_command_arguments");
  const subArgs = args.slice(index + 1).map(({ value }) => value);

  if (subArgs.some((arg) => arg === "--ext-diff" || arg === "--textconv"
    || arg === "--open-files-in-pager" || arg.startsWith("--open-files-in-pager=")
    || arg === "--output" || arg.startsWith("--output="))) {
    return denyStage(command, "vcs_mutation", true);
  }

  if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return { allowed: true, command };
  if (subcommand === "branch") {
    const safe = subArgs.length === 0 || subArgs.every((arg) => arg === "--list" || arg === "-l"
      || arg === "--show-current" || arg === "-a" || arg === "--all" || arg === "-r" || arg === "--remotes"
      || arg === "-v" || arg === "-vv");
    return safe ? { allowed: true, command } : denyStage(command, "vcs_mutation", true);
  }
  if (subcommand === "tag") {
    const safe = subArgs.length === 0 || subArgs.every((arg) => arg === "--list" || arg === "-l");
    return safe ? { allowed: true, command } : denyStage(command, "vcs_mutation", true);
  }
  if (subcommand === "remote") {
    const safe = subArgs.length === 0 || (subArgs.length === 1 && (subArgs[0] === "-v" || subArgs[0] === "--verbose"));
    return safe ? { allowed: true, command } : denyStage(command, "vcs_mutation", true);
  }
  if (subcommand === "config") {
    const readModes = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);
    const readMode = subArgs[0];
    const safe = readMode !== undefined && readModes.has(readMode)
      && (readMode === "--list" || readMode === "-l" ? subArgs.length === 1 : subArgs.length === 2);
    return safe ? { allowed: true, command } : denyStage(command, "vcs_mutation", true);
  }
  return denyStage(command, "vcs_mutation", true);
}

function validateDate(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]!.value;
  const safeOptions = /^(?:-u|--utc|--universal|-R|--rfc-email|-I(?:date|hours|minutes|seconds|ns)?|--iso-8601(?:=(?:date|hours|minutes|seconds|ns))?|\+.*)$/u;
  return words.slice(1).every(({ value, hasUnquotedGlob }) => !hasUnquotedGlob && safeOptions.test(value))
    ? { allowed: true, command }
    : denyStage(command, "unsafe_command_arguments", true);
}

function validateStage(words: readonly LexicalWord[]): StageDecision {
  const command = words[0]?.value ?? "";
  const commandBase = command.slice(command.lastIndexOf("/") + 1);
  if (PACKAGE_MANAGERS.has(command) || PACKAGE_MANAGERS.has(commandBase)) {
    return denyStage(command, "package_manager", true);
  }
  if (FILE_MUTATORS.has(command)) return denyStage(command, "file_mutation", true);
  if (ARBITRARY_EXECUTORS.has(command)) return denyStage(command, "arbitrary_execution", true);
  if (OTHER_VCS_TOOLS.has(command)) return denyStage(command, "vcs_mutation", true);
  if (command === "git") return validateGit(words);
  if (command === "find") return validateFind(words);
  if (command === "rg") return validateRipgrep(words);
  if (command === "date") return validateDate(words);
  if (command === "file" && (hasOption(words, "--compile") || hasShortFlag(words, "C"))) {
    return denyStage(command, "unsafe_command_arguments", true);
  }
  if (command === "diff" && (hasOption(words, "--output") || hasShortFlag(words, "o"))) {
    return denyStage(command, "unsafe_command_arguments", true);
  }
  if (command === "sort") return validateSort(words);
  if (command === "uniq") return validateUniq(words);
  if (command === "tree") {
    return hasOption(words, "--output") || words.slice(1).some(({ value }) => value === "-o" || /^-o.+/u.test(value))
      ? denyStage(command, "unsafe_command_arguments", true)
      : { allowed: true, command };
  }
  if (SIMPLE_READ_COMMANDS.has(command)) return { allowed: true, command };
  return denyStage(command, "command_not_allowlisted");
}

/** Validate a useful but intentionally narrow set of read-only shell commands and pipelines. */
export function validateReadOnlyShell(command: string): ReadOnlyShellDecision {
  const lexical = lexReadOnlyPipeline(command);
  if (!lexical.ok) return { allowed: false, code: lexical.code };

  const commands: string[] = [];
  for (let index = 0; index < lexical.pipeline.stages.length; index += 1) {
    const result = validateStage(lexical.pipeline.stages[index]!);
    if (!result.allowed) {
      return {
        allowed: false,
        code: index > 0 && result.mutator ? "pipe_into_mutator" : result.code,
        command: result.command,
      };
    }
    commands.push(result.command);
  }
  return { allowed: true, commands: Object.freeze(commands) };
}

/** Mutable session policy holder whose decisions always require an immutable per-turn snapshot. */
export class HostPolicyEngine {
  private current: HostPolicyState;

  constructor(initial: HostPolicyState) {
    validatePolicyState(initial);
    this.current = Object.freeze({ ...initial });
  }

  setPolicy(policy: HostPolicyState): void {
    validatePolicyState(policy);
    this.current = Object.freeze({ ...policy });
  }

  getPolicy(): HostPolicyState {
    return this.current;
  }

  beginTurn(): TurnPolicySnapshot {
    return snapshotPolicyAtTurnStart(this.current);
  }

  evaluate(snapshot: TurnPolicySnapshot, call: HostToolCall): PolicyDecision {
    return evaluateHostToolCall(snapshot, call);
  }
}

export interface PolicyToolCallGateAllowed {
  readonly block?: false;
}

export interface PolicyToolCallGateDenied {
  readonly block: true;
  readonly reason: string;
  readonly refusal: PolicyRefusal;
}

export type PolicyToolCallGateResult = PolicyToolCallGateAllowed | PolicyToolCallGateDenied;

/** Convert the pure decision to Pi's extension `tool_call` blocking shape. */
export function toPolicyToolCallGateResult(decision: PolicyDecision): PolicyToolCallGateResult {
  if (decision.allowed) return {};
  return { block: true, reason: decision.refusal.message, refusal: decision.refusal };
}

/**
 * Small extension-style adapter. `beginTurn` belongs in Pi's
 * `before_agent_start` hook and the returned `toolCall` function belongs in its
 * `tool_call` hook. The adapter deliberately retains the captured snapshot.
 */
export function createHostPolicyToolGate(getCurrentPolicy: () => HostPolicyState): {
  readonly beginTurn: () => TurnPolicySnapshot;
  readonly toolCall: (call: HostToolCall) => PolicyToolCallGateResult;
  readonly currentTurnPolicy: () => TurnPolicySnapshot | undefined;
  readonly endTurn: () => void;
} {
  let turnPolicy: TurnPolicySnapshot | undefined;
  return Object.freeze({
    beginTurn(): TurnPolicySnapshot {
      turnPolicy = snapshotPolicyAtTurnStart(getCurrentPolicy());
      return turnPolicy;
    },
    toolCall(call: HostToolCall): PolicyToolCallGateResult {
      // A call outside a normal lifecycle still fails closed using a newly captured policy.
      const snapshot = turnPolicy ?? snapshotPolicyAtTurnStart(getCurrentPolicy());
      return toPolicyToolCallGateResult(evaluateHostToolCall(snapshot, call));
    },
    currentTurnPolicy(): TurnPolicySnapshot | undefined {
      return turnPolicy;
    },
    endTurn(): void {
      turnPolicy = undefined;
    },
  });
}
