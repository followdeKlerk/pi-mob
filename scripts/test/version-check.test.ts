import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkVersion, type VersionCheckFileInput } from "../version-check";

const SCRIPT = join(import.meta.dir, "..", "version-check.ts");

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

const CANONICAL = "0.0.3-alpha.1";

/**
 * Build a clean synthetic workspace that aligns every version source
 * with the canonical `0.0.3-alpha.1`. The bridge manifest bundle and
 * the Gradle/Android build still pick up `versionCode=1` from the
 * Android code fallback in `VERSION`.
 */
function cleanInput(): Record<string, string> {
  return {
    "VERSION": `${CANONICAL}\n`,
    "package.json": `{"name":"pi-mob","version":"${CANONICAL}","private":true}\n`,
    "packages/bridge/package.json": `{"name":"@pi-mob/bridge","version":"${CANONICAL}","private":true}\n`,
    "packages/protocol-schema/package.json": `{"name":"@pi-mob/protocol-schema","version":"${CANONICAL}","private":true}\n`,
    "packages/bridge/src/version.ts": `export const BRIDGE_VERSION = "${CANONICAL}";\n`,
    "apps/mobile/pubspec.yaml": `name: pi_mob\ndescription: pi-mob Flutter mobile control surface.\nversion: ${CANONICAL}+1\n`,
    "apps/mobile/lib/src/version.dart": `const String kMobileAppVersion = '${CANONICAL}';\n`,
    "packages/bridge/src/daemon.ts": "// daemon\n",
    "packages/bridge/src/smoke.ts": "// smoke\n",
    "packages/bridge/src/ops-entry.ts": "// ops\n",
    "packages/bridge/src/build-metadata.ts": "// build metadata\n",
    "scripts/build.ts": "// build script\n",
    "packages/bridge/test/m7-release-build.test.ts": "// m7 release build test\n",
    "packages/bridge/test/m7-serve-pairing-doctor.test.ts": "// m7 serve pairing doctor test\n",
    "packages/bridge/test/m7-install-lifecycle.test.ts": "// m7 install lifecycle test\n",
    "apps/mobile/lib/main.dart": "// main.dart\n",
    "apps/mobile/lib/src/connection/connection_coordinator.dart": "// coordinator\n",
    "apps/mobile/lib/src/data/app_database.dart": "// app database\n",
  };
}

function apply(
  base: Record<string, string> | VersionCheckFileInput,
  file: string,
  snippet: string,
): VersionCheckFileInput {
  const inner = (base as VersionCheckFileInput).files ?? (base as Record<string, string>);
  return { files: { ...inner, [file]: snippet } };
}

