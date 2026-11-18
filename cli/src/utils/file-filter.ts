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

export interface SourceDiscovery {
  files: string[];
  /** Source files left out by configured excludes; reported in coverage, never silently dropped. */
  excluded: string[];
}

export async function findSourceFilesWithExclusions(root: string, excludes: string[] = []): Promise<SourceDiscovery> {
  const rootStat = await stat(root).catch(() => null);
  const result: SourceDiscovery = { files: [], excluded: [] };
  if (!rootStat) return result;
  if (rootStat.isFile()) {
    if (isSourceFile(root)) (isExcludedPath(root, root, excludes) ? result.excluded : result.files).push(root);
    return result;
  }
  await walk(root, root, result, excludes, false);
  return result;
}

export async function findSourceFiles(root: string, excludes: string[] = []): Promise<string[]> {
  return (await findSourceFilesWithExclusions(root, excludes)).files;
}

async function walk(dir: string, root: string, result: SourceDiscovery, excludes: string[], underExcluded: boolean): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      await walk(fullPath, root, result, excludes, underExcluded || isExcludedPath(fullPath, root, excludes));
      continue;
    }

    if (entry.isFile() && isSourceFile(fullPath)) {
      (underExcluded || isExcludedPath(fullPath, root, excludes) ? result.excluded : result.files).push(fullPath);
    }
  }
}
