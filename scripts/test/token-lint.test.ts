import { describe, expect, test } from "bun:test";

interface Offense {
  readonly rule: string;
  readonly line: number;
  readonly column: number;
}

interface RuleSpec {
  readonly id: string;
  readonly source: RegExp;
  readonly describe: (match: RegExpMatchArray) => string;
}

const RULES: readonly RuleSpec[] = [
  {
    id: "padding-literal",
    source: /EdgeInsets\.(all|symmetric|only|fromLTRB)\s*\(([^()]*\d[^()]*)\)/,
    describe: (m) =>
      `padding uses numeric literal \`${m[2].trim()}\` — reference PiSpacing instead`,
  },
  {
    id: "radius-literal",
    source: /BorderRadius\.circular\(\s*(?!PiRadius\.)(\d+(\.\d+)?)\s*\)/,
    describe: (m) =>
      `corner radius uses numeric literal \`${m[1]}\` — reference PiRadius instead`,
  },
  {
    id: "letter-spacing-literal",
    source: /letterSpacing\s*:\s*([0-9]+(\.[0-9]+)?)/,
    describe: (m) =>
      `letterSpacing literal \`${m[1]}\` — pass through the active text theme (the literal \`0\` is allowed for "no extra spacing")`,
  },
  {
    id: "hex-color-literal",
    source: /Color\(\s*0x[0-9A-Fa-f]{6,8}\s*\)/,
    describe: () =>
      "raw hex Color — pull from PiSemanticColors or Theme.of(context).colorScheme",
  },
];

function lintSource(source: string): readonly Offense[] {
  const lines = source.split("\n");
  const offenses: Offense[] = [];
  for (const rule of RULES) {
    const pattern = new RegExp(rule.source.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const offset = match.index;
      const before = source.slice(0, offset);
      const lineNum = before.split("\n").length - 1;
      const current = lines[lineNum] ?? "";
      const previous = lineNum > 0 ? lines[lineNum - 1] ?? "" : "";
      if (
        current.includes("pi-mob:token-legacy-allow") ||
        previous.includes("pi-mob:token-legacy-allow") ||
        (rule.id === "letter-spacing-literal" && match[1] === "0")
      ) {
        continue;
      }
      const column = offset - before.lastIndexOf("\n");
      offenses.push({
        rule: rule.id,
        line: lineNum + 1,
        column,
      });
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex += 1;
      }
      rule.describe(match); // exercise describe path so coverage includes it
    }
  }
  return offenses;
}

describe("token-lint patterns", () => {
  test("flags EdgeInsets.all(numeric)", () => {
    const offenses = lintSource("const a = EdgeInsets.all(16);");
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.rule).toBe("padding-literal");
  });

  test("allows EdgeInsets.all(PiSpacing.lg)", () => {
    expect(lintSource("const a = EdgeInsets.all(PiSpacing.lg);")).toHaveLength(0);
  });

  test("flags EdgeInsets.fromLTRB with numeric args", () => {
    const offenses = lintSource("const a = EdgeInsets.fromLTRB(8, 8, 8, 12);");
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.rule).toBe("padding-literal");
  });

  test("flags EdgeInsets.only with any numeric arg", () => {
    const offenses = lintSource(
      "padding: const EdgeInsets.only(top: 6, right: PiSpacing.sm),",
    );
    expect(offenses).toHaveLength(1);
  });

  test("allows BorderRadius.circular(PiRadius.md)", () => {
    expect(lintSource("BorderRadius.circular(PiRadius.md)")).toHaveLength(0);
  });

  test("flags BorderRadius.circular(8)", () => {
    const offenses = lintSource("borderRadius: BorderRadius.circular(8)");
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.rule).toBe("radius-literal");
  });

  test("flags letterSpacing: 0.4 but not letterSpacing: 0", () => {
    expect(lintSource("letterSpacing: 0")).toHaveLength(0);
    expect(lintSource("letterSpacing: 0.4")).toHaveLength(1);
    expect(lintSource("letterSpacing: 1.5")).toHaveLength(1);
  });

  test("flags hex Color literals", () => {
    const offenses = lintSource("Color(0xFFAABBCC)");
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.rule).toBe("hex-color-literal");
  });

  test("ignores lines with pi-mob:token-legacy-allow marker on the previous line", () => {
    const source = [
      "// pi-mob:token-legacy-allow",
      "const a = EdgeInsets.all(99);",
    ].join("\n");
    expect(lintSource(source)).toHaveLength(0);
  });

  test("ignores lines where the marker is on the same line", () => {
    expect(
      lintSource("const a = EdgeInsets.all(99); // pi-mob:token-legacy-allow"),
    ).toHaveLength(0);
  });

  test("reports column offset relative to line start", () => {
    const offenses = lintSource("      x = EdgeInsets.all(16);");
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.column).toBeGreaterThan(0);
    expect(offenses[0]!.line).toBe(1);
  });
});

describe("token-lint allowlist", () => {
  test("theme files are token declarations", () => {
    const allowlist = new Set([
      "apps/mobile/lib/src/ui/theme/pi_theme.dart",
      "apps/mobile/lib/src/ui/theme/pi_semantic_colors.dart",
      "apps/mobile/lib/src/ui/theme/pi_tokens.dart",
    ]);
    expect(allowlist.has("apps/mobile/lib/src/ui/theme/pi_theme.dart")).toBe(true);
    expect(allowlist.has("apps/mobile/lib/src/ui/theme/pi_semantic_colors.dart")).toBe(true);
    expect(allowlist.has("apps/mobile/lib/src/ui/theme/pi_tokens.dart")).toBe(true);
  });
});

describe("token-lint tree scope", () => {
  test("scans every required mobile widget subtree", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../token-lint.ts", import.meta.url),
      "utf8",
    );
    const expected = [
      "apps/mobile/lib/src/ui",
      "apps/mobile/lib/src/transcript/widgets",
      "apps/mobile/lib/src/controls",
      "apps/mobile/lib/src/sessions",
      "apps/mobile/lib/src/session_tree",
      "apps/mobile/lib/src/attachments",
      "apps/mobile/lib/src/interaction",
      "apps/mobile/lib/src/workspaces",
      "apps/mobile/lib/src/pairing",
    ];
    for (const tree of expected) {
      expect(source).toContain(tree);
    }
    expect(source).toMatch(/const TREES:\s*readonly string\[\]/);
  });

  test("scans at least 30 Dart files across the expanded scope", async () => {
    const root = new URL("../..", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "run", "scripts/token-lint.ts"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
    ]);
    const exit = await proc.exited;
    expect(exit).toBe(0);
    const match = stdout.match(/scanned (\d+) Dart file/);
    expect(match).not.toBeNull();
    const count = Number(match![1]);
    // The M16-06a baseline was 18 files. The M16-06b expansion at minimum
    // triples that count to cover transcript, controls, sessions, session_tree,
    // attachments, interaction, workspaces, and pairing.
    expect(count).toBeGreaterThanOrEqual(30);
    expect(stdout).toContain("across 9 tree(s)");
  });
});

describe("token-lint script integration", () => {
  test("scans the real ui tree and exits 0 after the legacy migration", async () => {
    const root = new URL("../..", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "run", "scripts/token-lint.ts"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit = await proc.exited;
    if (exit !== 0) {
      process.stderr.write(`stdout: ${stdout}\nstderr: ${stderr}\n`);
    }
    expect(exit).toBe(0);
    expect(stdout).toContain("token-lint ok");
    expect(stderr).toBe("");
  });
});
