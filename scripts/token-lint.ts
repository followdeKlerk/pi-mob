#!/usr/bin/env bun
/**
 * Design-token lint for the mobile UI surface (M16-06).
 *
 * Scans every Dart file under `apps/mobile/lib/src/ui/**` and fails CI when
 * an ad-hoc visual constant appears. The lint enforces that M16 visual work
 * flows through `PiSpacing` / `PiRadius` / `PiDuration` / `PiSemanticColors`
 * (or `Theme.of(context).colorScheme.*` for Material 3 roles).
 *
 * Detected categories:
 *
 *   1. Numeric padding on `EdgeInsets.all|symmetric|only|fromLTRB(...)`.
 *      `EdgeInsets.all(PiSpacing.lg)` is allowed; `EdgeInsets.all(8)` is not.
 *   2. Numeric radius on `BorderRadius.circular(N)`.
 *      `BorderRadius.circular(PiRadius.md)` is allowed; `BorderRadius.circular(8)`
 *      is not.
 *   3. Numeric `letterSpacing:` (excluding `0`, which legitimately means
 *      "no extra spacing").
 *   4. Hex color literals — `Color(0xAARRGGBB)` — outside the theme files.
 *
 * SizedBox sizing wrappers and `fontSize` literals are deliberately excluded
 * from the M16-06 baseline because they are layout/icon-typography concerns
 * rather than token-driven visual constants. They can be folded into a future
 * iteration once individual category policies are nailed down.
 *
 * Token-declaration files are intentionally allowlisted because they are
 * the single source of truth and must contain literal values:
 *
 *   - apps/mobile/lib/src/ui/theme/pi_theme.dart
 *   - apps/mobile/lib/src/ui/theme/pi_semantic_colors.dart
 *   - apps/mobile/lib/src/ui/theme/pi_tokens.dart
 *
 * To suppress an existing ad-hoc constant for transitional migration (rather
 * than fixing the value), add a `// pi-mob:token-legacy-allow` marker on the
 * line above. The lint still reports the line in `--report` mode so
 * reviewers can see the legacy status; here we drop it from the failure list.
 *
 * The script exits non-zero when any non-allowlisted offense is found.
 * Output is `file:line:column rule` followed by a snippet and a suggested
 * fix.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

interface Offense {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
  readonly snippet: string;
}

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly describe: (match: RegExpMatchArray) => string;
}

const RULES: readonly Rule[] = [
  {
    id: "padding-literal",
    // A digit anywhere between `EdgeInsets.{constructor}(` and the matching
    // `)` flags the call. Token-driven calls such as
    // `EdgeInsets.all(PiSpacing.lg)` are digit-free inside the parentheses
    // and therefore not matched. Compound arguments like
    // `EdgeInsets.fromLTRB(8, 8, 8, 12)` are detected correctly because at
    // least one argument carries a digit.
    pattern: /EdgeInsets\.(all|symmetric|only|fromLTRB)\s*\(([^()]*\d[^()]*)\)/g,
    describe: (m) =>
      `padding uses numeric literal \`${(m[2] ?? "").trim()}\` — reference PiSpacing instead`,
  },
  {
    id: "radius-literal",
    pattern: /BorderRadius\.circular\(\s*(?!PiRadius\.)(\d+(\.\d+)?)\s*\)/g,
    describe: (m) =>
      `corner radius uses numeric literal \`${m[1]}\` — reference PiRadius instead`,
  },
  {
    id: "letter-spacing-literal",
    pattern: /letterSpacing\s*:\s*([0-9]+(\.[0-9]+)?)/g,
    describe: (m) =>
      `letterSpacing literal \`${m[1]}\` — pass through the active text theme (the literal \`0\` is allowed for "no extra spacing")`,
  },
  {
    id: "hex-color-literal",
    pattern: /Color\(\s*0x[0-9A-Fa-f]{6,8}\s*\)/g,
    describe: () =>
      "raw hex Color — pull from PiSemanticColors or Theme.of(context).colorScheme",
  },
];

const TOKEN_DECL_ALLOWLIST = new Set([
  "apps/mobile/lib/src/ui/theme/pi_theme.dart",
  "apps/mobile/lib/src/ui/theme/pi_semantic_colors.dart",
  "apps/mobile/lib/src/ui/theme/pi_tokens.dart",
]);

const TREE = "apps/mobile/lib/src/ui";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".dart")) {
      out.push(full);
    }
  }
  return out;
}

function loadFile(path: string): string {
  return readFileSync(path, "utf8");
}

function isLegacyAllow(lines: readonly string[], lineIdx: number): boolean {
  if (lineIdx < 0 || lineIdx >= lines.length) return false;
  const current = lines[lineIdx];
  if (current === undefined) return false;
  if (current.includes("pi-mob:token-legacy-allow")) return true;
  if (lineIdx === 0) return false;
  const prev = lines[lineIdx - 1];
  if (prev === undefined) return false;
  return prev.includes("pi-mob:token-legacy-allow");
}

function lintFile(filePath: string): readonly Offense[] {
  const rel = relative(ROOT, filePath);
  if (TOKEN_DECL_ALLOWLIST.has(rel)) return [];
  const source = loadFile(filePath);
  const lines = source.split("\n");

  const offenses: Offense[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(source)) !== null) {
      const offset = match.index;
      const before = source.slice(0, offset);
      const lineNum = before.split("\n").length - 1;
      if (isLegacyAllow(lines, lineNum)) continue;
      if (rule.id === "letter-spacing-literal" && match[1] === "0") continue;
      const column = offset - before.lastIndexOf("\n");
      const currentLine = lines[lineNum] ?? "";
      const snippet = currentLine.trim();
      offenses.push({
        file: rel,
        line: lineNum + 1,
        column,
        rule: rule.id,
        message: rule.describe(match),
        snippet,
      });
      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1;
      }
    }
  }
  return offenses;
}

function main(): number {
  const tree = join(ROOT, TREE);
  const files = walk(tree);
  if (files.length === 0) {
    process.stderr.write(
      `token-lint: no Dart files found under ${TREE}; refusing to pass silently\n`,
    );
    return 1;
  }
  const offenses: Offense[] = [];
  for (const file of files) {
    offenses.push(...lintFile(file));
  }

  if (offenses.length === 0) {
    process.stdout.write(
      `token-lint ok: scanned ${files.length} Dart file(s) under ${TREE}\n`,
    );
    return 0;
  }

  process.stdout.write(`token-lint: ${offenses.length} ad-hoc visual constant(s):\n`);
  for (const offense of offenses) {
    process.stdout.write(
      `  ${offense.file}:${offense.line}:${offense.column}  ${offense.rule}\n    ${offense.snippet}\n    ${offense.message}\n`,
    );
  }
  process.stdout.write(
    `\nfix: route these through PiSpacing / PiRadius / PiDuration / PiSemanticColors / Theme.of(context).colorScheme.*\n`,
  );
  process.stdout.write(
    `transitional escape hatch: append \`// pi-mob:token-legacy-allow\` to the line above\n`,
  );
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
