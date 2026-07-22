import { describe, expect, test } from "bun:test";
import { GitSummaryService, validateGitHttpsUrl, type GitCommandRunner } from "../src/git/summary-service";

const runner = (outputs: Record<string, { code: number; stdout: string; stderr?: string }>): GitCommandRunner => ({
  async run(_command, args) { const key = args.join(' '); return outputs[key] ?? { code: 1, stdout: '', stderr: 'missing' }; },
});

test('validates HTTPS links and rejects credentials/control characters', () => {
  expect(validateGitHttpsUrl('https://github.com/acme/repo')).toBe('https://github.com/acme/repo');
  expect(validateGitHttpsUrl('http://github.com/acme/repo')).toBeNull();
  expect(validateGitHttpsUrl('https://u:p@github.com/acme/repo')).toBeNull();
  expect(validateGitHttpsUrl('https://github.com/acme/repo\n')).toBeNull();
});

test('builds clean attached summary with injected commands and clock', async () => {
  const service = new GitSummaryService({ runner: runner({
    'rev-parse --show-toplevel': { code: 0, stdout: '/repo\n' }, 'remote get-url origin': { code: 0, stdout: 'git@github.com:acme/repo.git\n' },
    'log -1 --format=%H%x00%s%x00%an%x00%aI': { code: 0, stdout: 'abcdef1234567\0First commit\0A. Author\x002026-01-01T00:00:00+00:00\n' },
    'symbolic-ref --quiet --short HEAD': { code: 0, stdout: 'main\n' }, 'status --porcelain=v1 -z --untracked-files=normal': { code: 0, stdout: '' }, 'rev-list --left-right --count HEAD...@{upstream}': { code: 0, stdout: '2 3\n' },
  }), now: () => new Date('2026-01-02T00:00:00Z') });
  const result = await service.summarize('workspace', '/repo');
  expect(result).toMatchObject({ repository: 'acme/repo', detached: false, branch: 'main', workingTreeState: 'clean', ahead: 2, behind: 3 });
});

test('returns explicit unavailable state for missing remote', async () => {
  const result = await new GitSummaryService({ runner: runner({ 'rev-parse --show-toplevel': { code: 0, stdout: '/repo' } }) }).summarize('w', '/repo');
  expect(result).toMatchObject({ status: 'unavailable', reason: 'remote_missing' });
});

describe('provider failure', () => test('does not fabricate CI', async () => {
  const base: Record<string, { code: number; stdout: string }> = { 'rev-parse --show-toplevel': { code: 0, stdout: '/repo' }, 'remote get-url origin': { code: 0, stdout: 'https://github.com/a/r' }, 'log -1 --format=%H%x00%s%x00%an%x00%aI': { code: 0, stdout: 'abcdef1\0x\0a\x002026-01-01T00:00:00Z' }, 'symbolic-ref --quiet --short HEAD': { code: 0, stdout: 'main' }, 'status --porcelain=v1 -z --untracked-files=normal': { code: 0, stdout: '' }, 'rev-list --left-right --count HEAD...@{upstream}': { code: 0, stdout: '0 0' } };
  const result = await new GitSummaryService({ runner: runner(base), provider: { summary: async () => { throw new Error('offline'); } } }).summarize('w', '/repo');
  expect(result).toMatchObject({ status: 'unavailable', reason: 'provider_unavailable' });
}));
