import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { MANIFEST_FILE } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', '.tox', '.next', 'bower_components', '.gradle', 'obj', 'bin', 'Pods']);
const MAX_MANIFESTS = 400;
const MAX_BYTES = 40 * 1024 * 1024;

/** Find manifests and lockfiles under `root` (bounded depth and count; vendored directories skipped). */
export async function discoverManifests(root: string, maxDepth = 8): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || found.length >= MAX_MANIFESTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= MAX_MANIFESTS) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
      } else if (e.isFile() && MANIFEST_FILE.test(e.name)) {
        found.push(full);
      }
    }
  };
  await walk(root, 0);
  return found.sort();
}

/** Read a manifest, refusing absurdly large files. */
export async function readManifest(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export const relManifest = (root: string, path: string): string => relative(root, path).split('\\').join('/');

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go)$/;

/** JS/TS, Python and Go sources under `root` (vendored directories skipped; bounded). */
export async function discoverSources(root: string, limit = 5000): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || found.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
      } else if (e.isFile() && SOURCE_EXT.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.min\./.test(e.name)) found.push(full);
    }
  };
  await walk(root, 0);
  return found.sort();
}
