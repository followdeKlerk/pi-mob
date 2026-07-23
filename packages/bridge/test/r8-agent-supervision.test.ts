import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { AgentSupervisionService } from "../src/core/agent-supervision-service";

const sessionId = "22222222-2222-4222-8222-222222222222";

describe("R8 agent supervision service", () => {
  test("publishes bounded snapshot, advances revision, and exposes capabilities", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "agent-")), "bridge.sqlite"));
    const service = new AgentSupervisionService(store);
    const snapshot = service.publish(sessionId, {
      revision: "ignored",
      items: [
        {
          agentId: "agent-fixture",
          task: "fixture task",
          state: "running",
          originSessionId: sessionId,
          originTurnId: "turn-1",
          revision: "ignored",
          supportedActions: ["transcript", "steer"],
        },
      ],
    });
    expect(snapshot.revision).toBe("1");
    expect(snapshot.items[0]!.revision).toBe("1");
    expect(snapshot.items[0]!.supportedActions).toEqual(["transcript", "steer"]);
    const second = service.publish(sessionId, { revision: "x", items: [] });
    expect(second.revision).toBe("2");
    store.close();
  });

  test("publishes explicit unavailable envelope for missing host supervision", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "agent-")), "bridge.sqlite"));
    const service = new AgentSupervisionService(store);
    const unavailable = service.publishUnavailable("Host missing", "Refresh capability");
    expect(unavailable.capability).toBe("agents.v1");
    expect(unavailable.status.state).toBe("unavailable");
    expect(unavailable.status.reason).toBe("Host missing");
    store.close();
  });

  test("clamps oversize task, latest activity, and completion summary to canonical caps", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "agent-")), "bridge.sqlite"));
    const service = new AgentSupervisionService(store);
    const snapshot = service.publish(sessionId, {
      revision: "ignored",
      items: [
        {
          agentId: "agent-x",
          task: "t".repeat(2000),
          state: "completed",
          originSessionId: sessionId,
          originTurnId: "turn-1",
          revision: "ignored",
          supportedActions: ["transcript"],
          latestActivity: "x".repeat(2000),
          completionSummary: "y".repeat(2000),
        },
      ],
    });
    expect(snapshot.items[0]!.task.length).toBe(512);
    expect(snapshot.items[0]!.latestActivity?.length).toBe(1024);
    expect(snapshot.items[0]!.completionSummary?.length).toBe(1024);
    store.close();
  });

  test("drops items beyond the canonical 64-item bound", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "agent-")), "bridge.sqlite"));
    const service = new AgentSupervisionService(store);
    const items = Array.from({ length: 80 }, (_, i) => ({
      agentId: `agent-${i}`,
      task: "fixture",
      state: "running" as const,
      originSessionId: sessionId,
      originTurnId: "turn-1",
      revision: "ignored",
      supportedActions: ["transcript" as const],
    }));
    const snapshot = service.publish(sessionId, { revision: "ignored", items });
    expect(snapshot.items).toHaveLength(64);
    store.close();
  });
});