describe("version:check (executable)", () => {
  test("script exits 0 when the real tree is clean", () => {
    const result = runScript();
    if (result.code !== 0) {
      process.stderr.write(result.stderr);
    }
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("version:check ok");
    expect(result.stdout).toContain(CANONICAL);
  });

  test("script is wired into bun run scripts", () => {
    const result = spawnSync("bun", ["run", "scripts/version-check.ts"], {
      cwd: new URL("../..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});

describe("version:check (pure checker)", () => {
  test("returns zero drifts on a clean synthetic tree", () => {
    const result = checkVersion({ files: cleanInput() });
    expect(result.canonicalVersion).toBe(CANONICAL);
    expect(result.drifts).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("flags a missing VERSION file", () => {
    const input: VersionCheckFileInput = { files: { ...cleanInput() } };
    delete (input.files as Record<string, string | undefined>)["VERSION"];
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ file: "VERSION", field: "canonical" }),
    );
  });

  test("flags drift in root package.json", () => {
    const input = apply(
      cleanInput(),
      "package.json",
      `{"name":"pi-mob","version":"0.0.0","private":true}\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "package.json",
        field: "version",
        observed: "0.0.0",
        expected: CANONICAL,
      }),
    );
  });

  test("flags drift in bridge package.json", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/package.json",
      `{"name":"@pi-mob/bridge","version":"0.0.0","private":true}\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "packages/bridge/package.json",
        field: "version",
        observed: "0.0.0",
      }),
    );
  });

  test("flags drift in protocol-schema package.json", () => {
    const input = apply(
      cleanInput(),
      "packages/protocol-schema/package.json",
      `{"name":"@pi-mob/protocol-schema","version":"0.0.0","private":true}\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "packages/protocol-schema/package.json",
        field: "version",
      }),
    );
  });

  test("flags drift in generated bridge version.ts", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/src/version.ts",
      `export const BRIDGE_VERSION = "0.0.0-m8";\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "packages/bridge/src/version.ts",
        field: "BRIDGE_VERSION",
        observed: "0.0.0-m8",
      }),
    );
  });

  test("flags drift in generated Dart version module", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/src/version.dart",
      `const String kMobileAppVersion = '0.0.0';\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "apps/mobile/lib/src/version.dart",
        field: "kMobileAppVersion",
        observed: "0.0.0",
      }),
    );
  });

  test("flags drift in apps/mobile/pubspec.yaml", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/pubspec.yaml",
      "name: pi_mob\ndescription: pi-mob\nversion: 0.0.0+1\n",
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "apps/mobile/pubspec.yaml",
        field: "version",
        observed: "0.0.0+1",
        expected: `${CANONICAL}+1`,
      }),
    );
  });

  test("flags Android versionCode 2 in pubspec.yaml", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/pubspec.yaml",
      `name: pi_mob\ndescription: pi-mob\nversion: ${CANONICAL}+2\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "apps/mobile/pubspec.yaml",
        field: "version",
        observed: `${CANONICAL}+2`,
        expected: `${CANONICAL}+1`,
      }),
    );
  });

  test("respects an explicit androidCode in VERSION", () => {
    const input = apply(
      cleanInput(),
      "VERSION",
      `${CANONICAL}\nandroidCode: 3\n`,
    );
    // When VERSION declares androidCode=3 the cleanInput's pubspec
    // build number (+1) becomes stale and must be updated alongside.
    const aligned = apply(
      input,
      "apps/mobile/pubspec.yaml",
      `name: pi_mob\ndescription: pi-mob\nversion: ${CANONICAL}+3\n`,
    );
    const result = checkVersion(aligned);
    expect(result.ok).toBe(true);
    expect(result.canonicalVersion).toBe(CANONICAL);
  });

  test("flags a milestone fallback in daemon.ts", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/src/daemon.ts",
      `const BRIDGE_VERSION = "0.0.0-m8";\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "packages/bridge/src/daemon.ts",
      }),
    );
  });

  test("flags a milestone fallback in smoke.ts", () => {
    const input = apply(
      cleanInput(),
      "packages/bridge/src/smoke.ts",
      `const BRIDGE_VERSION = "0.0.0-m1";\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "packages/bridge/src/smoke.ts",
      }),
    );
  });

  test("flags a milestone fallback in build.ts", () => {
    const input = apply(
      cleanInput(),
      "scripts/build.ts",
      `const DEFAULT_BRIDGE_VERSION = "0.0.0-m7";\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "scripts/build.ts",
      }),
    );
  });

  test("flags hardcoded mobile 0.0.0 in main.dart", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/main.dart",
      `appVersion: '0.0.0',\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ file: "apps/mobile/lib/main.dart" }),
    );
  });

  test("flags hardcoded mobile 0.0.0 in connection_coordinator.dart", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/src/connection/connection_coordinator.dart",
      `'mobileVersion': '0.0.0',\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({
        file: "apps/mobile/lib/src/connection/connection_coordinator.dart",
      }),
    );
  });

  test("flags hardcoded mobile 0.0.0 in app_database.dart", () => {
    const input = apply(
      cleanInput(),
      "apps/mobile/lib/src/data/app_database.dart",
      `appVersion: '0.0.0',\n`,
    );
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ file: "apps/mobile/lib/src/data/app_database.dart" }),
    );
  });

  test("flags a missing generated bridge version module", () => {
    const input: VersionCheckFileInput = { files: { ...cleanInput() } };
    delete (input.files as Record<string, string | undefined>)["packages/bridge/src/version.ts"];
    const result = checkVersion(input);
    expect(result.ok).toBe(false);
    expect(result.drifts).toContainEqual(
      expect.objectContaining({ file: "packages/bridge/src/version.ts" }),
    );
  });

  test("warns but does not fail on a leading 'v' in VERSION", () => {
    const input = apply(cleanInput(), "VERSION", `v${CANONICAL}\n`);
    const result = checkVersion(input);
    expect(result.canonicalVersion).toBe(CANONICAL);
    // The leading 'v' is stripped silently to the canonical form; we
    // do not fail the build so existing v-prefixed VERSION files keep
    // working while operators migrate.
    expect(result.ok).toBe(true);
  });

  test("reports drifts for every drifted source in one pass", () => {
    const input = apply(
      cleanInput(),
      "package.json",
      `{"name":"pi-mob","version":"0.0.0","private":true}\n`,
    );
    const result = checkVersion(input);
    // The drifted package.json field is the only drift, since all other
    // sources are still aligned.
    const drifted = result.drifts.filter((d) => d.file === "package.json");
    expect(drifted.length).toBe(1);
    expect(drifted[0]).toMatchObject({
      field: "version",
      observed: "0.0.0",
      expected: CANONICAL,
    });
  });
});
