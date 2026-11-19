import { open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { hasExtension, isSupportedSource, languageFromShebang } from '@athena/core';
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
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'vendor',
]);

/** Extension-based check (no file read). Extensionless shebang scripts need isSourceCandidate. */
export function isSourceFile(filePath: string): boolean {
  return isSupportedSource(filePath);
}

/** Supported extension, or an extensionless file whose first line is a known shebang. */
export async function isSourceCandidate(filePath: string): Promise<boolean> {
  if (isSupportedSource(filePath)) return true;
  if (hasExtension(filePath)) return false;
  return languageFromShebang(await readFirstLine(filePath)) !== null;
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return text.split('\n', 1)[0] ?? '';
  } finally {
    await handle.close();
  }
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
    if (await isSourceCandidate(root)) (isExcludedPath(root, root, excludes) ? result.excluded : result.files).push(root);
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

    if (entry.isFile() && (await isSourceCandidate(fullPath))) {
      (underExcluded || isExcludedPath(fullPath, root, excludes) ? result.excluded : result.files).push(fullPath);
    }
  }
}
