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
