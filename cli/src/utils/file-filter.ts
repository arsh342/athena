import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const supported = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ignoredDirs = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.vercel',
  '.vscode',
  '.idea',
  'tmp',
  'temp',
  'out',
]);

export function isSourceFile(filePath: string): boolean {
  return [...supported].some((ext) => filePath.endsWith(ext));
}

export async function findSourceFiles(root: string): Promise<string[]> {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat) return [];
  if (rootStat.isFile()) return isSourceFile(root) ? [root] : [];

  const output: string[] = [];
  await walk(root, output);
  return output;
}

async function walk(dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await walk(join(dir, entry.name), output);
      continue;
    }

    const filePath = join(dir, entry.name);
    if (entry.isFile() && isSourceFile(filePath)) output.push(filePath);
  }
}
