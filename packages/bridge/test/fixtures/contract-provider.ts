import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function contractProvider(pi: ExtensionAPI) {
  if (process.env.PI_MOB_CANCEL_LIFECYCLE === "1") {
    pi.on("session_before_switch", async () => ({ cancel: true }));
    pi.on("session_before_fork", async () => ({ cancel: true }));
  }
  pi.registerProvider("pi-mob-fixture", {
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "fixture",
    api: "pi-mob-fixture" as never,
    models: [{
      id: "contract", name: "pi-mob contract fixture", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192, maxTokens: 1024,
    }],
    streamSimple: ((model: any, context: any) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const hasToolResult = context.messages.some((message: any) => message.role === "toolResult");
        const output: any = {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: hasToolResult ? "stop" : "toolUse", timestamp: Date.now(),
        };
        stream.push({ type: "start", partial: output });
        if (hasToolResult) {
          output.content.push({ type: "text", text: "contract complete" });
          stream.push({ type: "text_start", contentIndex: 0, partial: output });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "contract complete", partial: output });
          stream.push({ type: "text_end", contentIndex: 0, content: "contract complete", partial: output });
        } else {
          const toolCall = { type: "toolCall" as const, id: "contract-read-1", name: "read", arguments: { path: "contract-input.txt" } };
          output.content.push(toolCall);
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
        }
        stream.push({ type: "done", reason: output.stopReason, message: output });
        stream.end();
      });
      return stream;
    }) as never,
  });
}
