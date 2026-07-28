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

export interface AttentionPublishInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly category: AttentionCategory;
  readonly occurrence: string;
  readonly summary: string;
  readonly actionable: boolean;
}

export interface AttentionResolveInput {
  readonly sessionId: string;
  readonly attentionId: string;
  readonly expectedRevision: string;
}

const SUMMARY_CAP = 240;

export class AttentionProjection {
  private readonly revisions = new Map<string, number>();
  private readonly items = new Map<string, AttentionItem>();

  constructor(private readonly store: BridgeStore) {}

  publish(input: AttentionPublishInput): AttentionItem {
    const attentionId = crypto.randomUUID().toLowerCase();
    const revision = String((this.revisions.get(input.sessionId) ?? 0) + 1);
    this.revisions.set(input.sessionId, Number(revision));
    const item: AttentionItem = {
      attentionId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      category: input.category,
      occurrence: input.occurrence,
      summary: input.summary.slice(0, SUMMARY_CAP),
      actionable: input.actionable,
      revision,
      resolved: false,
      superseded: false,
    };
    this.ensureSession(input.sessionId);
    this.items.set(attentionId, item);
    this.store.appendEvent(`session:${input.sessionId}`, "attention.item", { ...item });
    return item;
  }

  resolve(input: AttentionResolveInput): AttentionItem {
    const current = this.items.get(input.attentionId);
    if (!current || current.sessionId !== input.sessionId) {
      throw new Error("attention item not found");
    }
    if (current.revision !== input.expectedRevision) {
      throw new Error("attention item is stale");
    }
    const revision = String((this.revisions.get(input.sessionId) ?? Number(current.revision)) + 1);
    this.revisions.set(input.sessionId, Number(revision));
    const resolved: AttentionItem = { ...current, revision, resolved: true };
    this.items.set(input.attentionId, resolved);
    this.store.appendEvent(`session:${input.sessionId}`, "attention.item", { ...resolved });
    return resolved;
  }

  get(attentionId: string): AttentionItem | undefined {
    return this.items.get(attentionId);
  }

  listForSession(sessionId: string): readonly AttentionItem[] {
    return [...this.items.values()].filter((item) => item.sessionId === sessionId);
  }

  private ensureSession(sessionId: string): void {
    this.store.ensureSession(sessionId, {});
    this.store.ensureStream(`session:${sessionId}`, "session", sessionId);
  }
}
