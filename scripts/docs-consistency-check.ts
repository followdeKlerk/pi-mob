#!/usr/bin/env bun
/** Checks stable documentation facts against repository metadata. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANDROID_VERSION_CODE, ANDROID_VERSION_NAME } from "./android-release-check";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const failures: string[] = [];

function requireText(path: string, text: string): void {
  if (!read(path).includes(text)) failures.push(`${path}: missing ${JSON.stringify(text)}`);
}

const version = read("VERSION").split("\n", 1)[0]!.trim();
if (version !== ANDROID_VERSION_NAME) failures.push(`VERSION and Android version differ: ${version} vs ${ANDROID_VERSION_NAME}`);
if (!read("apps/mobile/pubspec.yaml").includes(`version: ${version}+${ANDROID_VERSION_CODE}`)) {
  failures.push("apps/mobile/pubspec.yaml: version metadata drift");
}

const requiredDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/PROJECT_STATUS.md",
  "docs/QUICKSTART.md",
  "docs/ARCHITECTURE.md",
  "docs/PROTOCOL.md",
  "docs/PRIVACY.md",
  "apps/mobile/README.md",
  "packages/bridge/README.md",
  "packages/protocol-schema/README.md",
];
for (const path of requiredDocs) {
  if (!existsSync(join(ROOT, path))) failures.push(`${path}: missing`);
}

for (const path of ["docs/README.md", "docs/RELEASE.md", "docs/RUNBOOK.md", "packages/protocol-fixtures/README.md"]) {
  if (existsSync(join(ROOT, path))) failures.push(`${path}: redundant document restored`);
}

requireText("README.md", "Alpha software:");
requireText("README.md", "Firebase Cloud Messaging");
requireText("docs/PROJECT_STATUS.md", "**Production-wired**");
requireText("docs/PROJECT_STATUS.md", "**Implemented, not production-wired**");
requireText("docs/PROJECT_STATUS.md", "**Planned**");
requireText("docs/PROJECT_STATUS.md", "**Out of scope**");
requireText("docs/PROJECT_STATUS.md", "| without-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `session_events.v2`, `streams.v1` |");
requireText("docs/PROJECT_STATUS.md", "| with-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `notifications.v1`, `session_events.v2`, `streams.v1` |");
requireText("docs/PROJECT_STATUS.md", `version \`${version}\` / code \`${ANDROID_VERSION_CODE}\``);
requireText("docs/QUICKSTART.md", "--fcm-service-account");
requireText("docs/PROTOCOL.md", "exact message authority");
requireText("docs/PRIVACY.md", "[SECURITY.md](../SECURITY.md)");
requireText("CONTRIBUTING.md", "storePassword");
requireText("packages/bridge/README.md", "Before recovery, stop the bridge");
requireText("packages/protocol-schema/README.md", "They do not prove that the normal daemon constructs an optional provider");
requireText("apps/mobile/android/app/src/main/AndroidManifest.xml", 'android:label="Pi Mob"');

if (failures.length > 0) {
  for (const failure of failures) console.error(`docs-consistency-check: ${failure}`);
  process.exit(1);
}
console.log("docs-consistency-check ok");
