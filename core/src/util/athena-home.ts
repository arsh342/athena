import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Athena's per-user data directory. Tests override it with ATHENA_HOME. */
export function athenaHome(): string {
  return process.env.ATHENA_HOME ?? join(homedir(), '.athena');
}

/** Stable key for a scanned root: SHA-1 hex of its canonical absolute path, so a symlinked spelling of the same directory shares state. */
export function repoKey(root: string): string {
  let canonical = resolve(root);
  try {
    canonical = realpathSync(canonical);
  } catch {
    // the directory may not exist (yet): fall back to the absolute path
  }
  return createHash('sha1').update(canonical).digest('hex');
}
