import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { athenaHome } from '../util/athena-home.js';

export interface SlimVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { ecosystem?: string; name?: string };
    ranges?: Array<{ type?: string; events?: Array<Record<string, string>> }>;
    versions?: string[];
    ecosystem_specific?: { affected_functions?: string[]; imports?: Array<{ symbols?: string[] }> };
  }>;
  modified?: string;
  withdrawn?: string;
}

export interface DbMeta {
  eco: string;
  /** Wall-clock time of the last successful sync. */
  updatedAt: string;
  /** Newest OSV `modified` timestamp already included. */
  lastModified: string;
  records: number;
}

export const vulndbDir = (home = athenaHome()): string => join(home, 'vulndb');
const ecoDir = (eco: string, home?: string): string => join(vulndbDir(home), eco);

/** Keep only what matching needs; `details`, references and credits are dropped (about 10x smaller). */
export function slim(v: Record<string, unknown>): SlimVuln {
  const src = v as unknown as SlimVuln & { affected?: Array<Record<string, unknown>> };
  return {
    id: src.id,
    ...(src.aliases?.length ? { aliases: src.aliases } : {}),
    ...(src.summary ? { summary: String(src.summary).slice(0, 200) } : {}),
    ...(src.severity?.length ? { severity: src.severity.filter((s) => s.type?.startsWith('CVSS_V3')).slice(0, 1) } : {}),
    ...(src.database_specific?.severity ? { database_specific: { severity: src.database_specific.severity } } : {}),
    affected: (src.affected ?? []).map((a) => ({
      ...(a.package ? { package: { ecosystem: (a.package as { ecosystem?: string }).ecosystem, name: (a.package as { name?: string }).name } } : {}),
      ...(a.ranges ? { ranges: (a.ranges as SlimVuln['affected'] extends Array<infer X> ? X extends { ranges?: infer R } ? R : never : never) } : {}),
      ...(Array.isArray(a.versions) && (a.versions as string[]).length <= 2000 ? { versions: a.versions as string[] } : {}),
      ...(a.ecosystem_specific ? { ecosystem_specific: a.ecosystem_specific as never } : {}),
    })),
    ...(src.modified ? { modified: src.modified } : {}),
    ...(src.withdrawn ? { withdrawn: src.withdrawn } : {}),
  };
}

export function readMeta(eco: string, home?: string): DbMeta | null {
  try {
    return JSON.parse(readFileSync(join(ecoDir(eco, home), 'meta.json'), 'utf8')) as DbMeta;
  } catch {
    return null;
  }
}

export function loadRecords(eco: string, home?: string): Map<string, SlimVuln> {
  const map = new Map<string, SlimVuln>();
  const file = join(ecoDir(eco, home), 'data.ndjson.gz');
  if (!existsSync(file)) return map;
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const v = JSON.parse(line) as SlimVuln;
      map.set(v.id, v);
    } catch {
      // a damaged line costs one record, not the database
    }
  }
  return map;
}

/** Write data then metadata via temp files and renames, so an interrupted sync leaves the previous database in use. */
export function saveRecords(eco: string, records: Map<string, SlimVuln>, meta: DbMeta, home?: string): void {
  const dir = ecoDir(eco, home);
  mkdirSync(dir, { recursive: true });
  const body = gzipSync(Buffer.from([...records.values()].map((r) => JSON.stringify(r)).join('\n')));
  const dataTmp = join(dir, `data.ndjson.gz.${process.pid}.tmp`);
  const metaTmp = join(dir, `meta.json.${process.pid}.tmp`);
  try {
    writeFileSync(dataTmp, body);
    writeFileSync(metaTmp, JSON.stringify(meta));
    renameSync(dataTmp, join(dir, 'data.ndjson.gz'));
    renameSync(metaTmp, join(dir, 'meta.json'));
  } finally {
    rmSync(dataTmp, { force: true });
    rmSync(metaTmp, { force: true });
  }
}

export function dbStatus(home?: string): Array<{ eco: string; updatedAt: string; records: number; ageDays: number }> {
  const root = vulndbDir(home);
  if (!existsSync(root)) return [];
  const out: Array<{ eco: string; updatedAt: string; records: number; ageDays: number }> = [];
  for (const eco of ['npm', 'PyPI', 'Maven', 'NuGet', 'Go', 'crates.io', 'Packagist']) {
    const meta = readMeta(eco, home);
    if (meta && statSync(join(root, eco)).isDirectory()) out.push({ eco, updatedAt: meta.updatedAt, records: meta.records, ageDays: (Date.now() - Date.parse(meta.updatedAt)) / 86_400_000 });
  }
  return out;
}
