import { callInfo } from './lang.js';
import type { TSNode } from '../lang/parser-pool.js';
import { isFunctionNode } from './lang.js';
import type { FamilyPack, FileContext, RawFinding } from '../rules/types.js';

const COMMENT_ONLY = /^\s*(\/\/|#(?!!)|\/\*|\*|--|<!--)/;

/** Runs call rules (on every call) and line rules (on non-comment lines) of a family pack. */
export function runPatternRules(file: FileContext, pack: FamilyPack): RawFinding[] {
  const findings: RawFinding[] = [];
  const family = file.family;

  const stack: Array<[TSNode, string]> = [[file.root, '']];
  while (stack.length > 0) {
    const [node, fnText] = stack.pop()!;
    const call = callInfo(node, family, fnText);
    if (call) {
      for (const rule of pack.callRules) {
        if (!rule.callee.test(call.callee)) continue;
        const evidence = rule.test ? rule.test(call, file) : '';
        if (evidence === null) continue;
        findings.push({
          ruleId: rule.id, line: call.line, code: node.text.replace(/\s+/g, ' ').slice(0, 140),
          ...(evidence ? { message: evidence } : {}), source: 'athena-rules',
        });
      }
    }
    const nextFn = isFunctionNode(node, family) ? node.text : fnText;
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const c = children[i];
      if (c && c.isNamed) stack.push([c, nextFn]);
    }
  }

  file.lines.forEach((text, index) => {
    if (COMMENT_ONLY.test(text) || text.length > 400) return;
    for (const rule of pack.lineRules) {
      if (rule.line.test(text) && (!rule.test || rule.test(text, file))) {
        findings.push({ ruleId: rule.id, line: index + 1, code: text.trim().slice(0, 140), source: 'athena-rules' });
      }
    }
  });
  return findings;
}
