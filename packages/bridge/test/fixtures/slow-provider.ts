import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function slowProvider(pi: ExtensionAPI) {
  pi.registerProvider("pi-mob-slow", {
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "fixture",
    api: "pi-mob-slow" as never,
    models: [{
      id: "slow", name: "abort fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192, maxTokens: 128,
    }],
    streamSimple: ((model: any, _context: any, options: any) => {
      const stream = createAssistantMessageEventStream();
      const output: any = {
        role: "assistant", content: [], api: model.api, provider: model.provider,
        model: model.id, usage: { input: 1, output: 0, cacheRead: 0,
          cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0,
            cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: output });
      const timer = setTimeout(() => {
        try {
          output.content.push({ type: "text", text: "too late" });
          stream.push({ type: "text_start", contentIndex: 0, partial: output });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "too late", partial: output });
          stream.push({ type: "text_end", contentIndex: 0, content: "too late", partial: output });
          stream.push({ type: "done", reason: "stop", message: output });
          stream.end();
        } catch { /* aborted stream is already closed */ }
      }, 3000);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        output.stopReason = "aborted";
        output.errorMessage = "Request was aborted";
        try {
          stream.push({ type: "error", reason: "aborted", error: output });
          stream.end();
        } catch { /* already closed */ }
      }, { once: true });
      return stream;
    }) as never,
  });
}
