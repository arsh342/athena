import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

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

export function isExcludedPath(filePath: string, root: string, excludes: string[] = []): boolean {
  if (excludes.length === 0) return false;

  const normalizedRelativePath = relative(root, filePath).split('\\').join('/');
  const relativeSegments = normalizedRelativePath.split('/').filter(Boolean);

  return excludes.some((pattern) => {
    const normalizedPattern = pattern.replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalizedPattern) return false;

    const patternSegments = normalizedPattern.split('/').filter(Boolean);
    if (patternSegments.length === 1) {
      return relativeSegments.includes(patternSegments[0]);
    }

    return (
      normalizedRelativePath === normalizedPattern
      || normalizedRelativePath.startsWith(`${normalizedPattern}/`)
      || normalizedRelativePath.includes(`/${normalizedPattern}/`)
    );
  });
}

export async function findSourceFiles(root: string, excludes: string[] = []): Promise<string[]> {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat) return [];
  if (rootStat.isFile()) return isSourceFile(root) && !isExcludedPath(root, root, excludes) ? [root] : [];

  const output: string[] = [];
  await walk(root, root, output, excludes);
  return output;
}

async function walk(dir: string, root: string, output: string[], excludes: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name) && !isExcludedPath(fullPath, root, excludes)) {
        await walk(fullPath, root, output, excludes);
      }
      continue;
    }

    if (entry.isFile() && isSourceFile(fullPath) && !isExcludedPath(fullPath, root, excludes)) {
      output.push(fullPath);
    }
  }
}
