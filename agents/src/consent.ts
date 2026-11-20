import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { athenaHome, repoKey } from '@athena/core';

import type { Caps, ProviderId } from './types.js';

export interface ConsentKey {
  root: string;
  provider: ProviderId;
  endpoint: string;
  home?: string;
}

const file = (home = athenaHome()): string => join(home, 'consent.json');
const keyOf = (c: ConsentKey): string => `${repoKey(c.root)}:${c.provider}:${c.endpoint}`;

function read(home?: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(home), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function needsConsent(c: ConsentKey): boolean {
  return !(keyOf(c) in read(c.home));
}

export function recordConsent(c: ConsentKey): void {
  const store = read(c.home);
  store[keyOf(c)] = new Date().toISOString();
  const home = c.home ?? athenaHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = `${file(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file(home));
}

const money = (n: number): string => `$${n.toFixed(2)}`;
const capText = (caps: Caps, which: 'run' | 'day'): string => (caps.unit === 'usd' ? `${money(caps[which])} per ${which}` : `${caps[which].toLocaleString('en-US')} tokens per ${which}`);

/** What the first AI run in a repository tells the user before anything is sent. */
export function consentNotice(input: { provider: ProviderId; model: string; endpoint: string; local: boolean; caps: Caps }): string {
  const lines = ['Athena AI verification'];
  if (input.local) {
    lines.push(`  Model ${input.model} at ${input.endpoint}: your code stays on this machine.`);
  } else {
    lines.push(`  Short excerpts of your code around each finding (the flagged function, its data flow and nearby files) are sent to ${input.endpoint} (${input.provider}, model ${input.model}).`);
  }
  lines.push(`  Spending is capped at ${capText(input.caps, 'run')} and ${capText(input.caps, 'day')}; the run stops when a cap is reached.`);
  lines.push('  Repository text is treated as data, never as instructions.');
  return lines.join('\n');
}
