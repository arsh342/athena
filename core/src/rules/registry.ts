import type { LanguageFamily } from '../lang/languages.js';
import { PATTERN_RULES, TAINT_RULES } from './common.js';
import { investigateRuleMeta } from '../investigate/meta.js';
import { secretRuleMeta } from '../secrets/meta.js';
import { cPack } from './packs/c.js';
import { csharpPack } from './packs/csharp.js';
import { goPack } from './packs/go.js';
import { javaPack } from './packs/java.js';
import { jsPack } from './packs/js.js';
import { phpPack } from './packs/php.js';
import { pythonPack } from './packs/python.js';
import { rustPack } from './packs/rust.js';
import { shellPack } from './packs/shell.js';
import type { FamilyPack, RuleMeta } from './types.js';

const PACKS: Partial<Record<LanguageFamily, FamilyPack>> = {
  js: jsPack,
  python: pythonPack,
  java: javaPack,
  csharp: csharpPack,
  c: cPack,
  go: goPack,
  rust: rustPack,
  php: phpPack,
  shell: shellPack,
};

export function packFor(family: LanguageFamily): FamilyPack | null {
  return PACKS[family] ?? null;
}

export function allPacks(): FamilyPack[] {
  return Object.values(PACKS);
}

const META = new Map<string, RuleMeta>();
export function registerRuleMeta(rules: RuleMeta[]): void {
  for (const r of rules) META.set(r.id, r);
}
registerRuleMeta([...TAINT_RULES, ...PATTERN_RULES, ...secretRuleMeta(), ...investigateRuleMeta()]);

export function ruleMeta(id: string): RuleMeta | null {
  return META.get(id) ?? null;
}

export function allRuleMeta(): RuleMeta[] {
  return [...META.values()];
}
