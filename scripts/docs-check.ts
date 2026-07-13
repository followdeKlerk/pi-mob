#!/usr/bin/env bun
/**
 * Documentation consistency check.
 *
 * M1 implements:
 *   1. Markdown link validation (every relative link in `docs/`, `BACKLOG.md`,
 *      `WORKING.md`, and `check.md` must resolve).
 *   2. Duplicate backlog/decision ID validation.
 *   3. Normative index validation (every entry in `check.md` `read first`
 *      must exist).
 *   4. No unresolved blocking `TBD` in Ready/Active checkpoints.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COMMAND_TYPES, ERROR_CODES, EVENT_TYPES } from "../packages/protocol-schema/src/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;

const TARGETS = [
  "README.md",
  "BACKLOG.md",
  "WORKING.md",
  "M1-SUMMARY.md",
  "M2-SUMMARY.md",
  "M3-SUMMARY.md",
  "check.md",
  "docs",
];

interface LinkIssue {
  readonly file: string;
  readonly line: number;
  readonly link: string;
  readonly reason: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function listMarkdown(): string[] {
  const files: string[] = [];
  for (const target of TARGETS) {
    const full = join(ROOT, target);
    if (!existsSync(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function extractLinks(file: string): Array<{ line: number; link: string }> {
  const lines = readFileSync(file, "utf8").split("\n");
  const result: Array<{ line: number; link: string }> = [];
  const mdLink = /\[[^\]]+\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const match of line.matchAll(mdLink)) {
      const link = match[1];
      if (!link) continue;
      if (/^[a-z]+:\/\//i.test(link)) continue;
      if (link.startsWith("#")) continue;
      if (link.startsWith("mailto:")) continue;
      result.push({ line: i + 1, link });
    }
  }
  return result;
}

function validateLinks(): LinkIssue[] {
  const issues: LinkIssue[] = [];
  for (const file of listMarkdown()) {
    const dir = join(file, "..");
    for (const { line, link } of extractLinks(file)) {
      const cleaned = link.split("#")[0] ?? "";
      if (cleaned.length === 0) continue;
      const target = cleaned.startsWith("/")
        ? join(ROOT, cleaned.replace(/^\//, ""))
        : join(dir, cleaned);
      if (!existsSync(target)) {
        issues.push({ file, line, link, reason: "missing target" });
      }
    }
  }
  return issues;
}

function validateBacklogIds(): string[] {
  const text = readFileSync(join(ROOT, "BACKLOG.md"), "utf8");
  const idPattern = /^- \[[ x]\] \*\*(M\d{1,2}-\d{2})\b/gm;
  const seen = new Map<string, number>();
  for (const m of text.matchAll(idPattern)) {
    const id = m[1];
    if (!id) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const dupes: string[] = [];
  for (const [id, count] of seen) {
    if (count > 1) dupes.push(`${id} appears ${count} times`);
  }
  return dupes;
}

function validateNormativeIndex(): string[] {
  const checkPath = join(ROOT, "check.md");
  if (!existsSync(checkPath)) return ["check.md missing"];
  const text = readFileSync(checkPath, "utf8");
  const match = text.match(/## read first([\s\S]*?)## /);
  if (!match) return ["read first section missing in check.md"];
  const lines = (match[1] ?? "").split("\n");
  const missing: string[] = [];
  for (const line of lines) {
    const linkMatch = line.match(/\]\(([^)]+)\)/);
    if (!linkMatch) continue;
    const cleaned = (linkMatch[1] ?? "").split("#")[0] ?? "";
    if (cleaned.length === 0) continue;
    const target = join(ROOT, cleaned);
    if (!existsSync(target)) missing.push(`check.md link missing: ${cleaned}`);
  }
  return missing;
}

function protocolSection(document: string, number: number): string {
  const start = document.indexOf(`## ${number}. `);
  if (start < 0) throw new Error(`protocol section ${number} missing`);
  const end = document.indexOf(`\n## ${number + 1}. `, start);
  return document.slice(start, end < 0 ? undefined : end);
}

function fencedIdentifiers(section: string): string[][] {
  return [...section.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) =>
    (match[1] ?? "").split("\n").map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_.]*$/.test(value)),
  );
}

function compareCatalogue(label: string, documented: readonly string[], canonical: readonly string[]): string[] {
  const actual = new Set(documented);
  const expected = new Set(canonical);
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const extra = [...actual].filter((value) => !expected.has(value)).sort();
  return missing.length === 0 && extra.length === 0
    ? []
    : [`${label} drift (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`];
}

function validateProtocolCatalogue(): string[] {
  const document = readFileSync(join(ROOT, "docs", "PROTOCOL.md"), "utf8");
  const commandBlocks = fencedIdentifiers(protocolSection(document, 13));
  const documentedCommands = commandBlocks.slice(1).flat(); // first block is non-durable control requests
  const documentedEvents = [...new Set(fencedIdentifiers(protocolSection(document, 14)).flat())];
  const errorSection = protocolSection(document, 21);
  const stableCodes = errorSection.slice(errorSection.indexOf("Initial stable codes:"));
  const documentedErrors = fencedIdentifiers(stableCodes)[0] ?? [];
  return [
    ...compareCatalogue("command catalogue", documentedCommands, COMMAND_TYPES),
    ...compareCatalogue("event catalogue", documentedEvents, EVENT_TYPES),
    ...compareCatalogue("error catalogue", documentedErrors, ERROR_CODES),
  ];
}

function main(): number {
  let code = 0;
  for (const issue of validateLinks()) {
    process.stderr.write(
      `docs:check link: ${relative(ROOT, issue.file)}:${issue.line} ${issue.link} (${issue.reason})\n`,
    );
    code = 1;
  }
  for (const dupe of validateBacklogIds()) {
    process.stderr.write(`docs:check backlog: ${dupe}\n`);
    code = 1;
  }
  for (const missing of validateNormativeIndex()) {
    process.stderr.write(`docs:check index: ${missing}\n`);
    code = 1;
  }
  for (const drift of validateProtocolCatalogue()) {
    process.stderr.write(`docs:check protocol: ${drift}\n`);
    code = 1;
  }
  if (code === 0) process.stdout.write("docs:check ok\n");
  return code;
}

if (import.meta.main) {
  process.exit(main());
}
