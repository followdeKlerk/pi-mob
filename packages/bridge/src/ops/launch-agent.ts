/**
 * User LaunchAgent plist generation.
 *
 * The plist is the contract with macOS `launchd`. M7 ships a strict plist
 * generator that:
 *
 *   - uses the `LaunchAgent` (per-user) domain via the conventional install
 *     path; the daemon itself never invokes `launchctl`,
 *   - sets `RunAtLoad` and `KeepAlive` so the service starts at login and
 *     respawns after a crash,
 *   - sets `ProcessType=Background` (interactive=false),
 *   - uses absolute `ProgramArguments` only — no shell, no `bash -c`,
 *   - forbids any path that is not absolute,
 *   - validates the LaunchAgent label format (reverse-DNS).
 *
 * The plist XML is hand-emitted because the alternative (`plist` npm
 * packages) is unmaintained and the format is small and stable.
 */

import { FILE_MODE, assertAbsolute, assertLabel } from "./install-paths";
import { InstallPathError, type FileSystemPort } from "./ports";

export interface LaunchAgentSpec {
  readonly label: string;
  /** Absolute path to the bridge daemon executable. */
  readonly program: string;
  /** Absolute paths only; first entry is always the executable itself. */
  readonly programArguments: readonly string[];
  /** Absolute working directory. */
  readonly workingDirectory: string;
  /** Pre-allow-listed environment. */
  readonly environment: Readonly<Record<string, string>>;
  /** Absolute stdout log path. */
  readonly stdoutPath: string;
  /** Absolute stderr log path. */
  readonly stderrPath: string;
  /** Defaults to true. */
  readonly runAtLoad?: boolean;
  /** Defaults to true. */
  readonly keepAlive?: boolean;
  /** Always `Background` for M7. */
  readonly processType?: "Background";
  /** Optional soft resource limits. */
  readonly softResourceLimits?: Readonly<Record<string, number>>;
}

/** Thrown when a LaunchAgent spec fails validation. */
export class LaunchAgentSpecError extends InstallPathError {}

/** Resolves a spec with the default macOS-friendly options applied. */
export function resolveLaunchAgentSpec(spec: LaunchAgentSpec): Required<Omit<LaunchAgentSpec, "softResourceLimits">> & {
  readonly softResourceLimits?: Readonly<Record<string, number>>;
} {
  validateSpec(spec);
  const out: Required<Omit<LaunchAgentSpec, "softResourceLimits">> = {
    label: spec.label,
    program: spec.program,
    programArguments: [...spec.programArguments],
    workingDirectory: spec.workingDirectory,
    environment: { ...spec.environment },
    stdoutPath: spec.stdoutPath,
    stderrPath: spec.stderrPath,
    runAtLoad: spec.runAtLoad ?? true,
    keepAlive: spec.keepAlive ?? true,
    processType: spec.processType ?? "Background",
  };
  if (spec.softResourceLimits) {
    return { ...out, softResourceLimits: { ...spec.softResourceLimits } };
  }
  return out;
}

