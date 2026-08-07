import { describe, expect, test } from "bun:test";
import { checkAndroidRelease, type AndroidReleaseInput } from "../android-release-check";

const clean: AndroidReleaseInput = {
  gradle: `namespace = "com.example.pi_mob"\napplicationId = "com.example.pi_mob"\nversionName = flutter.versionName\nversionCode = flutter.versionCode\nsigningConfig = signingConfigs.getByName("release")`,
  manifest: `<manifest package="com.example.pi_mob"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.POST_NOTIFICATIONS"/><uses-permission android:name="android.permission.FOREGROUND_SERVICE"/><uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/><application><activity android:name=".MainActivity"><data android:scheme="pi-mob" android:host="session"/></activity><service android:name=".PiMobMessagingService"/></application></manifest>`,
  firebase: `"package_name": "com.example.pi_mob"`,
  kotlinPaths: ["apps/mobile/android/app/src/main/kotlin/com/example/pi_mob/MainActivity.kt", "apps/mobile/android/app/src/main/kotlin/com/example/pi_mob/PiMobMessagingService.kt"],
  versionName: "0.0.2-alpha.1",
  versionCode: 2,
  applicationId: "com.example.pi_mob",
  namespace: "com.example.pi_mob",
  signing: "CN=Phase 5 ephemeral",
};

describe("android release hygiene", () => {
  test("accepts the stable preview identity and release artifact", () => {
    expect(checkAndroidRelease(clean)).toEqual({ ok: true, errors: [] });
  });

  test("rejects identity drift", () => {
    const result = checkAndroidRelease({ ...clean, applicationId: "com.other.app" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("applicationId");
  });

  test("rejects debug signing on release", () => {
    const result = checkAndroidRelease({ ...clean, gradle: clean.gradle.replace('signingConfigs.getByName("release")', 'signingConfigs.getByName("debug")') });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("debug signing");
  });

  test("rejects Kotlin package drift", () => {
    const result = checkAndroidRelease({ ...clean, kotlinSources: ["package com.other.app"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\\n")).toContain("Kotlin package");
  });

  test("rejects version and permission drift", () => {
    const result = checkAndroidRelease({ ...clean, versionCode: 2, versionName: "0.0.2", manifest: clean.manifest.replace("FOREGROUND_SERVICE_DATA_SYNC", "ACCESS_FINE_LOCATION") });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("versionName");
    expect(result.errors.join("\n")).toContain("permission");
  });
});
