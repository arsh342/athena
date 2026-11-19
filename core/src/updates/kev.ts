import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FEEDS } from './feeds.js';
import { vulndbDir } from './store.js';

export interface KevData { fetchedAt: string; catalogVersion: string; cves: Record<string, string> }

function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Download the CISA KEV catalogue; returns the CVEs newly added since the previous copy. */
export async function syncKev(options: { url?: string; home?: string; now?: () => number } = {}): Promise<{ total: number; added: string[] }> {
  const res = await fetch(options.url ?? FEEDS.kev, { headers: { 'user-agent': 'athena-cli' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`KEV: HTTP ${res.status}`);
  const json = (await res.json()) as { catalogVersion?: string; vulnerabilities?: Array<{ cveID?: string; dateAdded?: string }> };
  const cves: Record<string, string> = {};
  for (const v of json.vulnerabilities ?? []) if (v.cveID) cves[v.cveID] = v.dateAdded ?? '';
  const previous = loadKev(options.home);
  const added = Object.keys(cves).filter((c) => !previous || !(c in previous.cves));
  mkdirSync(vulndbDir(options.home), { recursive: true });
  atomicWrite(join(vulndbDir(options.home), 'kev.json'), JSON.stringify({ fetchedAt: new Date((options.now ?? Date.now)()).toISOString(), catalogVersion: json.catalogVersion ?? '', cves } satisfies KevData));
  kevCache.clear();
  return { total: Object.keys(cves).length, added: previous ? added : [] };
}

const kevCache = new Map<string, KevData | null>();
export function loadKev(home?: string): KevData | null {
  const file = join(vulndbDir(home), 'kev.json');
  if (!kevCache.has(file)) {
    try {
      kevCache.set(file, JSON.parse(readFileSync(file, 'utf8')) as KevData);
    } catch {
      kevCache.set(file, null);
    }
  }
  return kevCache.get(file)!;
}