/** Validates a spec. Throws {@link LaunchAgentSpecError} on any violation. */
export function validateSpec(spec: LaunchAgentSpec): void {
  try {
    assertLabel(spec.label);
    assertAbsolute("program", spec.program);
    assertAbsolute("workingDirectory", spec.workingDirectory);
    assertAbsolute("stdoutPath", spec.stdoutPath);
    assertAbsolute("stderrPath", spec.stderrPath);
    if (spec.programArguments.length === 0) {
      throw new LaunchAgentSpecError("not_absolute", "programArguments must contain at least the executable");
    }
    // The first argument must be the executable itself — a shell wrapper
    // is never allowed. We check this before per-argument validation so
    // the error message specifically calls out the no-shell rule.
    if (spec.programArguments[0] !== spec.program) {
      throw new LaunchAgentSpecError(
        "not_absolute",
        "programArguments[0] must equal program (no shell, no wrapper)",
      );
    }
    for (const [index, arg] of spec.programArguments.entries()) {
      if (arg.includes("=") || arg.includes(" ")) {
        throw new LaunchAgentSpecError(
          "not_absolute",
          `programArguments[${index}] looks like a shell fragment: ${JSON.stringify(arg)}`,
        );
      }
      if (arg.startsWith("-")) continue; // flags are fine
      assertAbsolute(`programArguments[${index}]`, arg);
    }
    if (spec.processType && spec.processType !== "Background") {
      throw new LaunchAgentSpecError("not_absolute", `processType must be 'Background' (got ${spec.processType})`);
    }
    const pathValued = /^(?:HOME|TMPDIR|PATH|PI_MOB_.*_FILE)$/;
    for (const [key, value] of Object.entries(spec.environment)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value.length === 0 || /[\0\r\n]/.test(value)) {
        throw new LaunchAgentSpecError("not_absolute", `environment.${key} is invalid`);
      }
      if (pathValued.test(key)) {
        for (const component of key === "PATH" ? value.split(":") : [value]) {
          assertAbsolute(`environment.${key}`, component);
        }
      }
    }
  } catch (error) {
    if (error instanceof LaunchAgentSpecError) throw error;
    if (error instanceof InstallPathError) {
      throw new LaunchAgentSpecError(error.code, error.message);
    }
    throw error;
  }
}

/** Renders the spec into a launchd-compatible XML plist. */
export function renderPlist(spec: LaunchAgentSpec): string {
  const resolved = resolveLaunchAgentSpec(spec);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
  out.push('<plist version="1.0">');
  out.push("<dict>");
  out.push(`<key>Label</key><string>${escapeXml(resolved.label)}</string>`);
  out.push("<key>ProgramArguments</key>");
  out.push("<array>");
  for (const arg of resolved.programArguments) {
    out.push(`<string>${escapeXml(arg)}</string>`);
  }
  out.push("</array>");
  out.push(`<key>WorkingDirectory</key><string>${escapeXml(resolved.workingDirectory)}</string>`);
  out.push(`<key>EnvironmentVariables</key>`);
  out.push("<dict>");
  const envKeys = Object.keys(resolved.environment).sort();
  for (const key of envKeys) {
    out.push(`<key>${escapeXml(key)}</key><string>${escapeXml(resolved.environment[key]!)}</string>`);
  }
  out.push("</dict>");
  out.push(`<key>StandardOutPath</key><string>${escapeXml(resolved.stdoutPath)}</string>`);
  out.push(`<key>StandardErrorPath</key><string>${escapeXml(resolved.stderrPath)}</string>`);
  out.push(`<key>RunAtLoad</key><${resolved.runAtLoad}/>`);
  out.push(`<key>KeepAlive</key><${resolved.keepAlive}/>`);
  out.push(`<key>ProcessType</key><string>${escapeXml(resolved.processType)}</string>`);
  if (resolved.softResourceLimits) {
    out.push("<key>SoftResourceLimits</key><dict>");
    for (const [key, value] of Object.entries(resolved.softResourceLimits).sort()) {
      out.push(`<key>${escapeXml(key)}</key><integer>${Math.trunc(value)}</integer>`);
    }
    out.push("</dict>");
  }
  out.push("</dict>");
  out.push("</plist>");
  return out.join("\n");
}

/**
 * Validates the spec and writes the plist to `path` with `0o600` ownership.
 * The write is atomic on platforms that support rename; otherwise the file
 * is written directly and chmod'd.
 */
export function writePlist(path: string, spec: LaunchAgentSpec, fs: FileSystemPort): void {
  validateSpec(spec);
  const xml = renderPlist(spec);
  fs.writeFile(path, xml, FILE_MODE);
  fs.chmod(path, FILE_MODE);
}

/** XML escapes a string for inclusion inside an XML element or attribute. */
export function escapeXml(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    switch (ch) {
      case "&": out += "&amp;"; break;
      case "<": out += "&lt;"; break;
      case ">": out += "&gt;"; break;
      case "\"": out += "&quot;"; break;
      case "'": out += "&apos;"; break;
      default: out += ch;
    }
  }
  return out;
}
