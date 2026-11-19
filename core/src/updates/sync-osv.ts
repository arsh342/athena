import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { FEEDS } from './feeds.js';
import { loadRecords, readMeta, saveRecords, slim, type SlimVuln } from './store.js';
import { zipEntries } from './zip.js';

export interface SyncOptions {
  /** OSV export base URL (tests point this at a local server). */
  base?: string;
  home?: string;
  concurrency?: number;
  /** More changed records than this falls back to a full download. */
  maxIncremental?: number;
  now?: () => number;
}

export interface SyncResult {
  eco: string;
  mode: 'full' | 'incremental' | 'none';
  added: number;
  updated: number;
  removed: number;
  records: number;
  updatedAt: string;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'athena-cli' }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

/** `<iso>,<id>` lines, newest first. */
function parseModified(csv: string): Array<{ at: string; id: string }> {
  return csv.split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf(',');
    return { at: l.slice(0, i), id: l.slice(i + 1).trim() };
  });
}

export async function syncEcosystem(eco: string, options: SyncOptions = {}): Promise<SyncResult> {
  const base = options.base ?? FEEDS.osvExport;
  const now = (options.now ?? Date.now)();
  const meta = readMeta(eco, options.home);
  const modified = parseModified(await getText(`${base}/${eco}/modified_id.csv`));
  const newest = modified[0]?.at ?? meta?.lastModified ?? new Date(now).toISOString();
  let records: Map<string, SlimVuln>;
  let added = 0;
  let updated = 0;
  let removed = 0;
  let mode: SyncResult['mode'] = 'incremental';

  const changed = meta ? modified.filter((m) => m.at > meta.lastModified) : [];
  if (meta && changed.length === 0) {
    return { eco, mode: 'none', added: 0, updated: 0, removed: 0, records: meta.records, updatedAt: meta.updatedAt };
  }
  if (!meta || changed.length > (options.maxIncremental ?? 3000)) {
    mode = 'full';
    records = new Map();
    const dir = mkdtempSync(join(tmpdir(), 'athena-osv-'));
    try {
      const zipPath = join(dir, 'all.zip');
      const res = await fetch(`${base}/${eco}/all.zip`, { headers: { 'user-agent': 'athena-cli' } });
      if (!res.ok || !res.body) throw new Error(`${base}/${eco}/all.zip: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
      for await (const entry of zipEntries(zipPath)) {
        if (!entry.name.endsWith('.json')) continue;
        const v = slim(JSON.parse((await entry.read()).toString('utf8')));
        if (v.withdrawn) continue;
        records.set(v.id, v);
        added += 1;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    records = loadRecords(eco, options.home);
    const ids = [...new Set(changed.map((c) => c.id))];
    const fetched = new Map<string, SlimVuln | null>();
    await pool(ids, options.concurrency ?? 8, async (id) => {
      const res = await fetch(`${base}/${eco}/${encodeURIComponent(id)}.json`, { headers: { 'user-agent': 'athena-cli' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) fetched.set(id, null);
      else if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
      else fetched.set(id, slim((await res.json()) as Record<string, unknown>));
    });
    for (const [id, v] of fetched) {
      if (!v || v.withdrawn) {
        if (records.delete(id)) removed += 1;
      } else {
        if (records.has(id)) updated += 1;
        else added += 1;
        records.set(id, v);
      }
    }
  }
  const updatedAt = new Date(now).toISOString();
  saveRecords(eco, records, { eco, updatedAt, lastModified: newest, records: records.size }, options.home);
  return { eco, mode, added, updated, removed, records: records.size, updatedAt };
}
