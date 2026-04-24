import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getGitHooksDir, getGitRoot } from '../utils/git.js';

export async function initCommand(): Promise<void> {
  const root = await getGitRoot();
  const hooksDir = await getGitHooksDir();
  if (!root || !hooksDir) {
    console.error('Athena needs a git repository for pre-commit hook install.');
    process.exitCode = 1;
    return;
  }

  const hookPath = join(hooksDir, 'pre-commit');
  const hook = [
    '#!/bin/sh',
    'echo "athena: checking staged JS/TS files"',
    'npx athena check',
  ].join('\n');

  await mkdir(dirname(hookPath), { recursive: true });
  await writeFile(hookPath, `${hook}\n`, { mode: 0o755 });
  console.log(`Athena pre-commit hook installed at ${hookPath}`);
}
