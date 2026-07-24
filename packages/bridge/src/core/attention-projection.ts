import type { BridgeStore } from "./store";

export type AttentionCategory =
  | "needs_input"
  | "completed"
  | "failed"
  | "interrupted"
  | "background";

export interface AttentionItem {
  readonly attentionId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly category: AttentionCategory;
  readonly occurrence: string;
  readonly summary: string;
  readonly actionable: boolean;
  readonly revision: string;
  readonly resolved: boolean;
  readonly superseded: boolean;
}

const SUMMARY_CAP = 240;

export class AttentionProjection {
  private readonly revisions = new Map<string, number>();
  private readonly items = new Map<string, AttentionItem>();

  constructor(private readonly store: BridgeStore) {}

  publish(input: Omit<AttentionItem, "attentionId" | "revision" | "resolved" | "superseded">): AttentionItem {
    const attentionId = crypto.randomUUID().toLowerCase();
    const revision = String((this.revisions.get(input.sessionId) ?? 0) + 1);
    this.revisions.set(input.sessionId, Number(revision));
    const item: AttentionItem = {
      ...input,
      attentionId,
      summary: input.summary.slice(0, SUMMARY_CAP),
      revision,
      resolved: false,
      superseded: false,
    };
    this.ensureSession(input.sessionId);
    this.items.set(attentionId, item);
    this.store.appendEvent(`session:${input.sessionId}`, "attention.item", { ...item });
    return item;
  }

  resolve(sessionId: string, attentionId: string, expectedRevision: string): AttentionItem {
    const current = this.items.get(attentionId);
    if (!current || current.sessionId !== sessionId) throw new Error("attention item not found");
    if (current.revision !== expectedRevision) throw new Error("attention item is stale");
    const revision = String((this.revisions.get(sessionId) ?? Number(current.revision)) + 1);
    this.revisions.set(sessionId, Number(revision));
    const resolved = { ...current, revision, resolved: true };
    this.items.set(attentionId, resolved);
    this.store.appendEvent(`session:${sessionId}`, "attention.item", { ...resolved });
    return resolved;
  }

  private ensureSession(sessionId: string): void {
    this.store.ensureSession(sessionId, {});
    this.store.ensureStream(`session:${sessionId}`, "session", sessionId);
  }
}
