#!/usr/bin/env bun
/**
 * Phase 1 doc/source honesty gate.
 *
 * Fails the build when public documentation or production source still
 * claims capabilities that the normal daemon does not construct. The
 * patterns below are the exact overclaims listed in the Phase 0 audit
 * (`/tmp/pi-mob-phase0-audit.md`). Each rule is a focused regex test
 * scoped to a specific file so the failure message points at the line
 * that must change.
 *
 * Layered model:
 *   1. Catalogue must not be advertised as production-wired anywhere.
 *   2. The released bridge target is macOS x64 — no Linux/systemd,
 *      no release-time "QR on first start", no "QR JSON on first start".
 *   3. Privacy must not echo the message body (FCM body defaults to
 *      "Turn finished" / "Turn failed"); the protocol must not claim
 *      uploads are never proxied.
 *   4. The catalogue UI path must be dead: no `OpenCommandsIntent`,
 *      `_openCommands`, `_openCommandsAction`, or related callback in
 *      `app_shell.dart`.
 *   5. `REMAINING_UX_PLAN.md` references must be removed from any
 *      agreed Phase 1 file (the file does not exist on disk).
 *
 * The pure checker `checkPhase1DocHonesty` is exported so the Bun
 * test harness can exercise the failure path with synthetic offending
 * fixtures. The executable `main()` reads the real working tree and
 * delegates to the same checker.
 *
 * Run via `bun run scripts/phase1-doc-check.ts`. Wired into
 * `scripts/all.ts` so it runs as part of the regular CI sequence.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

export interface Phase1FileInput {
  readonly files: Readonly<Record<string, string>>;
}

export interface Phase1Failure {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
}

export interface Phase1Result {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<Phase1Failure>;
}

interface Rule {
  readonly id: string;
  readonly description: string;
  readonly files: ReadonlyArray<string>;
  readonly pattern: RegExp;
}

const APP_SHELL = "apps/mobile/lib/src/ui/shell/app_shell.dart";

const RULES: ReadonlyArray<Rule> = [
  {
    id: "catalogue-not-production-wired",
    description:
      "Catalogue authority must not be advertised as production-wired in any public document.",
    files: [
      "README.md",
      "docs/PROJECT_STATUS.md",
      "docs/CHANGELOG.md",
      "docs/RELEASE.md",
      "apps/mobile/README.md",
      "packages/bridge/README.md",
    ],
    pattern: /catalogue authority/i,
  },
  {
    id: "no-linux-systemd-released",
    description:
      "Released bridge is macOS x64 only; docs must not promise systemd or Linux support.",
    files: ["README.md", "docs/ARCHITECTURE.md", "docs/QUICKSTART.md"],
    pattern: /\bsystemd\b|\bLinux (host|install|runner|on)\b/i,
  },
  {
    id: "no-qr-on-first-start",
    description:
      "Pairing QR is produced by the public CLI, not by the daemon on every first start.",
    files: [
      "README.md",
      "docs/QUICKSTART.md",
      "packages/bridge/README.md",
    ],
    pattern: /QR (code|payload) (on|at) (first|the first) start/i,
  },
  {
    id: "no-privacy-message-body",
    description:
      "PRIVACY.md must not claim the FCM notification body is the chat reply; the bridge sends only status copy.",
    files: ["docs/PRIVACY.md"],
    pattern: /message body|reply text|assistant.{0,40}reply|message that the bridge already produced for the chat UI/i,
  },
  {
    id: "no-uploads-never-proxied",
    description:
      "PROTOCOL.md must not claim the bridge never proxies uploads when the binary HTTP API on /v1/attachments is real.",
    files: ["docs/PROTOCOL.md", "packages/bridge/README.md"],
    pattern: /never prox(y|ies|ied).{0,40}bridge|file uploads (and|are) (not|never) part of the product transport/i,
  },
  {
    id: "no-bounded-authenticated-endpoint",
    description:
      "The companion HTTP endpoints are not application-layer authenticated today; do not call them authenticated.",
    files: [
      "packages/bridge/README.md",
      "docs/PROTOCOL.md",
      "docs/ARCHITECTURE.md",
      "docs/PRIVACY.md",
      "docs/PROJECT_STATUS.md",
      "README.md",
    ],
    pattern: /bounded authenticated endpoint|authenticate(s|d)? by `installationId`|authorize(s|d)? by `installationId`/i,
  },
  {
    id: "no-relay-and-tailscale",
    description:
      "Tailscale is the tailnet; the right words are tailnet + ACLs, not \"relay-and-tailscale ACLs\".",
    files: ["packages/bridge/README.md", "docs/ARCHITECTURE.md", "docs/PRIVACY.md", "README.md"],
    pattern: /relay-and-tailscale|relay and tailscale/i,
  },
  {
    id: "no-same-pair-of-devices-export",
    description:
      "Exports are not restricted to the pair of devices that registered for the session; the lookup is by UUID.",
    files: ["docs/PRIVACY.md"],
    pattern: /same pair of devices that registered for the session/i,
  },
  {
    id: "no-uninstall-removes-host-fcm",
    description:
      "Android uninstall does not reliably notify the bridge; do not promise remote FCM registration removal.",
    files: ["docs/PRIVACY.md"],
    pattern: /removes the FCM registration|removes every local cache row.*and the FCM registration|the host-side FCM registration is removed/i,
  },
  {
    id: "no-entire-outbound-traffic",
    description:
      "Privacy must narrowly disclose the bridge's outbound traffic; do not claim it covers everything the host emits.",
    files: ["docs/PRIVACY.md"],
    pattern: /that is the entire outbound traffic from the bridge/i,
  },
  {
    id: "no-fcm-public-internet-contradiction",
    description:
      "Privacy must not pair an FCM OAuth/message claim with a blanket \"does not connect to the public internet\" claim; the bridge does call Google for FCM.",
    files: ["docs/PRIVACY.md"],
    pattern: /does not connect to the public internet|does not initiate any outbound traffic to the public internet/i,
  },
  {
    id: "no-bridge-uninstall-claims-unconditional-state-removal",
    description:
      "The bridge uninstall command requires an explicit --mode flag; default retain_data preserves state. Docs must not claim \"removing the bridge removes every durable row\" without conditioning on the mode.",
    files: ["docs/PRIVACY.md"],
    pattern: /removing the bridge from your host machine removes every durable row|removes every durable row, the attachment store, and the export directory/i,
  },
  {
    id: "no-protecting-handshake",
    description:
      "The WebSocket handshake validates protocol version and UUID syntax but does not authenticate. Do not claim the device is registered \"behind the same handshake that protects the rest of the API\".",
    files: ["docs/PRIVACY.md"],
    pattern: /behind the same handshake that protects the rest of the API/i,
  },
  {
    id: "no-never-display-twice",
    description:
      "Android deduplication of FCM re-deliveries relies on the PendingIntent request code derived from notificationId/hashCode; it is not deterministically proven on a real device. Do not claim re-deliveries \"never display twice\".",
    files: ["docs/PRIVACY.md"],
    pattern: /never display twice|so re-deliveries never display/i,
  },
  {
    id: "no-binds-before-history",
    description:
      "The bridge runtime calls commands.recover() and reconciles bulk external history BEFORE Bun.serve() binds the loopback listener. The listener is bound after recovery; the docs must reflect this.",
    files: [
      "packages/bridge/README.md",
      "docs/ARCHITECTURE.md",
      "docs/QUICKSTART.md",
      "README.md",
    ],
    pattern: /binds the loopback listener before any bulk external history synchronization|binds the loopback listener before any bulk external history reconciliation/i,
  },
];

const APP_SHELL_RULES: ReadonlyArray<Rule> = [
  {
    id: "app-shell-no-open-commands-intent",
    description: "The dead catalogue/catalogue-sheet intent must be removed.",
    files: [APP_SHELL],
    pattern: /OpenCommandsIntent/,
  },
  {
    id: "app-shell-no-open-commands-helper",
    description: "The dead `_openCommands` helper and its `_openCommandsAction` wrapper must be removed.",
    files: [APP_SHELL],
    pattern: /_openCommands(Action)?\b/,
  },
  {
    id: "app-shell-no-callbackaction-open-commands",
    description: "No `CallbackAction<OpenCommandsIntent>` callback can remain in app_shell.dart.",
    files: [APP_SHELL],
    pattern: /CallbackAction<OpenCommandsIntent>/,
  },
  {
    id: "app-shell-no-show-commands-sheet",
    description: "No residual sheet that would surface a commands/catalogue list must remain.",
    files: [APP_SHELL],
    pattern: /showModalBottomSheet<void>[^;]*commands|SupportedCommandList|CatalogueUnavailableNotice/,
  },
];

/**
 * Phase 1 scope for the REMAINING_UX_PLAN sweep. The agreed Phase 1 files
 * are limited to `app_shell.dart` and the keyboard-shortcut test that
 * is directly affected by the catalogue-intent removal. Other references
 * (e.g. inside `attention_domain.dart`, `app_database.dart`,
 * `protocol-schema/src/index.ts`) are explicitly listed as Phase 6
 * follow-up to keep the Phase 1 change small and reviewable.
 */
