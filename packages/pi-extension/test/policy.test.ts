import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  HOST_POLICY_CAPABILITIES,
  HOST_POLICY_FINGERPRINT_ALGORITHM,
  HOST_POLICY_MANIFEST,
  HOST_POLICY_VERSION,
  HostPolicyEngine,
  buildHostPolicyManifest,
  createHostPolicyToolGate,
  evaluateHostToolCall,
  snapshotPolicyAtTurnStart,
  toPolicyToolCallGateResult,
  validateReadOnlyShell,
  type HostPolicyState,
} from "../src/index";

const readOnly: HostPolicyState = {
  mode: "read_only",
  version: "workspace-policy-7",
  fingerprint: "approved-trust-fingerprint-a",
};
const full: HostPolicyState = {
  mode: "full",
  version: "workspace-policy-8",
  fingerprint: "approved-trust-fingerprint-b",
};

describe("host read-only tool classification", () => {
  const snapshot = snapshotPolicyAtTurnStart(readOnly);

  test.each(["read", "grep", "find", "ls"])("allows the classified read-only %s tool", (toolName) => {
    expect(evaluateHostToolCall(snapshot, { toolName, input: { path: "any" } })).toEqual({
      allowed: true,
      policy: snapshot,
    });
  });

  test.each([
    ["write", "write_tool"],
    ["edit", "write_tool"],
    ["apply_patch", "write_tool"],
    ["multi_edit", "write_tool"],
    ["delete", "destructive_operation"],
    ["session.purge", "destructive_operation"],
    ["queue.clear", "destructive_operation"],
    ["read_file_but_custom", "unknown_tool"],
    ["get_weather", "unknown_tool"],
    ["Read", "unknown_tool"],
    ["", "unknown_tool"],
  ])("denies %s as %s", (toolName, category) => {
    const decision = evaluateHostToolCall(snapshot, { toolName });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected policy denial");
    expect(String(decision.refusal.category)).toBe(category);
    expect(decision.refusal.policy).toBe(snapshot);
  });

  test("full mode deliberately allows every tool and input", () => {
    const fullSnapshot = snapshotPolicyAtTurnStart(full);
    for (const call of [
      { toolName: "write", input: { path: "/etc/passwd" } },
      { toolName: "bash", input: { command: "rm -rf /" } },
      { toolName: "future_unknown_tool" },
      { toolName: "bash", input: null },
    ]) {
      expect(evaluateHostToolCall(fullSnapshot, call)).toEqual({ allowed: true, policy: fullSnapshot });
    }
  });

  test("bash input fails closed when absent, malformed, or non-string", () => {
    for (const input of [undefined, null, {}, { command: 1 }, { command: ["ls"] }, "ls"]) {
      const decision = evaluateHostToolCall(snapshot, { toolName: "bash", input });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.refusal.category).toBe("invalid_tool_input");
    }
  });

  test("bash refusal preserves the stable shell denial code", () => {
    const decision = evaluateHostToolCall(snapshot, {
      toolName: "bash",
      input: { command: "cat README | tee copy" },
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected policy denial");
    expect(decision.refusal.details).toEqual({ shellCode: "pipe_into_mutator", command: "tee" });
  });

  test("refusal is structured, extension-compatible, and explicitly makes no sandbox promise", () => {
    const decision = evaluateHostToolCall(snapshot, { toolName: "edit", toolCallId: "tc-1" });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected policy denial");

    expect(decision.refusal).toMatchObject({
      code: "host_policy_denied",
      category: "write_tool",
      toolName: "edit",
      enforcement: "host_tool_call_hook",
      sandbox: "not_provided",
      policy: readOnly,
    });
    expect(decision.refusal.message).toContain("does not provide an OS sandbox");
    expect(toPolicyToolCallGateResult(decision)).toEqual({
      block: true,
      reason: decision.refusal.message,
      refusal: decision.refusal,
    });
  });
});

describe("conservative AST-free shell validation", () => {
  test.each([
    "ls",
    "ls -la ./src",
    "pwd",
    "cat README.md",
    "cat 'a file.txt'",
    "head -n 20 README.md",
    "tail -f app.log",
    "grep -R -- 'needle' src",
    "rg --hidden --glob '!node_modules' TODO .",
    "find . -type f -name '*.ts' -print",
    "wc -l README.md",
    "file package.json",
    "stat package.json",
    "du -sh .",
    "df -h",
    "realpath .",
    "readlink package-link",
    "dirname src/index.ts",
    "basename src/index.ts",
    "diff -- README.old README.md",
    "jq '.name' package.json",
    "printf '%s\\n' literal",
    "echo '$(literal, not substitution)'",
    "printenv",
    "uname -a",
    "whoami",
    "id",
    "date",
    "date -u +%Y-%m-%d",
    "ps aux",
    "sha256sum package.json",
    "git status --short",
    "git -C repo log --oneline -5",
    "git --no-pager log --oneline -5",
    "git diff -- src",
    "git show HEAD:README.md",
    "git blame README.md",
    "git rev-parse HEAD",
    "git ls-files",
    "git branch --list",
    "git tag --list",
    "git remote -v",
    "git config --get remote.origin.url",
    "cat package.json | grep name | wc -l",
    "rg TODO . | head -n 20",
    "printf '%s' text | sha256sum",
    "sort names.txt | uniq -c",
  ])("allows an unambiguous read-only form: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: true });
  });

  test.each([
    ["", "empty_command"],
    ["   ", "empty_command"],
    ["cat README > copy", "redirection"],
    ["cat README >> copy", "redirection"],
    ["cat < README", "redirection"],
    ["cat 2>/dev/null README", "redirection"],
    ["cat <<< payload", "redirection"],
    ["cat <<EOF", "redirection"],
    ["cat $(touch owned)", "command_substitution"],
    ["cat `touch owned`", "command_substitution"],
    ["cat $FILE", "command_substitution"],
    ["cat ${FILE}", "command_substitution"],
    ["ls; rm file", "unsupported_shell_operator"],
    ["ls && rm file", "unsupported_shell_operator"],
    ["ls || touch file", "unsupported_shell_operator"],
    ["ls & touch file", "unsupported_shell_operator"],
    ["ls\nrm file", "unsupported_shell_operator"],
    ["(ls)", "unsupported_shell_operator"],
    ["{ ls; }", "unsupported_shell_operator"],
    ["ls # then hidden text", "unsupported_shell_operator"],
    ["cat <(touch file)", "redirection"],
    ["cat >(touch file)", "redirection"],
    ["cat 'unterminated", "invalid_shell_syntax"],
    ["cat README |", "invalid_shell_syntax"],
    ["| cat README", "invalid_shell_syntax"],
    ["cat README || tee copy", "unsupported_shell_operator"],
    ["FOO=value ls", "command_not_allowlisted"],
    ["/bin/ls", "command_not_allowlisted"],
    ["unknown --read-only", "command_not_allowlisted"],
    ["\"c\\\\at\" README", "command_not_allowlisted"],
    ["ls\u00a0-la", "invalid_shell_syntax"],
  ])("denies ambiguous shell syntax %s (%s)", (command, code) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code });
  });

  test.each([
    "rm file",
    "r\\m file",
    "'rm' file",
    "rmdir empty",
    "mv a b",
    "cp a b",
    "mkdir output",
    "touch output",
    "install source destination",
    "chmod 600 file",
    "chown user file",
    "ln -s a b",
    "tee output",
    "truncate -s0 file",
    "dd if=/dev/zero of=file",
    "shred file",
    "mktemp",
    "rsync source destination",
    "tar -xf archive.tar",
    "zip archive file",
    "unzip archive.zip",
  ])("denies file mutation: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code: "file_mutation" });
  });

  test.each([
    "cat README | tee copy",
    "cat README | rm file",
    "cat README | npm install pkg",
    "cat README | git commit -F -",
    "cat README | sh",
    "cat README | sort -o copy",
    "cat README | uniq input output",
  ])("specifically denies a pipe into a mutator: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code: "pipe_into_mutator" });
  });

  test.each([
    "npm install pkg",
    "npm view pkg",
    "npx prettier .",
    "pnpm add pkg",
    "yarn why pkg",
    "bun install",
    "bunx eslint .",
    "pip install pkg",
    "pip3 list",
    "uv sync",
    "poetry show",
    "cargo metadata",
    "gem list",
    "bundle check",
    "composer show",
    "corepack prepare pnpm@latest",
    "pipx list",
    "conda list",
    "go list ./...",
    "gradle dependencies",
    "./gradlew dependencies",
    "mvn dependency:tree",
    "dotnet list package",
    "apt-cache policy pkg",
    "apt-get update",
    "brew list",
    "dnf info pkg",
  ])("denies every package-manager entry point: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code: "package_manager" });
  });

  test.each([
    "git add .",
    "git commit -m x",
    "git push",
    "git pull",
    "git merge topic",
    "git rebase main",
    "git reset --hard",
    "git checkout branch",
    "git switch branch",
    "git restore file",
    "git clean -fd",
    "git stash",
    "git init",
    "git clone url",
    "git tag v1",
    "git branch topic",
    "git branch -D topic",
    "git remote add origin url",
    "git config user.name x",
    "git diff --output=patch",
    "git log --open-files-in-pager=nvim",
    "hg status",
    "svn info",
  ])("denies VCS mutations and unsafe VCS execution: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code: "vcs_mutation" });
  });

  test.each([
    "find . -delete",
    "find . -exec touch {} +",
    "find . -execdir rm {} +",
    "find . -fprint output",
    "find . -fprintf output '%p\\n'",
    "file --compile",
    "file -C -m magic",
    "date -s tomorrow",
    "date --set=tomorrow",
    "date 010100002030",
    "diff --output=patch before after",
    "diff -o patch before after",
    "rg --pre cat pattern .",
    "rg --hostname-bin=touch pattern .",
    "sort -o output input",
    "sort --output=output input",
    "sort --compress-program=touch input",
    "uniq input output",
    "tree -o output",
  ])("denies read-like commands with write/execute arguments: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false });
  });

  test.each([
    "sh script",
    "bash -c ls",
    "env ls",
    "command rm file",
    "eval ls",
    "exec ls",
    "xargs rm",
    "node -e 'writeFileSync(\"x\",\"y\")'",
    "python -c 'open(\"x\",\"w\")'",
    "sudo ls",
    "kill 1",
    "systemctl restart service",
  ])("denies arbitrary execution and host mutation: %s", (command) => {
    expect(validateReadOnlyShell(command)).toMatchObject({ allowed: false, code: "arbitrary_execution" });
  });

  test("bounds adversarial input", () => {
    expect(validateReadOnlyShell(`cat ${"a".repeat(32 * 1024)}`)).toEqual({
      allowed: false,
      code: "command_too_long",
    });
    expect(validateReadOnlyShell("cat\0README")).toEqual({
      allowed: false,
      code: "invalid_shell_syntax",
    });
  });
});

