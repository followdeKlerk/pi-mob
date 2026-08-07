#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION_LINES = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim().split("\n");
export const ANDROID_APPLICATION_ID = "com.example.pi_mob";
export const ANDROID_NAMESPACE = ANDROID_APPLICATION_ID;
export const ANDROID_VERSION_NAME = VERSION_LINES[0]!.trim();
export const ANDROID_VERSION_CODE = Number(VERSION_LINES.find((line) => line.startsWith("androidCode:"))?.split(":", 2)[1]?.trim() ?? "-1");
const REQUIRED_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
];
const ALLOWED_PERMISSIONS = new Set([
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  // Merged dependency permissions: FCM and secure storage.
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.WAKE_LOCK",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.example.pi_mob.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
]);
const REQUIRED_MANIFEST = [".MainActivity", ".PiMobMessagingService", "pi-mob", "session"];

export interface AndroidReleaseInput {
  gradle: string;
  manifest: string;
  firebase: string;
  kotlinPaths: string[];
  kotlinSources?: string[];
  versionName: string;
  versionCode: number;
  applicationId: string;
  namespace: string;
  signing: string;
}
export interface AndroidReleaseResult { ok: boolean; errors: string[] }

export function checkAndroidRelease(input: AndroidReleaseInput): AndroidReleaseResult {
  const errors: string[] = [];
  if (input.applicationId !== ANDROID_APPLICATION_ID) errors.push(`applicationId drift: ${input.applicationId}`);
  if (input.namespace !== ANDROID_NAMESPACE) errors.push(`namespace drift: ${input.namespace}`);
  if (!input.gradle.includes(`applicationId = "${ANDROID_APPLICATION_ID}"`)) errors.push("Gradle applicationId is not the stable preview identity");
  if (!input.gradle.includes(`namespace = "${ANDROID_NAMESPACE}"`)) errors.push("Gradle namespace is not the stable preview identity");
  if (input.gradle.includes('getByName("debug")') || /signingConfig\s*=\s*debug/i.test(input.gradle)) errors.push("debug signing is configured for release");
  if (!input.gradle.includes("signingConfigs.getByName(\"release\")")) errors.push("release signing config is not selected");
  if (input.versionName !== ANDROID_VERSION_NAME) errors.push(`versionName drift: ${input.versionName}`);
  if (input.versionCode !== ANDROID_VERSION_CODE) errors.push(`versionCode drift: ${input.versionCode}`);
  if (!input.firebase.includes(`"package_name": "${ANDROID_APPLICATION_ID}"`)) errors.push("Firebase package wiring drift");
  for (const required of REQUIRED_MANIFEST) {
    const artifactEquivalent = required.startsWith(".") && input.manifest.includes(`${ANDROID_APPLICATION_ID}${required}`);
    if (!input.manifest.includes(required) && !artifactEquivalent) errors.push(`missing manifest declaration: ${required}`);
  }
  const permissions = input.manifest.includes("E: uses-permission")
    ? input.manifest.split("\n").flatMap((line, index, lines) => {
        if (!line.includes("E: uses-permission")) return [];
        for (const candidate of lines.slice(index + 1, index + 5)) {
          const match = /android:name(?:\([^)]*\))?\s*=\s*"([^"]+)"/.exec(candidate);
          if (match) return [match[1]!];
        }
        return [];
      })
    : [...input.manifest.matchAll(/android:name\s*=\s*"(android\.permission\.[^"]+)"/g)].map((m) => m[1]!);
  for (const permission of permissions) if (!ALLOWED_PERMISSIONS.has(permission)) errors.push(`unexpected permission: ${permission}`);
  for (const permission of REQUIRED_PERMISSIONS) if (!permissions.includes(permission)) errors.push(`missing required permission: ${permission}`);
  if (!input.kotlinPaths.some((p) => p.endsWith("/com/example/pi_mob/MainActivity.kt"))) errors.push("MainActivity package path drift");
  if (!input.kotlinPaths.some((p) => p.endsWith("/com/example/pi_mob/PiMobMessagingService.kt"))) errors.push("notification service package path drift");
  if (input.kotlinSources?.some((source) => !source.includes(`package ${ANDROID_NAMESPACE}`))) errors.push("Kotlin package declaration drift");
  if (!(input.signing.includes("certificate DN:") || /^CN=|^O=|^OU=/.test(input.signing)) || /Android\s+Debug/i.test(input.signing)) errors.push("release artifact uses debug or unknown signing");
  return { ok: errors.length === 0, errors };
}

