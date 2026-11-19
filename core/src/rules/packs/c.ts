import type { FamilyPack } from '../types.js';
import { argText, callRule, sink } from './helpers.js';

export const cPack: FamilyPack = {
  family: 'c',
  sources: [/^argv\[\d+\]/, /^getenv\(/, /^std::getenv\(/],
  sanitizers: [],
  cleanCalls: /^(?:atoi|atol|atoll|strtol|strtoul|strtoll|strtod|strlen|sizeof|abs)$/,
  sinks: [
    sink('taint.command-injection', /^(?:system|popen|execl|execlp|execv|execvp|WinExec|ShellExecute\w*)$/, [0]),
    sink('taint.format-string', /^(?:printf|vprintf|syslog)$/, [0]),
    sink('taint.format-string', /^(?:fprintf|sprintf|vsprintf|dprintf)$/, [1]),
    sink('taint.format-string', /^(?:snprintf)$/, [2]),
    sink('taint.path-traversal', /^(?:fopen|open|freopen|remove|unlink|rename|opendir|chmod|chown|access|stat|std::ifstream|std::ofstream)$/, [0]),
  ],
  callRules: [
    callRule('memory.unsafe-function', /^(?:gets)$/),
    callRule('memory.unsafe-function', /^(?:strcpy|strcat|stpcpy|wcscpy|wcscat|sprintf|vsprintf)$/, (call) => (call.args.length >= 2 && !/^["']/.test(argText(call, call.callee.includes('printf') ? 1 : 1)) ? `${call.callee}() writes without a bound.` : (call.callee.includes('printf') ? 'sprintf() writes without a bound.' : null))),
    callRule('memory.unsafe-function', /^(?:scanf|sscanf|fscanf)$/, (call) => (call.args.some((a) => /^["'][^"']*%s/.test(a.text)) ? `${call.callee}() with an unbounded %s.` : null)),
    callRule('memory.malloc-size-arithmetic', /^(?:malloc|alloca|realloc)$/, (call) => {
      const arg = call.args[call.callee === 'realloc' ? 1 : 0]?.text ?? '';
      return /[*]|<<|\+/.test(arg) && /[A-Za-z_]/.test(arg) && !/sizeof\s*\([^)]*\)\s*$/.test(arg.trim()) ? 'Allocation size is computed with arithmetic and no overflow check.' : /\*/.test(arg) && /[A-Za-z_]\w*\s*\*\s*[A-Za-z_]\w*/.test(arg) ? 'Allocation size multiplies two variables.' : null;
    }),
    callRule('memory.unchecked-malloc', /^(?:malloc|calloc)$/, (call) => {
      const line = call.node.parent?.parent?.text ?? '';
      const m = /(\w+)\s*=\s*(?:\(\s*[\w\s*]+\)\s*)?(?:malloc|calloc)\s*\(/.exec(line);
      if (!m) return null;
      return new RegExp(`(?:!\\s*${m[1]}\\b|${m[1]}\\s*(?:==|!=)\\s*(?:NULL|nullptr|0)\\b|if\\s*\\(\\s*${m[1]}\\s*\\))`).test(call.fnText) ? null : 'The allocation result is used without a NULL check.';
    }),
    callRule('config.insecure-temp-file', /^(?:mktemp|tmpnam|tempnam)$/),
  ],
  lineRules: [],
};
