import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultConfig } from '../config.js';
import type { LanguageId } from '../lang/languages.js';
import { encodeCheckSet } from '../learning/check-set.js';
import type { CheckSet } from '../learning/guardrails.js';
import { baseProbability } from '../learning/apply.js';
import { parseSource, warmParsers } from '../parser/ast-parser.js';
import { classifyUnit, loadFastModel } from '../provenance/fast-model.js';
import { scoreUnit } from '../scorer/heuristic-scorer.js';
import { extractFeatures } from './features.js';

const EXT: Record<string, string> = { javascript: 'js', typescript: 'ts', tsx: 'tsx', python: 'py', java: 'java', csharp: 'cs', c: 'c', cpp: 'cpp', go: 'go', rust: 'rs', php: 'php', shell: 'sh' };
const PER_CLASS = 1000;

/**
 * node export-check-set.js <ml/data/raw dir> <out file>
 * Builds core/models/check-set.bin from the benchmark's held-out TEST split (repo-level, as ml/athena_ml/split.py): up to 1000 human and
 * 1000 AI units, spread over languages, each with the base AI probability a scan would use and its 35 style features.
 */
async function main(): Promise<void> {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error('usage: export-check-set <raw dir> <out file>');
  await warmParsers();
  const fast = loadFastModel();
  const byLabel: Record<'human' | 'ai', Array<{ id: string; language: string; code: string }>> = { human: [], ai: [] };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { id: string; language: string; code: string; label: string; repo: string };
      if (r.label !== 'human' && r.label !== 'ai') continue;
      if (BigInt(`0x${createHash('sha256').update(r.repo).digest('hex')}`) % 100n < 90n) continue;
      if (!EXT[r.language]) continue;
      byLabel[r.label].push({ id: r.id, language: r.language, code: r.code });
    }
  }
  const rows: CheckSet['rows'] = [];
  for (const label of ['human', 'ai'] as const) {
    const pool = byLabel[label].sort((a, b) => a.id.localeCompare(b.id));
    // Round-robin over languages so one language cannot dominate.
    const byLang = new Map<string, typeof pool>();
    for (const r of pool) byLang.set(r.language, [...(byLang.get(r.language) ?? []), r]);
    const lists = [...byLang.values()];
    let taken = 0;
    for (let i = 0; taken < PER_CLASS && lists.some((l) => i < l.length); i += 1) {
      for (const list of lists) {
        const r = list[i];
        if (!r || taken >= PER_CLASS) continue;
        const units = parseSource(`unit.${EXT[r.language]}`, r.code);
        const unit = units.sort((a, b) => (b.endLine - b.startLine) - (a.endLine - a.startLine))[0];
        if (!unit) continue;
        const scored = scoreUnit(unit, defaultConfig);
        const lang = r.language as LanguageId;
        const classified = fast ? classifyUnit(fast, unit, lang) : null;
        rows.push({ y: label === 'ai' ? 1 : 0, pBase: baseProbability(scored, classified?.probabilities ?? null), dense: extractFeatures({ code: unit.code }, lang).dense });
        taken += 1;
      }
    }
  }
  writeFileSync(out, encodeCheckSet(rows));
  process.stdout.write(`${rows.length} units (${rows.filter((r) => r.y === 1).length} ai) written to ${out}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
