import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { athenaHome } from '@athena/core';

import type { AiVerdict, VerdictCache } from './verify.js';

const dir = (home = athenaHome()): string => join(home, 'cache', 'ai');
const valid = (v: unknown): v is AiVerdict => !!v && typeof v === 'object' && ['confirmed', 'refuted', 'needs-human'].includes((v as AiVerdict).verdict) && typeof (v as AiVerdict).reason === 'string';

/** Verdicts keyed by sha256(pack + provider + model + prompt version). A damaged or unexpected entry is just a miss. */
export function fileVerdictCache(home?: string): VerdictCache {
  return {
    get(key) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir(home), `${key}.json`), 'utf8')) as unknown;
        return valid(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        mkdirSync(dir(home), { recursive: true, mode: 0o700 });
        const file = join(dir(home), `${key}.json`);
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
      } catch {
        // the cache is best effort
      }
    },
  };
}

/** Delete entries older than `maxAgeDays` (default 30). */
export function pruneCache(home?: string, maxAgeDays = 30, now = Date.now()): number {
  let removed = 0;
  try {
    for (const name of readdirSync(dir(home))) {
      const file = join(dir(home), name);
      if (now - statSync(file).mtimeMs > maxAgeDays * 86_400_000) {
        unlinkSync(file);
        removed += 1;
      }
    }
  } catch {
    // no cache yet
  }
  return removed;
}
