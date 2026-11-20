import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { localDay, recordSpend, spentToday, summary } from '../src/usage.ts';

const home = () => mkdtempSync(join(tmpdir(), 'agents-usage-'));

test('the day ledger sums per provider and rolls over at local midnight', () => {
  const h = home();
  const late = new Date(2026, 10, 19, 23, 59, 0);
  const early = new Date(2026, 10, 20, 0, 1, 0);
  recordSpend('anthropic', { usd: 0.1, tokens: 1000 }, { home: h, now: () => late });
  recordSpend('anthropic', { usd: 0.2, tokens: 2000 }, { home: h, now: () => late });
  recordSpend('openai', { usd: 0.05, tokens: 500 }, { home: h, now: () => late });
  assert.deepEqual(spentToday('anthropic', { home: h, now: () => late }), { usd: 0.30000000000000004, tokens: 3000 });
  assert.deepEqual(spentToday('openai', { home: h, now: () => late }), { usd: 0.05, tokens: 500 });
  assert.deepEqual(spentToday('anthropic', { home: h, now: () => early }), { usd: 0, tokens: 0 });
  recordSpend('anthropic', { usd: 0.4, tokens: 10 }, { home: h, now: () => early });
  assert.equal(spentToday('anthropic', { home: h, now: () => early }).usd, 0.4);
  assert.equal(localDay(late), '2026-11-19');
  assert.equal(localDay(early), '2026-11-20');
});

test('the ledger file is private and old days are pruned', () => {
  const h = home();
  recordSpend('anthropic', { usd: 1, tokens: 1 }, { home: h, now: () => new Date(2026, 0, 1) });
  recordSpend('anthropic', { usd: 1, tokens: 1 }, { home: h, now: () => new Date(2026, 11, 1) });
  const info = summary('anthropic', { home: h, now: () => new Date(2026, 11, 1) });
  assert.equal(info.days.length, 1);
  assert.equal(statSync(join(h, 'usage.json')).mode & 0o777, 0o600);
});

test('a damaged ledger does not crash or reset to a lower number silently: it reads as empty and is rewritten on the next spend', () => {
  const h = home();
  recordSpend('anthropic', { usd: 0.3, tokens: 1 }, { home: h });
  const { writeFileSync } = require_fs();
  writeFileSync(join(h, 'usage.json'), '{not json');
  assert.deepEqual(spentToday('anthropic', { home: h }), { usd: 0, tokens: 0 });
  recordSpend('anthropic', { usd: 0.1, tokens: 1 }, { home: h });
  assert.equal(spentToday('anthropic', { home: h }).usd, 0.1);
});
import * as fs from 'node:fs';
function require_fs(): typeof fs { return fs; }
