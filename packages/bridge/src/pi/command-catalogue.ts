export type CommandCategory = "skill" | "template" | "extension";
export interface PublicCommand { readonly name: string; readonly description?: string; readonly category: CommandCategory; readonly requiresInput: boolean; }

const TUI_ONLY = new Set([
  "new", "resume", "tree", "fork", "clone", "name", "logout", "quit",
  "share", "copy", "hotkeys", "changelog", "settings", "trust", "login",
  "import", "export", "model", "thinking", "compact", "retry",
]);
const NAME = /^[a-z0-9][a-z0-9:_-]{0,63}$/i;

export function normalizeCommandCatalogue(raw: unknown): PublicCommand[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).commands)
      ? (raw as { commands: unknown[] }).commands
      : [];
  const seen = new Set<string>();
  const result: PublicCommand[] = [];
  for (const value of source) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.replace(/^\//, "").trim() : "";
    if (!NAME.test(name) || TUI_ONLY.has(name.toLowerCase())) continue;
    const rawSource = item.source;
    const category: CommandCategory = rawSource === "skill" ? "skill" : rawSource === "prompt" ? "template" : "extension";
    const key = `${category}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({
      name,
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim().slice(0, 300) } : {}),
      category,
      requiresInput: item.requiresInput === true || /<[^>]+>|\[[^\]]+\]/.test(typeof item.description === "string" ? item.description : ""),
    }));
    if (result.length >= 200) break;
  }
  return result;
}

export function searchCommandCatalogue(items: readonly PublicCommand[], query: string): PublicCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.slice(0, 80);
  return items.filter((item) => `${item.name}\n${item.description ?? ""}\n${item.category}`.toLowerCase().includes(needle)).slice(0, 80);
}

export function commandPrompt(command: PublicCommand, input = ""): string {
  const suffix = input.trim();
  return `/${command.name}${suffix ? ` ${suffix}` : ""}`;
}

export function isTuiOnlyCommand(name: string): boolean { return TUI_ONLY.has(name.replace(/^\//, "").toLowerCase()); }
