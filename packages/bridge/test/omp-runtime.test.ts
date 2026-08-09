import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDaemon } from "../src/daemon";

describe("production OMP daemon wiring", () => {
  test("creates an OMP session and persists normalized live events", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-omp-runtime-"));
    const stateDir = join(root, "state");
    const sessionDir = join(root, "sessions");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    const executable = join(root, "omp-fixture.ts");
    writeFileSync(executable, `#!${process.execPath}
import { createInterface } from "node:readline";
process.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 3 }) + "\\n");
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    process.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true, data: { sessionId: "omp-fixture-session" } }) + "\\n");
  } else if (request.type === "prompt") {
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "message_update", delta: "fixture response" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_end" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true, data: { sessionId: "omp-fixture-session" } }) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true, data: {} }) + "\\n");
  }
}
`, { mode: 0o700 });
    const daemon = await runDaemon({ workspace: root, ompExecutable: executable, stateDir, ompSessionDir: sessionDir });
    try {
      const hostStream = `host:${daemon.store.identity().hostId}`;
      await daemon.adapter.dispatch({
        commandId: crypto.randomUUID(), type: "session.create", scopeKey: "host", streamId: hostStream,
        semanticHash: "omp-session-create", payload: { workspaceId: daemon.workspace.workspaceId, name: "fixture" }, state: "accepted", dispatchCount: 1,
      });
      const sessionId = String(daemon.store.sessionStates().find((state) => typeof state.sessionId === "string")?.sessionId ?? "");
      expect(sessionId).not.toBe("");
      await daemon.adapter.dispatch({
        commandId: crypto.randomUUID(), type: "prompt.submit", scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}`,
        semanticHash: "omp-prompt", payload: { sessionId, message: "hello", deliveryMode: "immediate", attachmentIds: [] }, state: "accepted", dispatchCount: 1,
      });
      const events = daemon.canonicalSessionStore.readAfter(sessionId, 0);
      expect(events.some((event) => event.eventType === "assistant.content.replaced" && JSON.stringify(event.payload).includes("fixture response"))).toBe(true);
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("idle");
    } finally {
      await daemon.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
