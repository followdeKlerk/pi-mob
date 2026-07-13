import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function readonlyProvider(pi: ExtensionAPI) {
  pi.registerProvider("pi-mob-readonly-fixture", {
    baseUrl: "http://127.0.0.1/unused", apiKey: "fixture", api: "pi-mob-readonly-fixture" as never,
    models: [{ id: "contract", name: "read-only contract", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
    streamSimple: ((model: any, context: any) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const hasResult = context.messages.some((message: any) => message.role === "toolResult");
        const output: any = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: hasResult ? "stop" : "toolUse", timestamp: Date.now() };
        stream.push({ type: "start", partial: output });
        if (hasResult) {
          output.content.push({ type: "text", text: "policy contract complete" });
          stream.push({ type: "text_start", contentIndex: 0, partial: output });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "policy contract complete", partial: output });
          stream.push({ type: "text_end", contentIndex: 0, content: "policy contract complete", partial: output });
        } else {
          const toolCall = { type: "toolCall" as const, id: "policy-write-1", name: "write", arguments: { path: "policy-output.txt", content: "mutation attempted\n" } };
          output.content.push(toolCall);
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
        }
        stream.push({ type: "done", reason: output.stopReason, message: output }); stream.end();
      });
      return stream;
    }) as never,
  });
}
