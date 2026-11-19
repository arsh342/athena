import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Ecosystem } from './types.js';

const FILES: Partial<Record<Ecosystem, string>> = { npm: 'popular-npm.json', PyPI: 'popular-pypi.json', 'crates.io': 'popular-crates.json', Packagist: 'popular-packagist.json', NuGet: 'popular-nuget.json' };
const cache = new Map<string, string[] | null>();

function dataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'data');
}

export function popularList(ecosystem: Ecosystem, dir = dataDir()): string[] | null {
  const file = FILES[ecosystem];
  if (!file) return null;
  const key = `${dir}/${file}`;
  if (!cache.has(key)) {
    try {
      cache.set(key, JSON.parse(readFileSync(join(dir, file), 'utf8')) as string[]);
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key)!;
}

/** Damerau-Levenshtein (optimal string alignment) distance, early-exit above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

const squash = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, '');
const HOMOGLYPH: Record<string, string> = { '0': 'o', '1': 'l', '5': 's', rn: 'm', vv: 'w' };

/** The popular package `name` looks like a typo or lookalike of, or null. */
export function typosquatOf(ecosystem: Ecosystem, name: string, list: string[] | null = popularList(ecosystem)): string | null {
  if (!list || list.length === 0) return null;
  const bare = name.replace(/^@[^/]+\//, '');
  if (bare.length < 4) return null;
  const set = new Set(list);
  if (set.has(name) || set.has(bare)) return null;
  const sq = squash(bare);
  let homo = sq;
  for (const [from, to] of Object.entries(HOMOGLYPH)) homo = homo.split(from).join(to);
  const max = bare.length >= 9 ? 2 : 1;
  for (const popular of list) {
    // Scoped names are only compared within the same scope: `@acme/core` is not a typo of `@babel/core`.
    const scopeOf = (n: string): string => (n.startsWith('@') ? n.slice(0, n.indexOf('/')) : '');
    if (scopeOf(popular) !== scopeOf(name)) continue;
    const pb = popular.replace(/^@[^/]+\//, '');
    if (Math.abs(pb.length - bare.length) > max) continue;
    if (squash(pb) === sq || squash(pb) === homo) return popular; // separator swap or homoglyph
    if (bare.length >= 5 && pb.length >= 4 && editDistance(bare.toLowerCase(), pb.toLowerCase(), max) <= max) return popular;
  }
  return null;
}
