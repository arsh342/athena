import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { athenaHome, repoKey, type ScanReport } from '@athena/core';

function lastScanPath(root: string): string {
  return join(athenaHome(), 'last-scan', `${repoKey(root)}.json`);
}

/** Saves the report `athena explain` reads. Keyed by the scanned root. */
export async function saveLastScan(root: string, report: ScanReport): Promise<void> {
  const file = lastScanPath(root);
  await mkdir(join(athenaHome(), 'last-scan'), { recursive: true });
  await writeFile(file, JSON.stringify({ root: resolve(root), savedAt: new Date().toISOString(), report }));
}

export async function loadLastScan(root: string): Promise<ScanReport | null> {
  try {
    const parsed = JSON.parse(await readFile(lastScanPath(root), 'utf8')) as { report?: ScanReport };
    return parsed.report ?? null;
  } catch {
    return null;
  }
}
