import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function logGitWarning(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[athena-cli] ${context}: ${message}`);
}

export async function getGitRoot(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch (error) {
    logGitWarning('Unable to resolve git root', error);
    return null;
  }
}

export async function getGitHooksDir(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks']);
    return stdout.trim();
  } catch (error) {
    logGitWarning('Unable to resolve git hooks directory', error);
    return null;
  }
}

export async function getStagedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    logGitWarning('Unable to read staged files', error);
    return [];
  }
}

/** Git top-level for a directory, or null outside git. Silent: not being in git is normal. */
export async function getGitTopLevel(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

export type ReviewScope = { kind: 'staged' } | { kind: 'uncommitted' } | { kind: 'range'; range: string } | { kind: 'base'; base: string };

const SAFE_REV = /^[\w@{}./~^:+-]+(?:\.\.\.?[\w@{}./~^:+-]+)?$/;

/** Unified diff (zero context, renames detected) for a review scope, plus untracked files for `uncommitted`. */
export async function getReviewDiff(scope: ReviewScope, cwd: string): Promise<{ diff: string; untracked: string[]; label: string }> {
  const base = ['diff', '--unified=0', '-M', '--no-color', '--no-ext-diff'];
  switch (scope.kind) {
    case 'staged':
      return { diff: await git([...base, '--cached'], cwd), untracked: [], label: 'staged changes' };
    case 'uncommitted': {
      const head = await git(['rev-parse', '--verify', '-q', 'HEAD'], cwd).then(() => true, () => false);
      const diff = await git(head ? [...base, 'HEAD'] : [...base, '--cached'], cwd);
      const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'], cwd)).split('\0').filter(Boolean);
      return { diff, untracked, label: 'uncommitted changes' };
    }
    case 'range': {
      if (!SAFE_REV.test(scope.range) || scope.range.startsWith('-')) throw new Error(`invalid range "${scope.range}"`);
      return { diff: await git([...base, scope.range, '--'], cwd), untracked: [], label: `range ${scope.range}` };
    }
    case 'base': {
      if (!SAFE_REV.test(scope.base) || scope.base.startsWith('-')) throw new Error(`invalid base "${scope.base}"`);
      return { diff: await git([...base, `${scope.base}...HEAD`, '--'], cwd), untracked: [], label: `changes since ${scope.base}` };
    }
  }
}
