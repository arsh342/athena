import type { LanguageFamily } from '../lang/languages.js';
import type { TSNode } from '../lang/parser-pool.js';
import {
  assignmentsOf, forBindingOf, functionName, isComparison, isFunctionNode, isLiteralLeaf, isMemberPosition, isReturn,
  isVariableLeaf, paramNames, parseCall, normaliseCallee, returnValue,
} from '../analysis/lang.js';
import type { FamilyPack, FileContext, RawFinding, SinkSpec, TraceStep } from '../rules/types.js';

export type Taint = TraceStep[];

export interface FnSummary {
  name: string;
  file: string;
  paramCount: number;
  /** returns[i]: the return value depends on argument i. */
  returns: boolean[];
  /** sinks[]: argument `param` reaches a sink inside this function (possibly through further calls). */
  sinks: Array<{ param: number; ruleId: string; line: number; code: string }>;
}

export interface ImportInfo {
  /** Local identifier → exported function in another project file. */
  named: Map<string, { file: string; name: string }>;
  /** Local alias for a whole module (`import * as m`, `const m = require(..)`, `import m`) → file. */
  modules: Map<string, string>;
}

export const NO_IMPORTS: ImportInfo = { named: new Map(), modules: new Map() };

export class AnalysisTimeout extends Error {
  constructor() {
    super('analysis timed out');
  }
}

interface Hit {
  ruleId: string;
  line: number;
  code: string;
  trace: Taint;
}

interface Scope {
  file: FileContext;
  pack: FamilyPack;
  deadline: number;
  local: Map<string, FnSummary>;
  global: Map<string, FnSummary>;
  imports: ImportInfo;
  steps: number;
  /** Variable -> position of the statement that sanitised it; uses after it are clean, uses before it are not. */
  kills: Map<string, number>;
}

const SIZE_PROPS = new Set(['length', 'size', 'count', 'len', 'Length', 'Count']);
const MAX_TRACE = 8;

