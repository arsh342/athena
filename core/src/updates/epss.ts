import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { FEEDS } from './feeds.js';
import { vulndbDir } from './store.js';

export interface Epss { score: number; percentile: number }

/** Parse the FIRST CSV (`#model…` comment line, `cve,epss,percentile` header, rows). */
export function parseEpss(csv: string): { scoreDate: string; scores: Map<string, Epss> } {
  const scores = new Map<string, Epss>();
  let scoreDate = '';
  for (const line of csv.split('\n')) {
    if (line.startsWith('#')) {
      scoreDate = /score_date:([^,\s]+)/.exec(line)?.[1] ?? scoreDate;
      continue;
    }
    const [cve, score, pct] = line.split(',');
    if (cve?.startsWith('CVE-') && score && pct) scores.set(cve, { score: Number(score), percentile: Number(pct) });
  }
  return { scoreDate, scores };
}

export async function syncEpss(options: { url?: string; home?: string } = {}): Promise<{ scoreDate: string; total: number }> {
  const res = await fetch(options.url ?? FEEDS.epss, { headers: { 'user-agent': 'athena-cli' }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`EPSS: HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
  const parsed = parseEpss(text);
  if (parsed.scores.size === 0) throw new Error('EPSS: no scores in download');
  mkdirSync(vulndbDir(options.home), { recursive: true });
  const file = join(vulndbDir(options.home), 'epss.csv.gz');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(Buffer.from(text)));
  renameSync(tmp, file);
  epssCache.clear();
  return { scoreDate: parsed.scoreDate, total: parsed.scores.size };
}

const epssCache = new Map<string, Map<string, Epss> | null>();
export function loadEpss(home?: string): Map<string, Epss> | null {
  const file = join(vulndbDir(home), 'epss.csv.gz');
  if (!epssCache.has(file)) {
    try {
      epssCache.set(file, parseEpss(gunzipSync(readFileSync(file)).toString('utf8')).scores);
    } catch {
      epssCache.set(file, null);
    }
  }
  return epssCache.get(file)!;
}