const REMAINING_UX_PLAN_FILES: ReadonlyArray<string> = [
  APP_SHELL,
  "apps/mobile/test/ui/r12_shortcuts_test.dart",
];

const REMAINING_UX_PLAN_RULE: Rule = {
  id: "no-remaining-ux-plan-references",
  description: "Source still references docs/REMAINING_UX_PLAN.md which does not exist.",
  files: REMAINING_UX_PLAN_FILES,
  pattern: /REMAINING_UX_PLAN/,
};

/**
 * Pure checker. Accepts a map of repository-relative file paths to
 * their textual contents and returns a structured result. Testable
 * without disk I/O so the Bun harness can exercise both the clean
 * path and the failing path against synthetic fixtures.
 */
export function checkPhase1DocHonesty(input: Phase1FileInput): Phase1Result {
  const failures: Phase1Failure[] = [];
  for (const rule of RULES) {
    for (const file of rule.files) {
      const text = input.files[file];
      if (text === undefined) continue;
      if (rule.pattern.test(text)) {
        failures.push({ file, rule: rule.id, message: rule.description });
      }
    }
  }
  for (const rule of APP_SHELL_RULES) {
    for (const file of rule.files) {
      const text = input.files[file];
      if (text === undefined) continue;
      if (rule.pattern.test(text)) {
        failures.push({ file, rule: rule.id, message: rule.description });
      }
    }
  }
  for (const file of REMAINING_UX_PLAN_RULE.files) {
    const text = input.files[file];
    if (text === undefined) continue;
    if (REMAINING_UX_PLAN_RULE.pattern.test(text)) {
      failures.push({
        file,
        rule: REMAINING_UX_PLAN_RULE.id,
        message: REMAINING_UX_PLAN_RULE.description,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Read the working tree from disk and run the pure checker against it.
 * Exits non-zero with one descriptive line per failure when the gate
 * rejects the overclaims.
 */
function main(): number {
  const files: Record<string, string> = {};
  const targets: ReadonlyArray<string> = [
    "README.md",
    "SECURITY.md",
    "package.json",
    "scripts/all.ts",
    "scripts/phase1-doc-check.ts",
    "scripts/test/phase1-doc-check.test.ts",
    "scripts/phase1-sensitive-scan.ts",
    "docs/ARCHITECTURE.md",
    "docs/CHANGELOG.md",
    "docs/PRIVACY.md",
    "docs/PROJECT_STATUS.md",
    "docs/PROTOCOL.md",
    "docs/QUICKSTART.md",
    "docs/RELEASE.md",
    "apps/mobile/README.md",
    APP_SHELL,
    "apps/mobile/lib/src/ui/shell/shortcut_intents.dart",
    "apps/mobile/test/ui/r12_shortcuts_test.dart",
    "packages/bridge/README.md",
  ];
  // The executable targets intentionally overlap with the RULES'
  // per-file scopes. The convention is: anything scanned by the
  // pure checker is also read here so the executable exercises the
  // same surface. Compared to the RULES array, the executable
  // additionally reads SECURITY.md, package.json, scripts/all.ts,
  // the two Phase 1 scripts, and the touched dart files so future
  // hardening can address them without re-plumbing the runner.
  for (const file of targets) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    files[file] = text;
  }
  const result = checkPhase1DocHonesty({ files });
  if (result.ok) {
    process.stdout.write("phase1:doc-check ok\n");
    return 0;
  }
  for (const failure of result.failures) {
    process.stderr.write(
      `phase1:doc-check ${failure.rule} ${failure.file}: ${failure.message}\n`,
    );
  }
  process.stderr.write(`phase1:doc-check ${result.failures.length} failure(s)\n`);
  return 1;
}

// Suppress the unused-import warning for `relative` when the checker
// is imported by the test harness (the helper is only consumed by the
// external sensitive-scan script that mirrors the same pattern).
void relative;

if (import.meta.main) {
  process.exit(main());
}
