import { normalizeReportedCommandCatalogue } from "./catalogue-service";

export type CatalogueEntryKind =
  | "skill"
  | "template"
  | "extension"
  | "mcp_server"
  | "mcp_tool";

export interface CatalogueEntry {
  readonly entryId: string;
  readonly kind: CatalogueEntryKind;
  readonly name: string;
  readonly description?: string;
  readonly invocation?: string;
  readonly source: string;
  readonly availability: {
    readonly state: "available" | "unavailable";
    readonly reason?: string;
    readonly remediation?: string;
    readonly source?: string;
    readonly revision?: string;
  };
  readonly enabled: boolean;
  readonly canToggle: boolean;
  readonly reloadRequired: boolean;
  readonly revision: string;
}

export interface CatalogueSnapshot {
  readonly revision: string;
  readonly entries: readonly CatalogueEntry[];
}

export interface MobileCatalogueSource {
  read(): Promise<unknown>;
  setEnabled?(
    entryId: string,
    enabled: boolean,
    expectedRevision: string,
  ): Promise<{ revision: string; reloadRequired: boolean }>;
}

const MAX_ENTRIES = 512;

export class MobileCatalogueService {
  private revision = 0;

  constructor(private readonly source: MobileCatalogueSource) {}

  async snapshot(): Promise<CatalogueSnapshot> {
    const normalized = await this.source.read();
    const envelope = normalizeReportedCommandCatalogue(normalized);
    const revision = `catalogue-${++this.revision}`;
    const entries: CatalogueEntry[] = envelope.commands.map((command) =>
      this.commandEntry(command, revision),
    );
    for (const tool of envelope.tools.entries) {
      entries.push(this.reportedEntry("mcp_tool", tool.name, tool.description, tool.unavailableReason, revision));
    }
    for (const server of envelope.mcp.entries) {
      entries.push(this.reportedEntry("mcp_server", server.name, server.description, server.unavailableReason, revision));
    }
    if (envelope.tools.state === "unavailable") {
      entries.push(this.unavailableEntry("mcp_tool", "Tools unavailable", envelope.tools.reason ?? "Tools unavailable", revision));
    }
    if (envelope.mcp.state === "unavailable") {
      entries.push(this.unavailableEntry("mcp_server", "MCP unavailable", envelope.mcp.reason ?? "MCP unavailable", revision));
    }
    return {
      revision,
      entries: entries.slice(0, MAX_ENTRIES),
    };
  }

  async setEnabled(
    entryId: string,
    enabled: boolean,
    expectedRevision: string,
  ): Promise<{ revision: string; reloadRequired: boolean }> {
    if (!this.source.setEnabled) {
      throw new Error("Catalogue toggles unavailable");
    }
    return this.source.setEnabled(entryId, enabled, expectedRevision);
  }

  private commandEntry(
    command: { readonly category: string; readonly name: string; readonly description?: string },
    revision: string,
  ): CatalogueEntry {
    return {
      entryId: `${command.category}:${command.name}`,
      kind: command.category as CatalogueEntryKind,
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      invocation: `/${command.name}`,
      source: "pi:get_commands",
      availability: { state: "available" },
      enabled: true,
      canToggle: false,
      reloadRequired: false,
      revision,
    };
  }

  private reportedEntry(
    kind: CatalogueEntryKind,
    name: string,
    description: string | undefined,
    unavailableReason: string | undefined,
    revision: string,
  ): CatalogueEntry {
    return {
      entryId: `${kind}:${name}`,
      kind,
      name,
      ...(description ? { description } : {}),
      source: "pi:get_commands",
      availability: unavailableReason
        ? {
            state: "unavailable",
            reason: unavailableReason,
            remediation: "Update the host configuration.",
            source: "pi:get_commands",
          }
        : { state: "available" },
      enabled: true,
      canToggle: false,
      reloadRequired: false,
      revision,
    };
  }

  private unavailableEntry(
    kind: CatalogueEntryKind,
    name: string,
    reason: string,
    revision: string,
  ): CatalogueEntry {
    return {
      entryId: `${kind}:unavailable`,
      kind,
      name,
      source: "pi:get_commands",
      availability: {
        state: "unavailable",
        reason,
        remediation: "Install an authoritative bridge provider.",
        source: "pi:get_commands",
      },
      enabled: false,
      canToggle: false,
      reloadRequired: false,
      revision,
    };
  }
}
