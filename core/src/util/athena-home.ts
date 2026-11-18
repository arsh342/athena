import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Athena's per-user data directory. Tests override it with ATHENA_HOME. */
export function athenaHome(): string {
  return process.env.ATHENA_HOME ?? join(homedir(), '.athena');
}

/** Stable key for a scanned root: SHA-1 hex of its absolute path. */
export function repoKey(root: string): string {
  return createHash('sha1').update(resolve(root)).digest('hex');
}
