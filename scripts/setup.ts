#!/usr/bin/env bun
/**
 * Bootstrap the monorepo on a fresh checkout.
 *
 * M1 validates that the pinned Bun runtime matches the manifest, that the
 * Flutter scaffold's revision matches the M0 evidence file, and that the
 * Bun lockfile is present. Future checkpoints add real installer steps
 * (Xcode license acceptance, Tailscale check, Pi artefact download).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const EXPECTED_FLUTTER_REVISION = "ad70ec4617166f1c38e5d2bfd388af71fda14f06";

const FAILURES: string[] = [];

function assertBun(): void {
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
  if (bunVersion !== "1.3.14") {
    FAILURES.push(`bun version ${bunVersion} != 1.3.14`);
  } else {
    process.stdout.write(`bun ${bunVersion} ok\n`);
  }
}

function readFlutterRevision(): string | null {
  const metadata = join(ROOT, "apps/mobile/.metadata");
  if (!existsSync(metadata)) {
    FAILURES.push(`missing ${metadata}`);
    return null;
  }
  const text = readFileSync(metadata, "utf8");
  const match = text.match(/revision:\s*"?([0-9a-f]+)"?/);
  if (!match) {
    FAILURES.push(`could not parse revision from ${metadata}`);
    return null;
  }
  return match[1] ?? null;
}

function assertFlutter(): void {
  const revision = readFlutterRevision();
  if (revision !== EXPECTED_FLUTTER_REVISION) {
    FAILURES.push(
      `flutter scaffold revision ${revision ?? "unknown"} != ${EXPECTED_FLUTTER_REVISION}`,
    );
  } else {
    process.stdout.write(`flutter scaffold revision ${revision} ok\n`);
  }
}

function assertPackageManifest(): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    packageManager?: string;
  };
  if (pkg.packageManager !== "bun@1.3.14") {
    FAILURES.push(`root packageManager ${pkg.packageManager ?? "unset"} != bun@1.3.14`);
  } else {
    process.stdout.write(`root packageManager ${pkg.packageManager} ok\n`);
  }
}

function assertLockfile(): void {
  if (!existsSync(join(ROOT, "bun.lock"))) {
    FAILURES.push("bun.lock missing; run `bun install` first");
  } else {
    process.stdout.write("bun.lock present\n");
  }
}

function main(): number {
  assertBun();
  assertFlutter();
  assertPackageManifest();
  assertLockfile();
  if (FAILURES.length > 0) {
    process.stderr.write("setup failed:\n");
    for (const f of FAILURES) {
      process.stderr.write(`  - ${f}\n`);
    }
    return 1;
  }
  process.stdout.write("setup ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
