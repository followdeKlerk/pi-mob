import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDaemon } from "../src/daemon";

const WORKSPACE = "workspace";

describe("production createSessionRpc lifecycle", () => {
  test("uses stable Pi identity across exit/restart and preserves a valid session path", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-owner-lifecycle-"));
    const workspace = join(root, WORKSPACE);
    const stateDir = join(root, "state");
    const sessionDir = join(root, "sessions");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    const argsLog = join(root, "args.log");
    const startsFile = join(root, "starts");
    const piScript = join(root, "fake-pi.ts");
    writeFileSync(piScript, `
      import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      const args = process.argv.slice(2);
      const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
      const sessionDir = value("--session-dir")!;
      const explicit = value("--session");
      const sessionId = value("--session-id");
      const stable = explicit ?? join(sessionDir, \`stable-\${sessionId}.jsonl\`);
      const startsPath = ${JSON.stringify(startsFile)};
      const count = existsSync(startsPath) ? Number(readFileSync(startsPath, "utf8")) + 1 : 1;
      writeFileSync(startsPath, String(count));
      appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args) + "\\n");
      const decoder = new TextDecoder(); let pending = "";
      const response = (id: string, data: Record<string, unknown> = {}) => process.stdout.write(JSON.stringify({ type: "response", id, success: true, data }) + "\\n");
      for await (const chunk of Bun.stdin.stream()) {
        pending += decoder.decode(chunk, { stream: true });
        while (pending.includes("\\n")) {
          const index = pending.indexOf("\\n");
          const line = pending.slice(0, index); pending = pending.slice(index + 1);
          if (!line) continue;
          const command = JSON.parse(line) as { id: string; type: string };
          if (command.type === "get_state") {
            if (!existsSync(stable)) writeFileSync(stable, JSON.stringify({ type: "session", id: sessionId ?? "stable" }) + "\\n");
            const candidate = count === 1 ? stable : join(sessionDir, "nonexistent-restart-candidate.jsonl");
            response(command.id, { sessionFile: candidate });
          } else if (command.type === "prompt") {
            if (!existsSync(stable)) writeFileSync(stable, JSON.stringify({ type: "session", id: sessionId ?? "stable" }) + "\\n");
            appendFileSync(stable, JSON.stringify({ type: "message", id: \`u-\${count}\`, parentId: null, message: { role: "user", content: [{ type: "text", text: "finish" }] } }) + "\\n");
            appendFileSync(stable, JSON.stringify({ type: "message", id: \`a-\${count}\`, parentId: \`u-\${count}\`, message: { role: "assistant", content: [{ type: "text", text: "done" }] } }) + "\\n");
            process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
            response(command.id);
            if (count === 1) setTimeout(() => process.exit(0), 10);
          } else response(command.id);
        }
      }
    `, { mode: 0o600 });
    const executable = join(root, "fake-pi");
    writeFileSync(executable, `#!/bin/sh\nexec ${Bun.which("bun")!} ${piScript} "$@"\n`, { mode: 0o755 });

    const daemon = await runDaemon({
      workspace,
      executable,
      stateDir,
      sessionDir,
      environment: { HOME: root, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      const create = daemon.runtime.commands.submit({
        commandId: "create-mobile-session",
        type: "session.create",
        payload: { workspaceId: WORKSPACE },
        scopeKey: `host:${daemon.store.identity().hostId}`,
        streamId: `host:${daemon.store.identity().hostId}`,
      });
      await create.completion;
      const session = daemon.store.sessionStates().find((item) => item.createdByCommandId === "create-mobile-session")!;
      const sessionId = String(session.sessionId);
      const stablePath = join(sessionDir, `stable-${sessionId}.jsonl`);
      expect(daemon.store.command("create-mobile-session")?.state).toBe("completed");
      expect(daemon.store.sessionState(sessionId)?.piSessionPath).toBe(stablePath);

      const firstPrompt = daemon.runtime.commands.submit({
        commandId: "first-prompt",
        type: "prompt.submit",
        payload: { sessionId, deliveryMode: "immediate", message: "finish", attachmentIds: [] },
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
      });
      await firstPrompt.completion;
      expect(daemon.store.command("first-prompt")?.state).toBe("completed");
      expect(existsSync(stablePath)).toBe(true);

      for (let attempt = 0; attempt < 100 && (!existsSync(startsFile) || Number(readFileSync(startsFile, "utf8")) < 2); attempt += 1) await Bun.sleep(20);
      expect(Number(readFileSync(startsFile, "utf8"))).toBeGreaterThanOrEqual(2);

      const activation = daemon.runtime.commands.submit({
        commandId: "reactivate-session",
        type: "session.activate",
        payload: { sessionId },
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
      });
      await activation.completion;
      expect(daemon.store.command("reactivate-session")?.state).toBe("completed");
      expect(daemon.store.sessionState(sessionId)?.piSessionPath).toBe(stablePath);

      const secondPrompt = daemon.runtime.commands.submit({
        commandId: "follow-up-after-restart",
        type: "prompt.submit",
        payload: { sessionId, deliveryMode: "immediate", message: "again", attachmentIds: [] },
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
      });
      await secondPrompt.completion;
      expect(daemon.store.command("follow-up-after-restart")?.state).toBe("completed");
      expect(daemon.store.listEvents(`session:${sessionId}`).some((event) => event.type === "turn.indeterminate")).toBe(false);

      const launches = readFileSync(argsLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(launches[0]).toContain("--session-id");
      expect(launches[0]).toContain(sessionId);
      expect(launches.filter((args) => args.includes("--session-id")).every((args) => args.includes(sessionId))).toBe(true);
      expect(launches.some((args) => args.includes("nonexistent-restart-candidate.jsonl"))).toBe(false);
    } finally {
      await daemon.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
