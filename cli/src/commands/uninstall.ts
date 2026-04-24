import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getGitHooksDir, getGitRoot } from '../utils/git.js';

export async function uninstallCommand(): Promise<void> {
  const root = await getGitRoot();
  const hooksDir = await getGitHooksDir();
  if (!root || !hooksDir) {
    console.error('Athena needs a git repository for hook uninstall.');
    process.exitCode = 1;
    return;
  }

  const hookPath = join(hooksDir, 'pre-commit');
  await rm(hookPath, { force: true });
  console.log(`Athena pre-commit hook removed from ${hookPath}`);
}
