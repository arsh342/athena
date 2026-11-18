import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface FixtureCommit {
  files: Record<string, string>;
  message: string;
  author?: string;
  email?: string;
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
}

export function makeRepo(dir: string, commits: FixtureCommit[]): void {
  git(dir, 'init', '-q', '-b', 'main');
  for (const commit of commits) {
    for (const [name, body] of Object.entries(commit.files)) {
      const full = join(dir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
      git(dir, 'add', name);
    }
    const author = `${commit.author ?? 'Human Dev'} <${commit.email ?? 'human@example.com'}>`;
    git(dir, 'commit', '-q', '-m', commit.message, '--author', author);
  }
}
