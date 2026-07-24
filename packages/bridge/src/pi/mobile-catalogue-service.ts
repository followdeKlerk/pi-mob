import { normalizeReportedCommandCatalogue } from "./catalogue-service";

export interface MobileCatalogueSource {
  read(): Promise<unknown>;
  setEnabled?(entryId: string, enabled: boolean, expectedRevision: string): Promise<{ revision: string; reloadRequired: boolean }>;
}

export class MobileCatalogueService {
  private revision = 0;
  constructor(private readonly source: MobileCatalogueSource) {}

  async snapshot(): Promise<Record<string, unknown>> {
    const normalized = normalizeReportedCommandCatalogue(await this.source.read());
    const revision = `catalogue-${++this.revision}`;
    const entries: Record<string, unknown>[] = normalized.commands.map((command) => ({
      entryId: `${command.category}:${command.name}`,
      kind: command.category,
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      invocation: `/${command.name}`,
      source: "pi:get_commands",
      availability: { state: "available" },
      enabled: true,
      canToggle: false,
      reloadRequired: false,
      revision,
    }));
    for (const tool of normalized.tools.entries) entries.push(this.reported("mcp_tool", tool.name, tool.description, tool.unavailableReason, revision));
    for (const server of normalized.mcp.entries) entries.push(this.reported("mcp_server", server.name, server.description, server.unavailableReason, revision));
    if (normalized.tools.state === "unavailable") entries.push(this.unavailable("mcp_tool", "Tools unavailable", normalized.tools.reason ?? "Tools unavailable", revision));
    if (normalized.mcp.state === "unavailable") entries.push(this.unavailable("mcp_server", "MCP unavailable", normalized.mcp.reason ?? "MCP unavailable", revision));
    return { revision, entries: entries.slice(0, 512) };
  }

  async setEnabled(entryId: string, enabled: boolean, expectedRevision: string): Promise<Record<string, unknown>> {
    if (!this.source.setEnabled) throw new Error("Catalogue toggles unavailable");
    return this.source.setEnabled(entryId, enabled, expectedRevision);
  }

  private reported(kind: string, name: string, description: string | undefined, unavailableReason: string | undefined, revision: string): Record<string, unknown> {
    return { entryId: `${kind}:${name}`, kind, name, ...(description ? { description } : {}), source: "pi:get_commands", availability: unavailableReason ? { state: "unavailable", reason: unavailableReason, remediation: "Update the host configuration.", source: "pi:get_commands" } : { state: "available" }, canToggle: false, reloadRequired: false, revision };
  }
  private unavailable(kind: string, name: string, reason: string, revision: string): Record<string, unknown> {
    return { entryId: `${kind}:unavailable`, kind, name, source: "pi:get_commands", availability: { state: "unavailable", reason, remediation: "Install an authoritative bridge provider.", source: "pi:get_commands" }, canToggle: false, reloadRequired: false, revision };
  }
}
