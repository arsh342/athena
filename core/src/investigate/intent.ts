import { functionName, isFunctionNode, isReturn } from '../analysis/lang.js';
import type { TSNode } from '../lang/parser-pool.js';
import type { FileContext, RawFinding } from '../rules/types.js';
import { isTestPath } from './types.js';

const VALIDATOR_NAME = /^(?:validate|verify|ensure|assert|check|isValid|is_valid|isAuthori[sz]ed|isAuthenticated|isAllowed|isSafe|hasPermission|has_permission|canAccess|can_access)\w*/i;
const PROMISE = /^\s*(?:\/\/|#|\*)\s*(?:we\s+|now\s+|first\s+|then\s+|make sure to\s+|must\s+|should\s+)?(sanitiz\w*|sanitis\w*|escap\w*|validat\w*|authenticat\w*|authoriz\w*|encrypt\w*)\b/i;
const CONCEPT: Record<string, RegExp> = {
  sanitiz: /sanitiz|sanitis|escape|purif|clean|encode|strip|replace|allow-?list|whitelist|quote|bleach|html\.escape/i,
  escap: /sanitiz|sanitis|escape|purif|clean|encode|strip|replace|quote|html\.escape/i,
  validat: /validat|schema|check|assert|parse|isValid|test\(|match\(|throw|raise|zod|joi|yup/i,
  authenticat: /auth|token|session|permission|role|jwt|login|verify|policy|passport|credential/i,
  authoriz: /auth|permission|role|policy|can\(|allow|owner|acl/i,
  encrypt: /encrypt|cipher|crypto|aes|hash|bcrypt|argon|scrypt|hmac|sign|seal/i,
};
const SECURITY_TODO = /\b(?:TODO|FIXME|HACK|XXX)\b.*\b(?:auth\w*|secur\w*|sanitiz\w*|sanitis\w*|validat\w*|escap\w*|encrypt\w*|password|csrf|xss|inject\w*|permission\w*|rate.?limit\w*)\b/i;
const COMMENT_LINE = /^\s*(?:\/\/|#|\/\*|\*|--)/;
const ASSERTION = /\b(?:expect|assert\w*|should|toBe\w*|toEqual|toThrow|rejects|resolves|throws|raises|pytest\.raises|self\.assert\w*|t\.(?:Error|Fatal|Fail)\w*|require\.\w+)/;

function finding(ruleId: string, line: number, code: string, message: string): RawFinding {
  return { ruleId, line, code: code.replace(/\s+/g, ' ').trim().slice(0, 140), message, source: 'athena-investigate' };
}

function returnsOf(fn: TSNode, family: FileContext['family']): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [...fn.children.filter((c): c is TSNode => !!c && c.isNamed)];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isFunctionNode(n, family)) continue;
    if (isReturn(n)) out.push(n);
    for (const c of n.children) if (c && c.isNamed) stack.push(c);
  }
  return out;
}

export function analyzeIntent(ctx: FileContext, nodes: TSNode[]): RawFinding[] {
  const out: RawFinding[] = [];

  // Validators that can never fail.
  for (const fn of nodes) {
    if (!isFunctionNode(fn, ctx.family)) continue;
    const name = functionName(fn);
    if (!name || !VALIDATOR_NAME.test(name)) continue;
    const returns = returnsOf(fn, ctx.family);
    if (returns.length === 0) continue;
    if (/\b(?:throw|raise|panic|abort|exit|reject|fail)\b|Error\s*\(|new \w*Exception/.test(fn.text)) continue;
    if (returns.every((r) => /^return\s+(?:true|True|TRUE)\s*;?$/.test(r.text.trim()))) {
      out.push(finding('intent.validator-never-fails', fn.startPosition.row + 1, `${name}(...)`, `\`${name}\` only ever returns true and never throws, so it cannot reject anything.`));
    }
  }

  // Comments that promise a security step the next lines do not perform; security TODOs.
  ctx.lines.forEach((line, i) => {
    if (!COMMENT_LINE.test(line) || line.length > 220) return;
    if (SECURITY_TODO.test(line)) {
      out.push(finding('intent.security-todo', i + 1, line, 'A comment marks unfinished security work.'));
      return;
    }
    const m = PROMISE.exec(line);
    if (!m) return;
    const stem = Object.keys(CONCEPT).find((k) => m[1]!.toLowerCase().startsWith(k));
    if (!stem) return;
    const window: string[] = [];
    for (let j = i + 1; j < ctx.lines.length && window.length < 4; j += 1) {
      const l = ctx.lines[j]!;
      if (l.trim() === '' || COMMENT_LINE.test(l)) continue;
      window.push(l);
    }
    if (window.length > 0 && !window.some((l) => CONCEPT[stem]!.test(l))) {
      out.push(finding('intent.comment-promises-security', i + 1, line, `The comment says to ${m[1]!.toLowerCase()}, but the following lines do not.`));
    }
  });

  // Tests that never assert.
  if (isTestPath(ctx.relPath)) {
    for (const n of nodes) {
      if (ctx.family === 'js' && n.type === 'call_expression') {
        const callee = n.childForFieldName('function')?.text ?? '';
        const args = n.childForFieldName('arguments')?.namedChildren ?? [];
        if (/^(?:it|test)$/.test(callee) && args.length >= 2 && /string|template/.test(args[0]!.type) && args[1] && isFunctionNode(args[1], 'js') && !ASSERTION.test(args[1].text)) {
          out.push(finding('intent.test-without-assertion', n.startPosition.row + 1, n.text.split('\n')[0] ?? '', 'The test body contains no assertion.'));
        }
      } else if (ctx.family === 'python' && n.type === 'function_definition') {
        const name = n.childForFieldName('name')?.text ?? '';
        if (/^test_/.test(name) && !/\bassert\b|pytest\.raises|self\.assert\w+|\.assert_\w+/.test(n.text)) {
          out.push(finding('intent.test-without-assertion', n.startPosition.row + 1, `def ${name}(...)`, 'The test body contains no assertion.'));
        }
      }
    }
  }
  return out;
}
