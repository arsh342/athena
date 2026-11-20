import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { athenaHome } from '@athena/core';

import type { ProviderId } from './types.js';

export interface LedgerOptions {
  home?: string;
  now?: () => Date;
}

interface Entry { usd: number; tokens: number }
type Ledger = Record<string, Partial<Record<ProviderId, Entry>>>;

const KEEP_DAYS = 40;

/** Calendar day in the user's local time zone: the ledger rolls over at local midnight. */
export function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const file = (home = athenaHome()): string => join(home, 'usage.json');

function read(home?: string): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(file(home), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

function write(ledger: Ledger, home = athenaHome()): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = `${file(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file(home));
}

export function spentToday(provider: ProviderId, options: LedgerOptions = {}): Entry {
  const day = localDay((options.now ?? (() => new Date()))());
  const entry = read(options.home)[day]?.[provider];
  return { usd: entry?.usd ?? 0, tokens: entry?.tokens ?? 0 };
}

export function recordSpend(provider: ProviderId, spend: Entry, options: LedgerOptions = {}): void {
  const now = (options.now ?? (() => new Date()))();
  const ledger = read(options.home);
  const day = localDay(now);
  const entry = ledger[day]?.[provider] ?? { usd: 0, tokens: 0 };
  ledger[day] = { ...(ledger[day] ?? {}), [provider]: { usd: entry.usd + spend.usd, tokens: entry.tokens + spend.tokens } };
  const keep = Object.keys(ledger).sort().slice(-KEEP_DAYS).filter((d) => (now.getTime() - new Date(`${d}T00:00:00`).getTime()) / 86_400_000 < KEEP_DAYS);
  write(Object.fromEntries(Object.entries(ledger).filter(([d]) => keep.includes(d))), options.home);
}

export function summary(provider: ProviderId, options: LedgerOptions = {}): { days: Array<{ day: string; usd: number; tokens: number }> } {
  const ledger = read(options.home);
  return { days: Object.keys(ledger).sort().filter((d) => ledger[d]?.[provider]).map((d) => ({ day: d, usd: ledger[d]![provider]!.usd, tokens: ledger[d]![provider]!.tokens })) };
}