function command(name: string, args: string[]): string {
  const result = spawnSync(name, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${name} failed`);
  return result.stdout;
}
function tool(name: string): string {
  const result = spawnSync("sh", ["-c", `command -v ${name} || true`], { encoding: "utf8" });
  if (result.stdout.trim()) return result.stdout.trim();
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "/usr/local/share/android-commandlinetools";
  const candidates = spawnSync("sh", ["-c", `find "${sdk}/build-tools" -type f -name "${name}" 2>/dev/null | sort -V | tail -1`], { encoding: "utf8" }).stdout.trim();
  return candidates;
}
function parseBadging(text: string) {
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(text);
  return { applicationId: pkg?.[1] ?? "<missing>", versionCode: Number(pkg?.[2] ?? "-1"), versionName: pkg?.[3] ?? "<missing>" };
}

function main(): number {
  const root = new URL("..", import.meta.url).pathname;
  const apkIndex = process.argv.indexOf("--apk");
  const apk = apkIndex >= 0 ? process.argv[apkIndex + 1] : undefined;
  const reportIndex = process.argv.indexOf("--report");
  const report = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined;
  const gradlePath = join(root, "apps/mobile/android/app/build.gradle.kts");
  const manifestPath = join(root, "apps/mobile/android/app/src/main/AndroidManifest.xml");
  const firebasePath = join(root, "apps/mobile/android/app/google-services.json");
  const gradle = readFileSync(gradlePath, "utf8");
  const manifest = readFileSync(manifestPath, "utf8");
  const firebase = existsSync(firebasePath) ? readFileSync(firebasePath, "utf8") : "";
  const kotlinPaths = ["apps/mobile/android/app/src/main/kotlin/com/example/pi_mob/MainActivity.kt", "apps/mobile/android/app/src/main/kotlin/com/example/pi_mob/PiMobMessagingService.kt"];
  const input: AndroidReleaseInput = { gradle, manifest, firebase, kotlinPaths, kotlinSources: kotlinPaths.map((path) => readFileSync(join(root, path), "utf8")), versionName: ANDROID_VERSION_NAME, versionCode: ANDROID_VERSION_CODE, applicationId: ANDROID_APPLICATION_ID, namespace: ANDROID_NAMESPACE, signing: "CN=static-check" };
  const lines = [`stable identity: ${ANDROID_APPLICATION_ID}`, `expected version: ${ANDROID_VERSION_NAME} (${ANDROID_VERSION_CODE})`];
  let result = checkAndroidRelease(input);
  if (apk) {
    if (!existsSync(apk)) { result.errors.push(`APK not found: ${apk}`); }
    else {
      const aapt = tool("aapt");
      if (!aapt) result.errors.push("aapt is required for APK artifact inspection");
      else {
        const metadata = parseBadging(command(aapt, ["dump", "badging", apk]));
        const xml = command(aapt, ["dump", "xmltree", apk, "AndroidManifest.xml"]);
        const signer = tool("apksigner") ? command(tool("apksigner"), ["verify", "--print-certs", apk]) : "signer tool unavailable";
        lines.push(`artifact: ${apk.split("/").pop()}`, `artifact applicationId: ${metadata.applicationId}`, `artifact version: ${metadata.versionName} (${metadata.versionCode})`, `artifact signer: ${signer.trim()}`, `artifact manifest:\n${xml}`);
        result = checkAndroidRelease({ ...input, applicationId: metadata.applicationId, versionName: metadata.versionName, versionCode: metadata.versionCode, manifest: xml, signing: signer });
      }
    }
  }
  result = { ...result, ok: result.errors.length === 0 };
  if (report) writeFileSync(report, `${lines.join("\n")}\nstatus: ${result.ok ? "ok" : "failed"}\n${result.errors.map((e) => `error: ${e}`).join("\n")}\n`);
  if (!result.ok) { for (const error of result.errors) console.error(`android-release-check: ${error}`); return 1; }
  console.log(`android-release-check ok (${ANDROID_APPLICATION_ID}, ${ANDROID_VERSION_NAME}+${ANDROID_VERSION_CODE}${apk ? ", artifact inspected" : ""})`);
  return 0;
}
if (import.meta.main) process.exit(main());
