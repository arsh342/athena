import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { discoverManifests, readManifest } from '../deps/discover.js';
import { parseManifests } from '../deps/parsers/index.js';
import { syncEpss } from './epss.js';
import { OSV_ECOSYSTEMS } from './feeds.js';
import { syncKev } from './kev.js';
import { dbStatus, vulndbDir } from './store.js';
import { syncEcosystem, type SyncResult } from './sync-osv.js';

export const STALE_GAP_DAYS = 7;

export interface UpdateSummary {
  ecosystems: SyncResult[];
  kev: { total: number; added: string[] } | null;
  epss: { scoreDate: string; total: number } | null;
  errors: string[];
}

/** Ecosystems to keep current: those that already have a local database, plus those used by the project at `root`. */
export async function ecosystemsFor(root: string | null, home?: string): Promise<string[]> {
  const set = new Set(dbStatus(home).map((s) => s.eco));
  if (root) {
    const deps = await parseManifests(await discoverManifests(root), readManifest);
    for (const d of deps) if ((OSV_ECOSYSTEMS as readonly string[]).includes(d.ecosystem)) set.add(d.ecosystem);
  }
  return [...set].sort();
}

/** Age in hours of the oldest local ecosystem database (null when there is none). */
export function dataAgeHours(home?: string, now = Date.now()): number | null {
  const all = dbStatus(home);
  if (all.length === 0) return null;
  return Math.max(...all.map((s) => (now - Date.parse(s.updatedAt)) / 3_600_000));
}

export function needsUpdate(intervalHours: number, home?: string): boolean {
  const age = dataAgeHours(home);
  return age !== null && age >= intervalHours;
}

/** Single-flight lock: a second updater (another scan's background job) exits instead of running in parallel. */
function acquire(home?: string): (() => void) | null {
  mkdirSync(vulndbDir(home), { recursive: true });
  const file = join(vulndbDir(home), '.lock');
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs > 30 * 60_000) rmSync(file, { force: true });
  try {
    const fd = openSync(file, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    return null;
  }
  return () => rmSync(file, { force: true });
}

export function updateRunning(home?: string): boolean {
  const file = join(vulndbDir(home), '.lock');
  try {
    return Date.now() - statSync(file).mtimeMs < 30 * 60_000 && readFileSync(file, 'utf8') !== '';
  } catch {
    return false;
  }
}

export interface UpdateOptions {
  ecosystems: string[];
  home?: string;
  osvBase?: string;
  kevUrl?: string;
  epssUrl?: string;
  skipSignals?: boolean;
}

/** Sync every requested ecosystem plus KEV and EPSS. One failure does not stop the others. Returns null when another update holds the lock. */
export async function runUpdate(options: UpdateOptions): Promise<UpdateSummary | null> {
  const release = acquire(options.home);
  if (!release) return null;
  const summary: UpdateSummary = { ecosystems: [], kev: null, epss: null, errors: [] };
  try {
    for (const eco of options.ecosystems) {
      try {
        summary.ecosystems.push(await syncEcosystem(eco, { ...(options.osvBase ? { base: options.osvBase } : {}), ...(options.home ? { home: options.home } : {}) }));
      } catch (error) {
        summary.errors.push(`${eco}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!options.skipSignals) {
      try {
        summary.kev = await syncKev({ ...(options.kevUrl ? { url: options.kevUrl } : {}), ...(options.home ? { home: options.home } : {}) });
      } catch (error) {
        summary.errors.push(`KEV: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        summary.epss = await syncEpss({ ...(options.epssUrl ? { url: options.epssUrl } : {}), ...(options.home ? { home: options.home } : {}) });
      } catch (error) {
        summary.errors.push(`EPSS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    release();
  }
  return summary;
}

export function describeUpdate(s: UpdateSummary): string[] {
  const lines: string[] = [];
  const added = s.ecosystems.reduce((n, e) => n + e.added, 0);
  const updated = s.ecosystems.reduce((n, e) => n + e.updated, 0);
  const removed = s.ecosystems.reduce((n, e) => n + e.removed, 0);
  for (const e of s.ecosystems) lines.push(`${e.eco}: ${e.mode === 'none' ? 'up to date' : `${e.mode} sync, +${e.added} new, ${e.updated} changed, ${e.removed} withdrawn`} (${e.records} advisories)`);
  lines.push(`+${added} advisories${updated ? `, ${updated} changed` : ''}${removed ? `, ${removed} withdrawn` : ''}${s.kev ? `, ${s.kev.added.length} newly known-exploited` : ''}`);
  for (const e of s.errors) lines.push(`error: ${e}`);
  return lines;
}
