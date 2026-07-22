declare module "@earendil-works/pi-ai" {
  export function createAssistantMessageEventStream(): {
    push(event: unknown): void;
    end(): void;
  };
}
