import type { FamilyPack } from '../types.js';
import { lineRule, sink } from './helpers.js';

export const shellPack: FamilyPack = {
  family: 'shell',
  sources: [/^\$\{?(?:[1-9@*]|#)\}?$/],
  sanitizers: [/^(?:printf %q|basename|realpath|readlink|shellescape)$/],
  cleanCalls: /^(?:wc|expr|date|id|true|false|test|seq)$/,
  sinks: [
    sink('taint.command-injection', /^(?:eval|bash|sh|zsh|source|\.|xargs)$/, 'any'),
    sink('taint.ssrf', /^(?:curl|wget|nc|ncat)$/, 'any'),
  ],
  callRules: [],
  lineRules: [
    lineRule('shell.pipe-to-shell', /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/),
    lineRule('shell.world-writable', /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx|ugo\+rwx)\b/),
    lineRule('shell.unquoted-expansion', /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(?:[^"'\n]*\s)?\$\{?\w+\}?(?:\/|\s|$)(?!.*["'])/),
    lineRule('tls.verification-disabled', /\bcurl\b[^\n]*(?:\s-k\b|--insecure)|\bwget\b[^\n]*--no-check-certificate/),
    lineRule('config.insecure-temp-file', /\bmktemp\s+-u\b|>\s*\/tmp\/[\w.-]+\s*(?:$|;|&)|\/tmp\/\$\$/),
  ],
};
