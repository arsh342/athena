import { isLiteralLeaf } from '../analysis/lang.js';
import type { LanguageFamily } from '../lang/languages.js';
import { meta as ruleMetaFactory } from '../rules/common.js';
import type { CallInfo, CallRule, FamilyPack, FileContext, LineRule, RuleMeta, SinkSpec } from '../rules/types.js';
import { compileSafeRegex } from './regex-safety.js';
import { FAMILIES, type Predicate, type Skill, type SkillRuleDef } from './types.js';

export interface FileRule {
  meta: RuleMeta;
  files: RegExp;
  line: RegExp;
  /** `index` is the zero-based line number and `lines` the whole file. */
  test: (line: string, fileText: string, index: number, lines: string[]) => boolean;
}

export interface FamilyExtras {
  callRules: CallRule[];
  lineRules: LineRule[];
  sinks: SinkSpec[];
  sources: RegExp[];
  sanitizers: RegExp[];
}

export interface CompiledSkills {
  skills: Skill[];
  extras: Map<LanguageFamily, FamilyExtras>;
  fileRules: FileRule[];
  /** Rule id -> skill that defines it (for the report). */
  ruleSkill: Map<string, string>;
  metas: RuleMeta[];
  metaById: Map<string, RuleMeta>;
  /** Rule metadata is per scan: it is never written into the process-wide registry. */
  warnings: string[];
  /** Skills switched off for the rest of the scan because their rules used too much time. */
  disabled: Set<string>;
  /** @internal time spent per non-built-in skill */
  budgets?: Array<[string, { spent: number; limit: number }]>;
}

const re = (source: string, strict = false): RegExp => {
  const verdict = compileSafeRegex(source, 'im', { strict });
  if (!verdict.ok || !verdict.regex) throw new Error(`unsafe regex ${source}: ${verdict.reason}`);
  return verdict.regex;
};

