import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGitHooksDir, getGitRoot } from '../utils/git.js';
import { isAthenaHook } from '../utils/hooks.js';

/** Removes only hooks Athena wrote (marked); anything else is left alone. */
export async function uninstallCommand(): Promise<void> {
  const root = await getGitRoot();
  const hooksDir = await getGitHooksDir();
  if (!root || !hooksDir) {
    console.error('Athena needs a git repository for hook uninstall.');
    process.exitCode = 1;
    return;
  }
  let removed = 0;
  for (const name of ['pre-commit', 'pre-push']) {
    const path = join(root, hooksDir, name);
    if (existsSync(path) && isAthenaHook(path)) {
      await rm(path, { force: true });
      console.log(`Athena ${name} hook removed from ${path}`);
      removed += 1;
    } else if (existsSync(path)) console.log(`${path} is not Athena's; left unchanged`);
  }
  if (removed === 0) console.log('No Athena hooks found.');
}
