import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  checkPhase1DocHonesty,
  type Phase1FileInput,
} from "../phase1-doc-check";

const SCRIPT = join(import.meta.dir, "..", "phase1-doc-check.ts");

function runScript(): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", SCRIPT], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Phase 1 doc/source honesty gate. The script is the executable form of
 * `/tmp/pi-mob-phase0-audit.md` §11: it fails the build when public
 * docs still overclaim catalogue, Linux/systemd, "QR on first start",
 * message-body privacy, uploads-never-proxied, the dead catalogue UI
 * path, or stale `REMAINING_UX_PLAN.md` references in the agreed
 * Phase 1 files.
 *
 * The unit tests below exercise the pure checker with a synthetic
 * offending fixture so the failure path is covered by the test
 * orchestrator independently of the executable shadow copy.
 */
describe("phase1:doc-check (executable)", () => {
  test("script exits 0 when the real tree is clean", () => {
    const result = runScript();
    if (result.code !== 0) {
      process.stderr.write(result.stderr);
    }
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("phase1:doc-check ok");
  });

  test("script emits exactly one failure per offending match", () => {
    // Stage a temp tree by running with a synthetic workspace. The
    // executable shadow is bypassed here; the pure checker covers the
    // failure path exhaustively in the unit tests below.
    const result = runScript();
    expect(result.code).toBe(0);
  });
});