describe("turn snapshot invariant", () => {
  test("copies mode, policy version, and trust fingerprint at turn start", () => {
    const mutable: { mode: "read_only" | "full"; version: string; fingerprint: string } = { ...readOnly };
    const snapshot = snapshotPolicyAtTurnStart(mutable);
    mutable.mode = "full";
    mutable.version = "changed";
    mutable.fingerprint = "changed";

    expect(snapshot).toEqual({
      ...readOnly,
      engineFingerprint: HOST_POLICY_MANIFEST.fingerprint,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(evaluateHostToolCall(snapshot, { toolName: "write" }).allowed).toBe(false);
  });

  test("engine policy changes apply to a later turn, never a running turn", () => {
    const engine = new HostPolicyEngine(readOnly);
    const firstTurn = engine.beginTurn();
    engine.setPolicy(full);

    expect(engine.evaluate(firstTurn, { toolName: "write" }).allowed).toBe(false);
    const secondTurn = engine.beginTurn();
    expect(secondTurn).toMatchObject(full);
    expect(engine.evaluate(secondTurn, { toolName: "write" }).allowed).toBe(true);
  });

  test("extension-style gate retains its turn snapshot across live policy changes", () => {
    let current = readOnly;
    const gate = createHostPolicyToolGate(() => current);
    const captured = gate.beginTurn();
    current = full;

    expect(gate.currentTurnPolicy()).toBe(captured);
    expect(gate.toolCall({ toolName: "edit" })).toMatchObject({ block: true });
    gate.endTurn();
    expect(gate.currentTurnPolicy()).toBeUndefined();
    expect(gate.beginTurn()).toMatchObject(full);
    expect(gate.toolCall({ toolName: "edit" })).toEqual({});
  });

  test("rejects incomplete or unsupported policy snapshots", () => {
    expect(() => snapshotPolicyAtTurnStart({ ...readOnly, version: "" })).toThrow(/version/);
    expect(() => snapshotPolicyAtTurnStart({ ...readOnly, fingerprint: "" })).toThrow(/fingerprint/);
    expect(() => snapshotPolicyAtTurnStart({ ...readOnly, mode: "other" as "full" })).toThrow(/mode/);
  });
});

describe("trust-bearing policy manifest", () => {
  test("is deterministic, versioned, fingerprinted, and capability-bearing", () => {
    const manifest = buildHostPolicyManifest();
    expect(manifest).toEqual(HOST_POLICY_MANIFEST);
    expect(manifest.policyVersion).toBe(HOST_POLICY_VERSION);
    expect(manifest.fingerprintAlgorithm).toBe(HOST_POLICY_FINGERPRINT_ALGORITHM);
    expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.capabilities).toBe(HOST_POLICY_CAPABILITIES);
    expect(manifest.capabilities).toContain("policy.turn_snapshot.v1");
    expect(manifest.capabilities).toContain("policy.read_only.default_deny_unknown.v1");
    expect(manifest.readOnly).toMatchObject({
      allowedTools: ["read", "grep", "find", "ls", "bash"],
      shellCommands: expect.arrayContaining(["cat", "find", "rg", "git"]),
      unknownTools: "deny",
      shellValidation: "conservative_lexical_allowlist",
    });
    expect(manifest.enforcement).toBe("host_tool_call_hook");
    expect(manifest.securityBoundary).toBe("tool_level_guardrail_not_os_sandbox");
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  test("fingerprint covers the trust-bearing manifest body", () => {
    const manifest = buildHostPolicyManifest();
    const { fingerprint, fingerprintAlgorithm, ...body } = manifest;
    expect(fingerprintAlgorithm).toBe("sha256");
    expect(createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex")).toBe(fingerprint);
  });
});