function short(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 77)}...` : one;
}

function tick(scope: Scope): void {
  scope.steps += 1;
  if ((scope.steps & 255) === 0 && Date.now() > scope.deadline) throw new AnalysisTimeout();
}

/** Marker on taint that comes from exception text rather than directly from a request. */
const EXCEPTION_NOTE = 'exception text (raised while handling request data)';
const EXCEPTION_SINKS = /^taint\.(?:template-injection|code-injection)$/;

function collectScope(root: TSNode, family: LanguageFamily): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    const children = n.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const c = children[i];
      if (c && c.isNamed && !isFunctionNode(c, family)) stack.push(c);
    }
  }
  return out;
}

function resolveSummary(scope: Scope, callee: string): FnSummary | null {
  const family = scope.file.family;
  if (!callee.includes('.') && !callee.includes('->') && !callee.includes('::')) {
    const local = scope.local.get(callee);
    if (local) return local;
    const imported = scope.imports.named.get(callee);
    return imported ? scope.global.get(`${imported.file}::${imported.name}`) ?? null : null;
  }
  const self = /^(?:this\.|self\.|cls\.|\$this->|Self::|self::)(\w+)$/.exec(callee);
  if (self) return scope.local.get(self[1]!) ?? null;
  const member = /^([\w$]+)(?:\.|->|::)(\w+)$/.exec(callee);
  if (member) {
    const file = scope.imports.modules.get(member[1]!);
    if (file) return scope.global.get(`${file}::${member[2]!}`) ?? null;
  }
  void family;
  return null;
}

function taintOf(node: TSNode | null, env: Map<string, Taint>, scope: Scope, depth = 0): Taint | null {
  if (!node || depth > 60) return null;
  tick(scope);
  if (isLiteralLeaf(node)) return null;
  const family = scope.file.family;
  if (isVariableLeaf(node)) {
    if (isMemberPosition(node)) return null;
    const key = node.text;
    if (family === 'shell' && /^[0-9@*#]$/.test(key)) return [{ line: node.startPosition.row + 1, note: `source: positional argument $${key}` }];
    const killedAt = scope.kills.get(key);
    if (killedAt !== undefined && node.startIndex > killedAt) return null;
    const direct = env.get(key);
    if (direct) return direct;
    for (const [k, v] of env) if (k.startsWith(`${key}.`) || k.startsWith(`${key}[`)) return v;
    return null;
  }
  if (node.childCount > 0 && node.text.length <= 400 && scope.pack.sources.some((r) => r.test(node.text))) {
    return [{ line: node.startPosition.row + 1, note: `source: ${short(node.text)}` }];
  }
  if (isComparison(node)) return null;
  const t = node.type;
  if ((t.includes('member') || t === 'attribute' || t === 'selector_expression' || t === 'field_access') && node.namedChildCount >= 2) {
    const last = node.namedChildren[node.namedChildren.length - 1];
    if (last && SIZE_PROPS.has(last.text)) return null;
  }
  const call = parseCall(node, family);
  if (call) {
    if (scope.pack.sanitizers.some((r) => r.test(call.callee)) || scope.pack.cleanCalls.test(call.callee)) return null;
    const summary = resolveSummary(scope, call.callee);
    if (summary) {
      for (let i = 0; i < call.args.length; i += 1) {
        const at = taintOf(call.args[i]!, env, scope, depth + 1);
        if (at && summary.returns[i]) return [...at, { line: node.startPosition.row + 1, note: `returned by ${call.callee}()` }].slice(-MAX_TRACE);
      }
      return null;
    }
  }
  for (const child of node.namedChildren) {
    if (!child) continue;
    const r = taintOf(child, env, scope, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Variables read in `arg`; a guard line must mention one of them (linear: no regex over the whole function). */
function variablesOf(arg: TSNode): string[] {
  const out: string[] = [];
  const stack: TSNode[] = [arg];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isVariableLeaf(n)) {
      if (!isMemberPosition(n)) out.push(n.text);
      continue;
    }
    for (const c of n.children) if (c && c.isNamed) stack.push(c);
  }
  return out;
}

function mentions(line: string, name: string): boolean {
  for (let i = line.indexOf(name); i !== -1; i = line.indexOf(name, i + 1)) {
    const before = i === 0 ? '' : line[i - 1]!;
    const after = line[i + name.length] ?? '';
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return true;
  }
  return false;
}

function guardedVariable(arg: TSNode, guard: RegExp, fnText: string): boolean {
  const names = variablesOf(arg);
  if (names.length === 0) return false;
  const lines = fnText.split('\n');
  for (let i = 0; i < lines.length && i < 3000; i += 1) {
    const line = lines[i]!;
    if (line.length > 500 || !guard.test(line)) continue;
    if (names.some((n) => mentions(line, n))) return true;
  }
  return false;
}

function checkSinks(node: TSNode, env: Map<string, Taint>, scope: Scope, fnText: string, hits: Hit[]): void {
  const call = parseCall(node, scope.file.family);
  if (!call || !call.callee) return;
  const line = node.startPosition.row + 1;
  const code = short(node.text);
  for (const sink of scope.pack.sinks) {
    if (sink.assign || !sink.callee.test(call.callee)) continue;
    if (sink.callText && !sink.callText.test(node.text)) continue;
    if (sink.unlessText && sink.unlessText.test(node.text)) continue;
    const indexes = sink.args === 'any' ? call.args.map((_, i) => i) : sink.args;
    for (const i of indexes) {
      const arg = call.args[i];
      if (!arg) continue;
      if (sink.skipIdentifierArgs && arg.type === 'identifier' && !sink.callText) continue;
      // An argument vector / bound-parameter list (list/array literal) is not interpreted as a command or SQL text.
      if ((sink.ruleId === 'taint.command-injection' || sink.ruleId === 'taint.sql-injection') && /^(?:list|array|array_creation_expression|array_expression|slice_literal|composite_literal|collection_expression|array_initializer)$/.test(arg.type)) continue;
      const t = taintOf(arg, env, scope);
      if (!t) continue;
      // Exception text can echo request input, but only template/code construction is dangerous enough to report from it.
      if (t[0]?.note === EXCEPTION_NOTE && !EXCEPTION_SINKS.test(sink.ruleId)) continue;
      if (sink.fnGuard && sink.fnGuard.test(fnText)) continue;
      if (sink.guard && guardedVariable(arg, sink.guard, fnText)) continue;
      hits.push({ ruleId: sink.ruleId, line, code, trace: [...t, { line, note: `reaches ${call.callee}()` }].slice(-MAX_TRACE) });
    }
  }
  const summary = resolveSummary(scope, call.callee);
  if (summary) {
    for (const sinkInfo of summary.sinks) {
      const arg = call.args[sinkInfo.param];
      const t = arg ? taintOf(arg, env, scope) : null;
      if (!t) continue;
      hits.push({
        ruleId: sinkInfo.ruleId, line, code,
        trace: [...t, { line, note: `passed to ${call.callee}()` }, { line: sinkInfo.line, file: summary.file, note: `sink in ${summary.name}(): ${sinkInfo.code}` }].slice(-MAX_TRACE),
      });
    }
  }
}

interface ScopeResult {
  returns: Taint | null;
  hits: Hit[];
}

function analyzeScope(scopeNode: TSNode, isFunction: boolean, initial: Map<string, Taint>, scope: Scope): ScopeResult {
  const family = scope.file.family;
  const start = isFunction ? scopeNode.childForFieldName('body') ?? scopeNode : scopeNode;
  const nodes = collectScope(start, family);
  const fnText = isFunction ? scopeNode.text : '';
  const env = new Map(initial);
  scope.kills = new Map();

  const assigns = nodes.flatMap((n) => assignmentsOf(n, family));
  const fors = nodes.map((n) => forBindingOf(n)).filter((b): b is NonNullable<typeof b> => b !== null);
  const reads = nodes.filter((n) => family === 'shell' && n.type === 'command' && n.childForFieldName('name')?.text === 'read');

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const a of assigns) {
      const t = taintOf(a.value, env, scope);
      if (t) {
        for (const target of a.targets) {
          if (!env.has(target)) {
            env.set(target, [...t, { line: a.node.startPosition.row + 1, note: `assigned to ${target}` }].slice(-MAX_TRACE));
            changed = true;
          }
        }
      } else if (a.value && env.size > 0) {
        const call = parseCall(a.value, family);
        if (call && (scope.pack.sanitizers.some((r) => r.test(call.callee)) || scope.pack.cleanCalls.test(call.callee))) {
          for (const target of a.targets) scope.kills.set(target, Math.max(scope.kills.get(target) ?? 0, a.node.startIndex));
        }
      }
    }
    if (family === 'python') {
      // `except E as e:` binds exception text; it may contain what the `try` body was handling, so it carries that taint.
      for (const n of nodes) {
        if (n.type !== 'except_clause') continue;
        const name = /^except\b[^\n:]*?\bas\s+(\w+)/.exec(n.text)?.[1];
        const body = n.parent?.type === 'try_statement' ? n.parent.childForFieldName('body') ?? n.parent.namedChildren.find((c) => c?.type === 'block') ?? null : null;
        if (!name || !body || env.has(name) || !taintOf(body, env, scope)) continue;
        env.set(name, [{ line: n.startPosition.row + 1, note: EXCEPTION_NOTE }]);
        changed = true;
      }
    }
    for (const f of fors) {
      const t = taintOf(f.iterable, env, scope);
      if (t) for (const target of f.targets) if (!env.has(target)) { env.set(target, [...t, { line: f.iterable.startPosition.row + 1, note: `iterated into ${target}` }]); changed = true; }
    }
    for (const r of reads) {
      for (const arg of r.namedChildren) {
        if (arg && arg.type === 'word' && !arg.text.startsWith('-') && !env.has(arg.text)) {
          env.set(arg.text, [{ line: r.startPosition.row + 1, note: 'source: read from stdin' }]);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const hits: Hit[] = [];
  let returns: Taint | null = null;
  for (const n of nodes) {
    tick(scope);
    checkSinks(n, env, scope, fnText, hits);
    for (const sink of scope.pack.sinks) {
      if (!sink.assign) continue;
      for (const a of assignmentsOf(n, family)) {
        if (!a.value || !a.targets.some((x) => sink.assign!.test(x)) || !sinkMatchesNode(sink, n)) continue;
        const t = taintOf(a.value, env, scope);
        if (t && !(sink.fnGuard && sink.fnGuard.test(fnText)) && !(sink.guard && guardedVariable(a.value, sink.guard, fnText))) {
          const line = n.startPosition.row + 1;
          hits.push({ ruleId: sink.ruleId, line, code: short(n.text), trace: [...t, { line, note: `assigned to ${a.targets[0]}` }].slice(-MAX_TRACE) });
        }
      }
    }
    if (isReturn(n)) {
      const t = taintOf(returnValue(n), env, scope);
      if (t && !returns) returns = t;
    }
  }
  if (isFunction) {
    const body = scopeNode.childForFieldName('body');
    if (body && !body.type.includes('block') && body.type !== 'statement_block' && body.type !== 'compound_statement') {
      returns ??= taintOf(body, env, scope); // expression-bodied arrow / lambda
    }
  }
  return { returns, hits };
}

function sinkMatchesNode(_sink: SinkSpec, _node: TSNode): boolean {
  return true;
}

function allFunctions(root: TSNode, family: LanguageFamily): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isFunctionNode(n, family)) out.push(n);
    const children = n.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const c = children[i];
      if (c && c.isNamed) stack.push(c);
    }
  }
  return out;
}

function toFinding(hit: Hit, file: string): RawFinding {
  return {
    ruleId: hit.ruleId,
    line: hit.line,
    code: hit.code,
    message: `Untrusted data flows from ${hit.trace[0]?.note.replace(/^source: /, '') ?? 'an input'} into a dangerous operation (${hit.trace.length} steps).`,
    trace: hit.trace.map((s) => ({ ...s, file: s.file ?? file })) as RawFinding['trace'],
    source: 'athena-taint',
    confidence: 'high',
  };
}

export interface FileTaintResult {
  findings: RawFinding[];
  summaries: Map<string, FnSummary>;
}

/** Taint analysis of one file: per-function summaries to a fixpoint (cap 10), then findings. Throws AnalysisTimeout. */
export function analyzeFileTaint(
  file: FileContext,
  pack: FamilyPack,
  imports: ImportInfo,
  global: Map<string, FnSummary>,
  deadlineMs: number,
): FileTaintResult {
  const scope: Scope = { file, pack, deadline: Date.now() + deadlineMs, local: new Map(), global, imports, steps: 0, kills: new Map() };
  const functions = allFunctions(file.root, file.family);

  const names = new Map<string, number>();
  for (const fn of functions) {
    const name = functionName(fn);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  const named = functions.filter((fn) => {
    const name = functionName(fn);
    return name && names.get(name) === 1;
  });

  for (const fn of named) {
    const name = functionName(fn);
    scope.local.set(name, { name, file: file.path, paramCount: paramNames(fn).length, returns: [], sinks: [] });
  }

  for (let iteration = 0; iteration < 10; iteration += 1) {
    let changed = false;
    for (const fn of named) {
      const name = functionName(fn);
      const params = paramNames(fn);
      const summary: FnSummary = { name, file: file.path, paramCount: params.length, returns: [], sinks: [] };
      for (let i = 0; i < params.length; i += 1) {
        if (!params[i]) { summary.returns.push(false); continue; }
        const initial = new Map<string, Taint>([[params[i]!, [{ line: fn.startPosition.row + 1, note: `parameter ${params[i]}` }]]]);
        const res = analyzeScope(fn, true, initial, scope);
        summary.returns.push(res.returns !== null);
        for (const h of res.hits) summary.sinks.push({ param: i, ruleId: h.ruleId, line: h.line, code: h.code });
      }
      const old = scope.local.get(name)!;
      if (JSON.stringify(old.returns) !== JSON.stringify(summary.returns) || old.sinks.length !== summary.sinks.length) changed = true;
      scope.local.set(name, summary);
    }
    if (!changed) break;
  }

  const hits: Hit[] = [];
  for (const fn of functions) {
    const params = paramNames(fn);
    const initial = new Map<string, Taint>();
    for (const i of pack.taintedParams?.(fn, file.lang) ?? []) {
      const name = params[i];
      if (name) initial.set(name, [{ line: fn.startPosition.row + 1, note: `source: request parameter ${name}` }]);
    }
    hits.push(...analyzeScope(fn, true, initial, scope).hits);
  }
  hits.push(...analyzeScope(file.root, false, new Map(), scope).hits);

  const seen = new Set<string>();
  const findings: RawFinding[] = [];
  for (const h of hits) {
    const key = `${h.ruleId}:${h.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(toFinding(h, file.path));
  }
  const summaries = new Map<string, FnSummary>();
  for (const [name, s] of scope.local) summaries.set(`${file.path}::${name}`, s);
  return { findings, summaries };
}

export { normaliseCallee };
