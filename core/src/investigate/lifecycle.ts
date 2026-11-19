import { callInfo, functionName, isFunctionNode, paramNames } from '../analysis/lang.js';
import type { TSNode } from '../lang/parser-pool.js';
import type { FileContext, RawFinding } from '../rules/types.js';

const SUCCESS_STATUS = /(?:status|state)\s*(?::|=)\s*['"`](?:complete\w*|done|success\w*|finished|ready|processed|ok)['"`]|(?:set|update|mark)(?:Status|State|Complete\w*|Done|Success\w*)\w*\(/i;
const ANY_STATUS_WRITE = /(?:status|state)\s*(?::|=)\s*['"`]?\w|(?:set|update|mark|save|persist|record)\w*(?:Status|State|Fail\w*|Error\w*|Result|Scan|Run|Job)\w*\(|\.save\(|\.update\(|\.upsert\(/i;
const CHECKISH = /(?:scan|check|verify|validate|lint|audit|detect|run|exec|analy[sz]e|probe|test|ping|health|authenticat|authori[sz]e)/i;
const SQL_TXN = /FOR UPDATE|\bBEGIN\b|TRANSACTION|SERIALIZABLE|\.transaction\(|\$transaction|\block\w*\(/i;

/** Only plain identifiers are interpolated into regular expressions (anything else is skipped, never guessed). */
function safeName(name: string | undefined | null): string | null {
  return name && /^[A-Za-z_]\w*$/.test(name) ? name : null;
}

function lineOf(n: TSNode): number {
  return n.startPosition.row + 1;
}

function descendants(root: TSNode): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    const c = n.children;
    for (let i = c.length - 1; i >= 0; i -= 1) {
      const ch = c[i];
      if (ch && ch.isNamed) stack.push(ch);
    }
  }
  return out;
}

function finding(ctx: FileContext, ruleId: string, line: number, code: string, message: string): RawFinding {
  return { ruleId, line, code: code.replace(/\s+/g, ' ').trim().slice(0, 140), message, source: 'athena-investigate' };
}

function isStringNode(n: TSNode): boolean {
  return /string|template/.test(n.type) && !n.type.includes('type');
}

/** Statements of a catch/except body excluding logging calls. */
function meaningfulStatements(body: TSNode | null): TSNode[] {
  if (!body) return [];
  return body.namedChildren.filter((c): c is TSNode => c !== null && !/comment/.test(c.type) && !/^(?:expression_statement)$/.test(c.type) || (c !== null && c.type === 'expression_statement' && !/^(?:console|logger|log|logging|print|println|fmt\.Print|System\.out|Console)\b/.test(c.text) && !/\.(?:log|warn|error|info|debug|printStackTrace)\(/.test(c.text)));
}

// `null`/`None`/`nil` mean "not found" in common idioms, so only values that read as a clean result count.
const SUCCESS_VALUE = /^(?:\[\s*\]|\{\s*\}|true|True|\(\)|\[\]|Ok\(\(\)\)|Vec::new\(\)|\[\]\s*as\b.*)$/;

function jsLike(ctx: FileContext, fn: TSNode, out: RawFinding[], asyncNames: Set<string>): void {
  const nodes = descendants(fn);
  const fnText = fn.text;

  // (b) cleanup attached only after an await
  if (/\bawait\b/.test(fnText)) {
    const awaits = nodes.filter((n) => n.type === 'await_expression');
    for (const n of nodes) {
      const call = callInfo(n, 'js', fnText);
      if (!call || !/\.(?:on|once|addEventListener)$/.test(call.callee)) continue;
      if (!/^['"`](?:close|end|disconnect|error|finish|abort|unload)['"`]$/.test(call.args[0]?.text ?? '')) continue;
      const firstAwait = awaits.find((a) => a.startIndex < n.startIndex);
      if (!firstAwait) continue;
      const registered = nodes.some((r) => {
        if (r.startIndex >= firstAwait.startIndex) return false;
        const rc = callInfo(r, 'js', fnText);
        return !!rc && (/\.(?:set|add|push|register\w*|subscribe|addClient|attach)$/.test(rc.callee) || /^register\w*$/.test(rc.callee));
      });
      if (registered) {
        out.push(finding(ctx, 'lifecycle.cleanup-after-await', call.line, n.text, 'The close/error handler is attached after an await, but the registration above it happens before; a disconnect during the await leaks it.'));
        break;
      }
    }
  }

  // (b') connection callback: `wss.on('connection', async (ws) => { await x; ...; ws.on('close', ...) })`
  // the peer may close during the await, and the close event is then never delivered to the late handler.
  const parentCall = fn.parent?.type === 'arguments' ? fn.parent.parent : null;
  if (parentCall && /\.on$/.test(parentCall.childForFieldName('function')?.text ?? '') && /^['"`](?:connection|upgrade)['"`]/.test(parentCall.childForFieldName('arguments')?.namedChildren[0]?.text ?? '')) {
    const peer = safeName(paramNames(fn)[0]);
    if (peer) {
      const awaits = nodes.filter((n) => n.type === 'await_expression');
      for (const n of nodes) {
        const call = callInfo(n, 'js', fnText);
        if (!call || call.callee !== `${peer}.on` && call.callee !== `${peer}.once`) continue;
        if (!/^['"`](?:close|end|disconnect)['"`]$/.test(call.args[0]?.text ?? '')) continue;
        if (awaits.some((a) => a.startIndex < n.startIndex)) {
          out.push(finding(ctx, 'lifecycle.cleanup-after-await', call.line, n.text, `\`${peer}.on('close')\` is attached after an await; if the peer disconnects during the await the handler never runs and anything registered here leaks.`));
          break;
        }
      }
    }
  }

  // (c) success status written but failure path exits without recording one
  for (const t of nodes.filter((x) => x.type === 'try_statement')) {
    const body = t.childForFieldName('body');
    const handler = t.childForFieldName('handler');
    const catchBody = handler?.childForFieldName('body');
    if (!body || !handler || !catchBody) continue;
    if (!SUCCESS_STATUS.test(body.text)) continue;
    if (ANY_STATUS_WRITE.test(catchBody.text)) continue;
    if (!/\b(?:return|throw|process\.exit)\b/.test(catchBody.text)) continue;
    out.push(finding(ctx, 'lifecycle.status-not-set-on-failure', lineOf(handler), handler.text.split('\n')[0] ?? 'catch', 'The success path records a final status but this catch block exits without recording a failure.'));
  }

  // (d) swallowed errors and empty catches
  for (const c of nodes.filter((x) => x.type === 'catch_clause')) {
    const cb = c.childForFieldName('body');
    if (!cb) continue;
    const stmts = cb.namedChildren.filter((x): x is TSNode => x !== null && !/comment/.test(x.type));
    const hasComment = cb.namedChildren.some((x) => x?.type === 'comment');
    if (stmts.length === 0) {
      if (!hasComment) out.push(finding(ctx, 'error.empty-catch', lineOf(c), c.text, 'The catch block is empty.'));
      continue;
    }
    const real = stmts.filter((x) => !(x.type === 'expression_statement' && (/^(?:console|logger|log)\b/.test(x.text) || /\.(?:log|warn|error|info|debug)\(/.test(x.text))));
    if (real.length === 1 && real[0]!.type === 'return_statement') {
      const value = real[0]!.namedChild(0)?.text ?? 'undefined';
      if (SUCCESS_VALUE.test(value.trim()) && CHECKISH.test(functionName(fn))) {
        out.push(finding(ctx, 'error.swallowed-success', lineOf(c), c.text, `The error is replaced by \`return ${value}\`, which callers will read as success.`));
      }
    }
  }

  // (e) check-then-act without a conditional write
  if (!SQL_TXN.test(fnText)) {
    const strings = nodes.filter((n) => isStringNode(n) && n.text.length < 600).slice(0, 80);
    for (const sel of strings) {
      const sm = /\bSELECT\b[\s\S]*?\bFROM\s+[`"']?(\w+)/i.exec(sel.text);
      if (!sm) continue;
      for (const upd of strings) {
        if (upd.startIndex <= sel.startIndex) continue;
        const um = /\bUPDATE\s+[`"']?(\w+)[`"']?\s+SET\b[\s\S]*?\bWHERE\s+([^;`'"]*)/i.exec(upd.text);
        if (!um || um[1]!.toLowerCase() !== sm[1]!.toLowerCase()) continue;
        if (/\bAND\b|\bOR\b|\bIS\s+(?:NOT\s+)?NULL\b|[<>]/i.test(um[2]!)) continue;
        out.push(finding(ctx, 'lifecycle.check-then-act', lineOf(upd), upd.text, `Row in ${um[1]} is read, then updated with only a key predicate; concurrent requests can both pass the check.`));
        break;
      }
    }
  }

  // (a) DB connection acquired but never released
  for (const d of nodes.filter((x) => x.type === 'variable_declarator')) {
    const value = d.childForFieldName('value');
    const name = safeName(d.childForFieldName('name')?.text);
    const call = value ? callInfo(value.type === 'await_expression' ? (value.namedChild(0) ?? value) : value, 'js', fnText) : null;
    if (!call || !name || !/^(?:pool|db|client|connection|conn|\w+Pool)\.(?:connect|getConnection|acquire)$/.test(call.callee)) continue;
    if (new RegExp(`\\b${name}\\.(?:release|end|close|destroy|done)\\(|return\\s+${name}\\s*(?:;|$|\\n|\\})`).test(fnText)) continue;
    out.push(finding(ctx, 'lifecycle.resource-not-released', call.line, d.text, `\`${name}\` is acquired from the pool but never released.`));
  }

  // (f) floating promises
  for (const s of nodes.filter((x) => x.type === 'expression_statement')) {
    const expr = s.namedChild(0);
    if (!expr || expr.type !== 'call_expression') continue;
    const call = callInfo(expr, 'js', fnText);
    if (!call || /\.(?:then|catch|finally)$/.test(call.callee)) continue;
    const bare = call.callee;
    if ((asyncNames.has(bare) && !bare.includes('.')) || /^this\.(\w+)$/.test(bare) && asyncNames.has(bare.slice(5)) || /^(?:fetch|fsp\.\w+|fs\.promises\.\w+)$/.test(bare)) {
      out.push(finding(ctx, 'lifecycle.floating-promise', call.line, s.text, `\`${bare}()\` returns a promise that is not awaited or handled.`));
    }
  }
}

function pythonLike(ctx: FileContext, fn: TSNode, out: RawFinding[]): void {
  const nodes = descendants(fn);
  const fnText = fn.text;
  for (const c of nodes.filter((x) => x.type === 'except_clause')) {
    const body = c.namedChildren[c.namedChildren.length - 1];
    const stmts = body?.type === 'block' ? body.namedChildren.filter((x): x is TSNode => x !== null && x.type !== 'comment') : [];
    const hasComment = body?.namedChildren.some((x) => x?.type === 'comment') ?? false;
    if (stmts.length === 0 || (stmts.length === 1 && stmts[0]!.type === 'pass_statement')) {
      if (!hasComment) out.push(finding(ctx, 'error.empty-catch', lineOf(c), c.text, 'The except block does nothing.'));
      continue;
    }
    const real = stmts.filter((x) => !/^(?:logging|logger|log|print)\b/.test(x.text));
    if (real.length === 1 && real[0]!.type === 'return_statement' && SUCCESS_VALUE.test(real[0]!.namedChild(0)?.text.trim() ?? 'None') && CHECKISH.test(functionName(fn))) {
      out.push(finding(ctx, 'error.swallowed-success', lineOf(c), c.text, `The exception is replaced by \`${real[0]!.text}\`, which callers will read as success.`));
    }
  }
  for (const t of nodes.filter((x) => x.type === 'try_statement')) {
    const body = t.childForFieldName('body');
    const handler = t.namedChildren.find((x) => x?.type === 'except_clause');
    if (!body || !handler) continue;
    if (!SUCCESS_STATUS.test(body.text) && !/status\s*=\s*['"](?:complete\w*|done|success\w*|finished)['"]/.test(body.text)) continue;
    if (ANY_STATUS_WRITE.test(handler.text) || !/\b(?:return|raise)\b/.test(handler.text)) continue;
    out.push(finding(ctx, 'lifecycle.status-not-set-on-failure', lineOf(handler), handler.text.split('\n')[0] ?? 'except', 'The success path records a final status but this except block exits without recording a failure.'));
  }
  for (const a of nodes.filter((x) => x.type === 'assignment')) {
    const left = a.childForFieldName('left');
    const right = a.childForFieldName('right');
    if (!left || !right || right.type !== 'call' || left.type !== 'identifier' || !safeName(left.text)) continue;
    const callee = right.childForFieldName('function')?.text ?? '';
    if (!/^(?:open|[\w.]*\.connect|socket\.socket|[\w.]*\.cursor)$/.test(callee)) continue;
    let inWith = false;
    for (let p = a.parent; p; p = p.parent) if (p.type === 'with_statement' || p.type === 'with_item') inWith = true;
    if (inWith || new RegExp(`\\b${left.text}\\.close\\(|return\\s+${left.text}\\s*(?:;|$|\\n)|self\\.\\w+\\s*=\\s*${left.text}\\b`).test(fnText)) continue;
    out.push(finding(ctx, 'lifecycle.resource-not-released', lineOf(a), a.text, `\`${left.text}\` is opened without \`with\` and never closed.`));
  }
  if (!SQL_TXN.test(fnText)) {
    const strings = nodes.filter((n) => isStringNode(n) && n.text.length < 600).slice(0, 80);
    for (const sel of strings) {
      const sm = /\bSELECT\b[\s\S]*?\bFROM\s+(\w+)/i.exec(sel.text);
      if (!sm) continue;
      for (const upd of strings) {
        if (upd.startIndex <= sel.startIndex) continue;
        const um = /\bUPDATE\s+(\w+)\s+SET\b[\s\S]*?\bWHERE\s+([^;"']*)/i.exec(upd.text);
        if (!um || um[1]!.toLowerCase() !== sm[1]!.toLowerCase() || /\bAND\b|\bOR\b|\bIS\s+(?:NOT\s+)?NULL\b|[<>]/i.test(um[2]!)) continue;
        out.push(finding(ctx, 'lifecycle.check-then-act', lineOf(upd), upd.text, `Row in ${um[1]} is read, then updated with only a key predicate; concurrent requests can both pass the check.`));
        break;
      }
    }
  }
}

function goLike(ctx: FileContext, fn: TSNode, out: RawFinding[]): void {
  const nodes = descendants(fn);
  const fnText = fn.text;
  const returnsError = /\berror\b/.test(fn.childForFieldName('result')?.text ?? '');
  if (returnsError) {
    for (const s of nodes.filter((x) => x.type === 'if_statement')) {
      const cond = s.childForFieldName('condition')?.text ?? '';
      const cons = s.childForFieldName('consequence')?.text.replace(/\s+/g, ' ').trim() ?? '';
      if (/\berr\s*!=\s*nil\b/.test(cond) && /^\{\s*return nil\s*\}$/.test(cons)) {
        out.push(finding(ctx, 'error.swallowed-success', lineOf(s), s.text, 'The error is checked and then `return nil` reports success.'));
      }
    }
  }
  for (const d of nodes.filter((x) => x.type === 'short_var_declaration')) {
    const left = safeName(d.childForFieldName('left')?.namedChildren[0]?.text);
    const right = d.childForFieldName('right')?.text ?? '';
    const m = /^(os\.Open|os\.Create|sql\.Open|net\.Dial|http\.Get|http\.Post)\(/.exec(right);
    if (!left || !m) continue;
    const closer = m[1]!.startsWith('http.') ? `${left}.Body.Close()` : `${left}.Close()`;
    if (fnText.includes(closer) || new RegExp(`return\\s+${left}\\s*(?:;|$|\\n|\\})`).test(fnText)) continue;
    out.push(finding(ctx, 'lifecycle.resource-not-released', lineOf(d), d.text, `\`${left}\` is never closed (expected \`defer ${closer}\`).`));
  }
}

function javaLike(ctx: FileContext, fn: TSNode, out: RawFinding[]): void {
  const nodes = descendants(fn);
  const fnText = fn.text;
  for (const d of nodes.filter((x) => x.type === 'variable_declarator')) {
    const name = safeName(d.childForFieldName('name')?.text);
    const value = d.childForFieldName('value')?.text ?? '';
    if (!name || !/^(?:new\s+(?:FileInputStream|FileOutputStream|FileReader|FileWriter|Socket|BufferedReader|Scanner)\b|\w+\.getConnection\()/.test(value)) continue;
    let inResources = false;
    for (let p = d.parent; p; p = p.parent) if (p.type === 'resource_specification' || p.type === 'resource') inResources = true;
    if (inResources || new RegExp(`\\b${name}\\.close\\(|return\\s+${name}\\s*(?:;|$|\\n|\\})`).test(fnText)) continue;
    out.push(finding(ctx, 'lifecycle.resource-not-released', lineOf(d), d.text, `\`${name}\` is opened outside try-with-resources and never closed.`));
  }
  for (const c of nodes.filter((x) => x.type === 'catch_clause')) {
    const body = c.childForFieldName('body');
    const stmts = body?.namedChildren.filter((x): x is TSNode => x !== null && x.type !== 'line_comment' && x.type !== 'block_comment') ?? [];
    const hasComment = body?.namedChildren.some((x) => x?.type === 'line_comment' || x?.type === 'block_comment') ?? false;
    if (stmts.length === 0 && !hasComment) out.push(finding(ctx, 'error.empty-catch', lineOf(c), c.text, 'The catch block is empty.'));
    const real = stmts.filter((x) => !/printStackTrace|log\./.test(x.text));
    if (real.length === 1 && real[0]!.type === 'return_statement' && SUCCESS_VALUE.test((real[0]!.namedChild(0)?.text ?? 'null').trim()) && CHECKISH.test(functionName(fn))) {
      out.push(finding(ctx, 'error.swallowed-success', lineOf(c), c.text, `The exception is replaced by \`${real[0]!.text}\`, which callers will read as success.`));
    }
  }
}

function cLike(ctx: FileContext, fn: TSNode, out: RawFinding[]): void {
  const nodes = descendants(fn);
  const fnText = fn.text;
  for (const d of nodes.filter((x) => x.type === 'init_declarator')) {
    const name = safeName(d.childForFieldName('declarator')?.text.replace(/^\*+/, ''));
    const value = d.childForFieldName('value')?.text ?? '';
    if (!name || !/^fopen\(/.test(value)) continue;
    if (new RegExp(`fclose\\(\\s*${name}\\s*\\)|return\\s+${name}\\s*(?:;|$|\\n|\\})`).test(fnText)) continue;
    out.push(finding(ctx, 'lifecycle.resource-not-released', lineOf(d), d.text, `\`${name}\` is opened with fopen and never closed with fclose.`));
  }
}

/** Lifecycle, error-path and race analyzers (the shapes behind Athena's own Bend-found bugs). */
export function analyzeLifecycle(ctx: FileContext, nodes: TSNode[]): RawFinding[] {
  const out: RawFinding[] = [];
  const fns = nodes.filter((n) => isFunctionNode(n, ctx.family));
  const asyncNames = new Set(fns.filter((f) => /^(?:export\s+)?(?:default\s+)?async\b/.test(f.text) || f.text.startsWith('async ')).map((f) => functionName(f)).filter(Boolean));
  for (const fn of fns) {
    switch (ctx.family) {
      case 'js': jsLike(ctx, fn, out, asyncNames); break;
      case 'python': pythonLike(ctx, fn, out); break;
      case 'go': goLike(ctx, fn, out); break;
      case 'java': javaLike(ctx, fn, out); break;
      case 'c': cLike(ctx, fn, out); break;
      default: break;
    }
  }
  // Nested functions are visited both as themselves and inside their parent: drop exact duplicates.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.ruleId}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

void meaningfulStatements;
