import { describe, expect, test } from "bun:test";
import type { AgentRecord, AgentSupervisionService } from "../src/agents/supervision-service";

class FakeAgents implements AgentSupervisionService {
  calls: string[] = [];
  async snapshot(): Promise<{ revision: string; items: readonly AgentRecord[] }> { return { revision: "rev-1", items: [{ agentId: "agent-1", task: "Check tests", state: "running" as const, startedAt: "2026-07-23T10:00:00.000Z", originSessionId: "11111111-1111-4111-8111-111111111111", originTurnId: "turn-1", supportedActions: ["transcript", "cancel"] as const, revision: "agent-rev-1" }] }; }
  async transcript() { return { agentId: "agent-1", items: [{ kind: "summary", text: "working" }] }; }
  async act(input: Parameters<AgentSupervisionService["act"]>[0]) { this.calls.push(input.type); return { outcome: "accepted" }; }
}

describe("R8 authoritative supervision service", () => {
  test("advertises only service-reported actions and preserves opaque worktree refs", async () => {
    const service = new FakeAgents();
    const snapshot = await service.snapshot();
    expect(snapshot.items[0]!.supportedActions).toEqual(["transcript", "cancel"]);
    expect(snapshot.items[0]!.worktreeRef).toBeUndefined();
    await service.act({ type: "agent.cancel", sessionId: snapshot.items[0]!.originSessionId, agentId: "agent-1", expectedRevision: "agent-rev-1" });
    expect(service.calls).toEqual(["agent.cancel"]);
  });
});
