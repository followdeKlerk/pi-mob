import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LoginEnvCaptureError, captureLoginEnv, writeCapturedEnv } from "../src/ops/login-env";
import { createNodeFileSystemPort } from "../src/ops/ports";

describe("login-shell environment capture", () => {
  test("captures and sanitizes a login-shell environment", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-login-shell-"));
    const shell = join(root, "login-shell");
    writeFileSync(shell, "#!/bin/zsh\nprintf 'HOME=/Users/owner\\0PATH=/opt/homebrew/bin:/usr/bin\\0PWD=/tmp\\0OLDPWD=/old\\0SHLVL=1\\0_=env\\0'\n");
    chmodSync(shell, 0o700);
    const env = await captureLoginEnv({ shell });

    expect(env.HOME).toBeTruthy();
    expect(env.PATH).toBeTruthy();
    for (const key of ["PWD", "OLDPWD", "SHLVL", "_"]) expect(env[key]).toBeUndefined();
    for (const value of Object.values(env)) {
      expect(value).not.toContain("\n");
      expect(value).not.toContain("\0");
    }
  });

  test("drops macOS shell and session bookkeeping without rejecting valid keys", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-login-shell-macos-"));
    const shell = join(root, "login-shell");
    writeFileSync(
      shell,
      [
        "#!/bin/zsh",
        "printf 'HOME=/Users/owner\\0'",
        "printf 'USER=owner\\0'",
        "printf 'PATH=/opt/homebrew/bin:/usr/bin\\0'",
        "printf '__CFBundleIdentifier=com.example.pi\\0'",
        "printf '__CF_USER_TEXT_ENCODING=0x1F5:0:0\\0'",
        "printf '__LaunchAgent_PID=1234\\0'",
        "printf 'LaunchInstanceID=ABCDEF\\0'",
        "printf 'XPC_SERVICE_NAME=com.apple.Terminal\\0'",
        "printf 'SECURITYSESSIONID=186a5\\0'",
        "printf 'TERM_PROGRAM_VERSION=450\\0'",
        "printf 'TERM_SESSION_ID=12345678-ABCD\\0'",
        "printf 'ITERM_SESSION_ID=w0t0p0\\0'",
        "printf 'TMUX=/private/tmp/tmux-501/default,123,0\\0'",
        "printf 'STY=12345.pts-0.host\\0'",
        "printf 'DISPLAY=:0\\0'",
        "printf 'XAUTHORITY=/Users/owner/.Xauthority\\0'",
        "printf 'XDG_SESSION_TYPE=wayland\\0'",
        "printf 'XDG_SESSION_DESKTOP=desktop\\0'",
        "printf 'XDG_RUNTIME_DIR=/run/user/501\\0'",
        "printf 'WINDOWID=12345678\\0'",
        "printf 'WINDOWPATH=7\\0'",
      ].join("\n") + "\n",
    );
    chmodSync(shell, 0o700);

    const env = await captureLoginEnv({ shell });

    expect(env).toMatchObject({ HOME: "/Users/owner", USER: "owner", PATH: "/opt/homebrew/bin:/usr/bin" });
    for (const key of [
      "__CFBundleIdentifier",
      "__CF_USER_TEXT_ENCODING",
      "__LaunchAgent_PID",
      "LaunchInstanceID",
      "XPC_SERVICE_NAME",
      "SECURITYSESSIONID",
      "TERM_PROGRAM_VERSION",
      "TERM_SESSION_ID",
      "ITERM_SESSION_ID",
      "TMUX",
      "STY",
      "DISPLAY",
      "XAUTHORITY",
      "XDG_SESSION_TYPE",
      "XDG_SESSION_DESKTOP",
      "XDG_RUNTIME_DIR",
      "WINDOWID",
      "WINDOWPATH",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("writes the captured map owner-only", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-login-env-"));
    const path = join(root, "env");
    writeCapturedEnv(path, { HOME: "/Users/owner", PATH: "/opt/homebrew/bin:/usr/bin" }, createNodeFileSystemPort());

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("rejects an invalid login-shell environment key", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-login-shell-invalid-"));
    const shell = join(root, "login-shell");
    writeFileSync(shell, "#!/bin/zsh\nprintf 'invalid-key=value\\0'\n");
    chmodSync(shell, 0o700);

    await expect(captureLoginEnv({ shell })).rejects.toBeInstanceOf(LoginEnvCaptureError);
  });

  test("fails loudly when the login shell cannot be started", async () => {
    await expect(captureLoginEnv({ shell: "/definitely/not/a/login-shell" })).rejects.toBeInstanceOf(LoginEnvCaptureError);
  });
});