function isLiteralArg(node: CallInfo['args'][number]): boolean {
  if (isLiteralLeaf(node)) return true;
  const t = node.text.trim();
  if (/^[fF]["']/.test(t) || t.includes('${')) return false;
  return /^(?:[rRbBuU])?(["'`])(?:(?!\1)[^\\]|\\.)*\1$/.test(t) && node.type.includes('string');
}

function isConcatArg(node: CallInfo['args'][number]): boolean {
  if (isLiteralArg(node)) return false;
  return /binary|template|interpolat|concat|format|encapsed/.test(node.type) || /\s\+\s|\.format\(|^[fF]["']|%\s*[(\w]/.test(node.text);
}

interface Budget {
  spent: number;
  limit: number;
  trusted: boolean;
}

function compilePreds(preds: Predicate[] | undefined, ownLine: RegExp | null, budget: Budget): { call: (c: CallInfo, ctx: FileContext) => boolean; line: (line: string, text: string, index?: number, lines?: string[]) => boolean } {
  const list = preds ?? [];
  const strict = !budget.trusted;
  const compiled = list.map((p) => ({ p, regex: 'regex' in p ? re(p.regex, strict) : null }));
  const cap = (text: string, n: number): string => (strict ? text.slice(0, Math.min(n, 4000)) : text.slice(0, n));
  const timed = <T>(fallback: T, fn: () => T): T => {
    if (budget.spent > budget.limit) return fallback;
    const started = Date.now();
    try {
      return fn();
    } finally {
      budget.spent += Date.now() - started;
    }
  };
  return {
    call: (c, ctx) => timed(false, () => compiled.every(({ p, regex }) => {
      switch (p.op) {
        case 'argIsNonLiteral': return !!c.args[p.index] && !isLiteralArg(c.args[p.index]!);
        case 'argIsConcat': return !!c.args[p.index] && isConcatArg(c.args[p.index]!);
        case 'argMatches': return !!c.args[p.index] && regex!.test(cap(c.args[p.index]!.text, 2000));
        case 'argNotMatches': return !c.args[p.index] || !regex!.test(cap(c.args[p.index]!.text, 2000));
        case 'callTextMatches': return regex!.test(cap(c.node.text, 2000));
        case 'callTextNotMatches': return !regex!.test(cap(c.node.text, 2000));
        case 'fnTextMatches': return regex!.test(cap(c.fnText || ctx.source, 20000));
        case 'fnTextNotMatches': return !regex!.test(cap(c.fnText || ctx.source, 20000));
        case 'fileTextMatches': return regex!.test(cap(ctx.source, 100000));
        case 'fileTextNotMatches': return !regex!.test(cap(ctx.source, 100000));
        case 'lineMatches': return regex!.test(ctx.lines[c.line - 1] ?? '');
        case 'lineNotMatches': return !regex!.test(ctx.lines[c.line - 1] ?? '');
        default: return true;
      }
    })),
    line: (line, text, index, lines) => timed(false, () => compiled.every(({ p, regex }) => {
      switch (p.op) {
        case 'lineMatches': return regex!.test(line);
        case 'lineNotMatches': return !regex!.test(line);
        case 'fileTextMatches': case 'fnTextMatches': case 'callTextMatches': return regex!.test(cap(text, 100000));
        case 'fileTextNotMatches': case 'fnTextNotMatches': case 'callTextNotMatches': return !regex!.test(cap(text, 100000));
        case 'isLastMatch': {
          if (index === undefined || !lines || !ownLine) return true;
          for (let i = lines.length - 1; i > index; i -= 1) if (ownLine.test(lines[i]!)) return false;
          return true;
        }
        case 'textAfterNotMatches': {
          if (index === undefined || !lines) return true;
          return !regex!.test(cap(lines.slice(index + 1).join('\n'), 100000));
        }
        case 'inRunBlock': {
          if (index === undefined || !lines) return true;
          if (/^\s*(?:-\s+)?run:\s*\S/.test(line)) return true;
          const indent = /^\s*/.exec(line)![0].length;
          for (let i = index - 1; i >= 0 && i > index - 200; i -= 1) {
            const l = lines[i]!;
            if (l.trim() === '') continue;
            const ind = /^\s*/.exec(l)![0].length;
            if (ind < indent) return /^\s*(?:-\s+)?run:\s*[|>][+-]?\s*$/.test(l);
          }
          return false;
        }
        default: return true; // argument predicates do not apply to line rules
      }
    })),
  };
}

function metaOf(def: SkillRuleDef): RuleMeta {
  return ruleMetaFactory(def.id, def.title, def.severity, def.cwe, def.category, 'pattern', def.why, def.fix, {
    ...(def.confidence ? { confidence: def.confidence } : {}), ...(def.families ? { families: def.families } : {}),
  });
}

const extrasFor = (map: Map<LanguageFamily, FamilyExtras>, family: LanguageFamily): FamilyExtras => {
  let e = map.get(family);
  if (!e) {
    e = { callRules: [], lineRules: [], sinks: [], sources: [], sanitizers: [] };
    map.set(family, e);
  }
  return e;
};

/** Turn active skills into rules the engine understands. A skill that fails to compile is dropped with a warning. */
export function compileSkills(skills: Skill[]): CompiledSkills {
  const out: CompiledSkills = { skills: [], extras: new Map(), fileRules: [], ruleSkill: new Map(), metas: [], metaById: new Map(), warnings: [], disabled: new Set() };
  for (const skill of skills) {
    try {
      const strict = skill.source !== 'builtin';
      const budget: Budget = { spent: 0, limit: 1500, trusted: !strict };
      const staged = { calls: [] as Array<[LanguageFamily, CallRule]>, lines: [] as Array<[LanguageFamily, LineRule]>, files: [] as FileRule[], sinks: [] as Array<[LanguageFamily, SinkSpec]>, sources: [] as Array<[LanguageFamily, RegExp]>, sanitizers: [] as Array<[LanguageFamily, RegExp]>, metas: [] as RuleMeta[], ids: [] as string[] };
      for (const def of skill.rules) {
        const meta = metaOf(def);
        staged.metas.push(meta);
        staged.ids.push(def.id);
        const ownLine = def.match.kind === 'line' || def.match.kind === 'file' ? re(def.match.line, strict) : null;
        const preds = compilePreds(def.match.where, ownLine, budget);
        const families = def.families ?? FAMILIES;
        if (def.match.kind === 'call') {
          const rule: CallRule = { ...meta, callee: re(def.match.callee, strict), test: (c, ctx) => (preds.call(c, ctx) ? '' : null) };
          for (const f of families) staged.calls.push([f, rule]);
        } else if (def.match.kind === 'line') {
          const rule: LineRule = { ...meta, line: ownLine!, test: (line, ctx) => preds.line(line, ctx.source) };
          for (const f of families) staged.lines.push([f, rule]);
        } else {
          staged.files.push({ meta, files: re(def.match.files, strict), line: ownLine!, test: (line, text, index, lines) => preds.line(line, text, index, lines) });
        }
      }
      if (skill.taint) {
        // Sanitizers make findings disappear; only vetted built-in skills may declare them.
        const allowSanitizers = skill.source === 'builtin';
        if (!allowSanitizers && (skill.taint.sanitizers?.length ?? 0) > 0) out.warnings.push(`skill ${skill.meta.name}: sanitizers are ignored for non-built-in skills`);
        for (const f of skill.taint.families) {
          for (const s of skill.taint.sources ?? []) staged.sources.push([f, re(s)]);
          if (allowSanitizers) for (const s of skill.taint.sanitizers ?? []) staged.sanitizers.push([f, re(s)]);
          for (const k of skill.taint.sinks ?? []) staged.sinks.push([f, { ruleId: k.rule, callee: re(k.callee, strict), args: k.args, ...(k.callText ? { callText: re(k.callText, strict) } : {}) }]);
        }
      }
      for (const [f, r] of staged.calls) extrasFor(out.extras, f).callRules.push(r);
      for (const [f, r] of staged.lines) extrasFor(out.extras, f).lineRules.push(r);
      for (const [f, r] of staged.sinks) extrasFor(out.extras, f).sinks.push(r);
      for (const [f, r] of staged.sources) extrasFor(out.extras, f).sources.push(r);
      for (const [f, r] of staged.sanitizers) extrasFor(out.extras, f).sanitizers.push(r);
      out.fileRules.push(...staged.files);
      out.metas.push(...staged.metas);
      for (const m of staged.metas) out.metaById.set(m.id, m);
      if (strict) out.budgets = [...(out.budgets ?? []), [skill.meta.name, budget]];
      for (const id of staged.ids) out.ruleSkill.set(id, skill.meta.name);
      out.skills.push(skill);
    } catch (error) {
      out.warnings.push(`skill ${skill.meta.name} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/** A family pack extended with the active skills' rules, sources, sanitizers and sinks. */
export function extendPack(pack: FamilyPack, extras: FamilyExtras | undefined): FamilyPack {
  if (!extras) return pack;
  return {
    ...pack,
    sources: [...pack.sources, ...extras.sources],
    sanitizers: [...pack.sanitizers, ...extras.sanitizers],
    sinks: [...pack.sinks, ...extras.sinks],
    callRules: [...pack.callRules, ...extras.callRules],
    lineRules: [...pack.lineRules, ...extras.lineRules],
  };
}

/** Run file rules over one text/source file. */
export function runFileRules(path: string, text: string, rules: FileRule[]): Array<{ ruleId: string; line: number; code: string }> {
  const out: Array<{ ruleId: string; line: number; code: string }> = [];
  const applicable = rules.filter((r) => r.files.test(path.split('\\').join('/')));
  if (applicable.length === 0 || text.length > 1_000_000) return out;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 400) return;
    for (const r of applicable) {
      if (r.line.test(line) && r.test(line, text, i, lines)) out.push({ ruleId: r.meta.id, line: i + 1, code: line.trim().slice(0, 140) });
    }
  });
  return out;
}
