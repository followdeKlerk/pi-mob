#!/usr/bin/env bun
/** Checks documentation against current repository facts. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANDROID_VERSION_CODE, ANDROID_VERSION_NAME } from "./android-release-check";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const failures: string[] = [];

function requireText(path: string, text: string): void {
  if (!read(path).includes(text)) failures.push(`${path}: missing ${JSON.stringify(text)}`);
}

function forbidText(path: string, pattern: RegExp, description: string): void {
  if (pattern.test(read(path))) failures.push(`${path}: ${description}`);
}

const version = read("VERSION").split("\n", 1)[0]!.trim();
if (version !== ANDROID_VERSION_NAME) failures.push(`VERSION and Android version differ: ${version} vs ${ANDROID_VERSION_NAME}`);
const pubspec = read("apps/mobile/pubspec.yaml");
if (!pubspec.includes(`version: ${version}+${ANDROID_VERSION_CODE}`)) failures.push("apps/mobile/pubspec.yaml: version metadata drift");
const status = read("docs/PROJECT_STATUS.md");
if (!status.includes(`version \`${version}\` / code \`${ANDROID_VERSION_CODE}\``)) failures.push("docs/PROJECT_STATUS.md: release metadata drift");

requireText("README.md", "Alpha software:");
requireText("README.md", "bounded status metadata is sent through Firebase Cloud Messaging");
requireText("README.md", "catalogue.v1");
requireText("docs/README.md", "[RUNBOOK.md](RUNBOOK.md)");
requireText("docs/PRIVACY.md", "[SECURITY.md](../SECURITY.md)");
requireText("apps/mobile/android/app/src/main/AndroidManifest.xml", 'android:label="Pi Mob"');

forbidText("README.md", /Apple\/Google push tokens|No data leaves your host other than/i, "privacy summary omits bounded FCM status metadata");
forbidText("docs/PRIVACY.md", /App Store \/ Play Store|App Store\/Play Store/i, "unsupported store distribution claim");
forbidText("docs/PRIVACY.md", /Coordinates are in the project README/i, "dead security-reporting pointer");
forbidText("docs/ARCHITECTURE.md", /mobile app does not cache credentials/i, "credential-storage contradiction");
forbidText("docs/PROTOCOL.md", /releases it when the user navigates away/i, "stale lease lifecycle claim");
forbidText("SECURITY.md", /private alpha|listener is bound after|bind-loopback-before-history/i, "stale security state");
forbidText("AGENTS.md", /Current objective|Priority order|documented by CI|Bind the loopback listener before/i, "mutable or stale project status");
forbidText("CONTRIBUTING.md", /private alpha|versions used by CI/i, "stale project or toolchain wording");
forbidText("packages/bridge/README.md", /does not construct.*catalogue|does not advertise.*catalogue/i, "stale catalogue capability claim");

if (!existsSync(join(ROOT, "docs/PRIVACY.md"))) failures.push("docs/PRIVACY.md: missing");
if (failures.length > 0) {
  for (const failure of failures) console.error(`docs-consistency-check: ${failure}`);
  process.exit(1);
}
console.log("docs-consistency-check ok");
