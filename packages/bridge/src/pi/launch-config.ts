export interface PiLaunchConfig {
  readonly executable: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export function resolvePiLaunchConfig(opts: {
  executable: string;
  cwd: string;
  args?: readonly string[];
  env: Readonly<Record<string, string>>;
}): PiLaunchConfig {
  return Object.freeze({
    executable: opts.executable,
    cwd: opts.cwd,
    args: Object.freeze([...(opts.args ?? [])]),
    env: Object.freeze({ ...opts.env }),
  });
}
