import { normalizeCommandCatalogue, type PublicCommand } from "./command-catalogue";

export type CatalogueAvailabilityState = "available" | "unavailable";

export interface CatalogueAvailability<T> {
  readonly state: CatalogueAvailabilityState;
  readonly reason?: string;
  readonly entries: readonly T[];
}

export interface ReportedToolEntry {
  readonly name: string;
  readonly description?: string;
  readonly unavailableReason?: string;
}

export interface ReportedMcpEntry {
  readonly name: string;
  readonly description?: string;
  readonly unavailableReason?: string;
}

export interface CommandCatalogueServiceResult {
  readonly commands: readonly PublicCommand[];
  readonly tools: CatalogueAvailability<ReportedToolEntry>;
  readonly mcp: CatalogueAvailability<ReportedMcpEntry>;
}

const DEFAULT_TOOLS_UNAVAILABLE = "Pi did not report tool availability in get_commands.";
const DEFAULT_MCP_UNAVAILABLE = "Pi did not report MCP availability in get_commands.";

export function normalizeReportedCommandCatalogue(raw: unknown): CommandCatalogueServiceResult {
  const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  return Object.freeze({
    commands: Object.freeze(normalizeCommandCatalogue(raw)),
    tools: normalizeAvailability(
      envelope,
      ["tools", "reportedTools"],
      DEFAULT_TOOLS_UNAVAILABLE,
    ),
    mcp: normalizeAvailability(
      envelope,
      ["mcp", "mcpServers", "reportedMcp", "reportedMcpServers"],
      DEFAULT_MCP_UNAVAILABLE,
    ),
  });
}

function normalizeAvailability(
  envelope: Record<string, unknown> | null,
  keys: readonly string[],
  fallbackReason: string,
): CatalogueAvailability<ReportedToolEntry | ReportedMcpEntry> {
  const reported = firstArray(envelope, keys);
  if (!reported) {
    return Object.freeze({
      state: "unavailable",
      reason: fallbackReason,
      entries: Object.freeze([]),
    });
  }
  return Object.freeze({
    state: "available",
    entries: Object.freeze(reported.map(normalizeReportedEntry)),
  });
}

function firstArray(
  envelope: Record<string, unknown> | null,
  keys: readonly string[],
): unknown[] | null {
  if (!envelope) return null;
  for (const key of keys) {
    if (Array.isArray(envelope[key])) return envelope[key] as unknown[];
  }
  return null;
}

function normalizeReportedEntry(value: unknown): ReportedToolEntry {
  if (!value || typeof value !== "object") return Object.freeze({ name: "unknown" });
  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "unknown";
  const description = typeof item.description === "string" && item.description.trim()
    ? item.description.trim().slice(0, 300)
    : undefined;
  const unavailableReason = typeof item.unavailableReason === "string" && item.unavailableReason.trim()
    ? item.unavailableReason.trim().slice(0, 300)
    : typeof item.status === "string" && item.status === "unavailable" && typeof item.reason === "string" && item.reason.trim()
      ? item.reason.trim().slice(0, 300)
      : undefined;
  return Object.freeze({
    name,
    ...(description ? { description } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
  });
}
