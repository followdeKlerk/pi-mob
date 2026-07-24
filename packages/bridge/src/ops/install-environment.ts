/**
 * Test-only environment builder retained for fixture construction.
 * Production setup captures the owner's complete login-shell environment in
 * `login-env.ts`; do not use this helper in production code.
 */
export function buildChildEnvironment(
  parent: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
  pathDirs: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = parent[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  if (pathDirs.length > 0) env.PATH = pathDirs.join(":");
  return env;
}