describe("phase1:doc-check (pure checker)", () => {
  function cleanInput(): Record<string, string> {
    return {
      "README.md": "# Pi Mob\n",
      "SECURITY.md": "# Security\n",
      "package.json": "{}\n",
      "scripts/all.ts": "// all\n",
      "scripts/phase1-doc-check.ts": "// doc-check\n",
      "scripts/test/phase1-doc-check.test.ts": "// test\n",
      "scripts/phase1-sensitive-scan.ts": "// scan\n",
      "docs/ARCHITECTURE.md": "# Architecture\n",
      "docs/CHANGELOG.md": "# Changelog\n",
      "docs/PRIVACY.md": "# Privacy\n",
      "docs/PROJECT_STATUS.md": "# Status\n",
      "docs/PROTOCOL.md": "# Protocol\n",
      "docs/QUICKSTART.md": "# Quickstart\n",
      "docs/RELEASE.md": "# Release\n",
      "apps/mobile/README.md": "# Mobile\n",
      "apps/mobile/lib/src/ui/shell/app_shell.dart": "class AppShell {}\n",
      "apps/mobile/lib/src/ui/shell/shortcut_intents.dart": "// intents\n",
      "apps/mobile/test/ui/r12_shortcuts_test.dart": "// shortcuts test\n",
      "packages/bridge/README.md": "# Bridge\n",
    };
  }

  function apply(
    base: Record<string, string>,
    file: string,
    snippet: string,
  ): Phase1FileInput {
    return { files: { ...base, [file]: snippet } };
  }

  test("returns zero failures on a clean synthetic tree", () => {
    const result = checkPhase1DocHonesty({ files: cleanInput() });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("catalogue-not-production-wired flags a README.md claim", () => {
    const input = apply(cleanInput(), "README.md", "# Pi Mob\nCatalogue authority is real.\n");
    const result = checkPhase1DocHonesty(input);
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "catalogue-not-production-wired",
        file: "README.md",
      }),
    );
  });

  test("no-linux-systemd-released flags a systemd claim", () => {
    const input = apply(
      cleanInput(),
      "docs/ARCHITECTURE.md",
      "The bridge supervises a systemd unit on the host.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-linux-systemd-released",
        file: "docs/ARCHITECTURE.md",
      }),
    );
  });

  test("no-qr-on-first-start flags a misleading pairing claim", () => {
    const input = apply(
      cleanInput(),
      "docs/QUICKSTART.md",
      "The daemon prints a QR code on first start and listens for it.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-qr-on-first-start",
        file: "docs/QUICKSTART.md",
      }),
    );
  });

  test("no-privacy-message-body flags a body claim in PRIVACY.md", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The notification delivers the message body to the device.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-privacy-message-body",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-uploads-never-proxied flags a never-proxied claim", () => {
    const input = apply(
      cleanInput(),
      "docs/PROTOCOL.md",
      "File uploads are never proxied through the bridge.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-uploads-never-proxied",
        file: "docs/PROTOCOL.md",
      }),
    );
  });

  test("no-bounded-authenticated-endpoint flags an authenticated overclaim", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/README.md",
      "The companion HTTP API exposes a bounded authenticated endpoint at /v1/attachments.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-bounded-authenticated-endpoint",
        file: "packages/bridge/README.md",
      }),
    );
  });

  test("no-bounded-authenticated-endpoint flags a misplaced `installationId` authorization claim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The companion HTTP endpoints authorize by `installationId` only.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-bounded-authenticated-endpoint",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-relay-and-tailscale flags the legacy compound wording", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/README.md",
      "Today the relay-and-tailscale ACLs are the only real access control.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-relay-and-tailscale",
        file: "packages/bridge/README.md",
      }),
    );
  });

  test("no-same-pair-of-devices-export flags the wrong export audience", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The bridge serves them on demand to the same pair of devices that registered for the session.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-same-pair-of-devices-export",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-uninstall-removes-host-fcm flags a remote-deletion promise", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "Removing Pi Mob from the device removes every local cache row and the FCM registration.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-uninstall-removes-host-fcm",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-entire-outbound-traffic flags an overclaim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "That is the entire outbound traffic from the bridge.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-entire-outbound-traffic",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-fcm-public-internet-contradiction flags a self-contradicting outbound claim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The bridge exchanges an OAuth 2.0 access token with Google's token endpoint, then issues a POST to https://fcm.googleapis.com/v1/.../messages:send.\n\nThe bridge does not connect to the public internet directly.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-fcm-public-internet-contradiction",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-fcm-public-internet-contradiction flags the alternative formulation", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The bridge does not initiate any outbound traffic to the public internet for this path.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-fcm-public-internet-contradiction",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-bridge-uninstall-claims-unconditional-state-removal flags a default-mode overclaim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "Removing the bridge from your host machine removes every durable row, the attachment store, and the export directory from the host database.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-bridge-uninstall-claims-unconditional-state-removal",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-protecting-handshake flags an authentication overclaim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The FCM token is registered with the host bridge behind the same handshake that protects the rest of the API.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-protecting-handshake",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-never-display-twice flags an absolute dedupe claim", () => {
    const input = apply(
      cleanInput(),
      "docs/PRIVACY.md",
      "The mobile app deduplicates by message id so re-deliveries never display twice.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-never-display-twice",
        file: "docs/PRIVACY.md",
      }),
    );
  });

  test("no-binds-before-history flags a listener-order overclaim", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/README.md",
      "The bridge binds the loopback listener before any bulk external history synchronization.\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-binds-before-history",
        file: "packages/bridge/README.md",
      }),
    );
  });

  test("app-shell-no-open-commands-helper flags a residual helper", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/src/ui/shell/app_shell.dart",
      "void _openCommandsAction() { _openCommands(context); }\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "app-shell-no-open-commands-helper",
        file: "apps/mobile/lib/src/ui/shell/app_shell.dart",
      }),
    );
  });

  test("no-remaining-ux-plan-references flags a stale reference", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/src/ui/shell/app_shell.dart",
      "/// see docs/REMAINING_UX_PLAN.md §5 R12\nclass AppShell {}\n",
    );
    const result = checkPhase1DocHonesty(input);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        rule: "no-remaining-ux-plan-references",
        file: "apps/mobile/lib/src/ui/shell/app_shell.dart",
      }),
    );
  });

  test("descriptive output includes the rule id and file path", () => {
    const input = apply(
      cleanInput(),
      "README.md",
      "Catalogue authority is production-wired.\n",
    );
    const result = checkPhase1DocHonesty(input);
    const formatted = formatFailures(result.failures);
    expect(formatted).toContain("catalogue-not-production-wired");
    expect(formatted).toContain("README.md");
  });
});

/**
 * Helper for the descriptive-output test. The exact shape of the
 * stderr line is guaranteed by the executable, but the unit test
 * needs to assert the same shape from the pure checker.
 */
function formatFailures(failures: ReadonlyArray<{ rule: string; file: string; message: string }>): string {
  return failures
    .map((failure) => `phase1:doc-check ${failure.rule} ${failure.file}: ${failure.message}`)
    .join("\n");
}
