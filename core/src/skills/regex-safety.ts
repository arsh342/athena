import { Script } from 'node:vm';

/**
 * Skills from third parties are untrusted: their regular expressions run over every line of the user's code.
 * Reject patterns that are long, use backreferences, nest quantifiers, or are measurably slow on adversarial input.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)(?:[+*]|\{\d+(?:,\d*)?\})/;
const QUANTIFIED_ALTERNATION = /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+(?:,\d*)?\})/;
const BACKREFERENCE = /\\[1-9]|\(\?<[=!]/;
const PROBES = ['a'.repeat(3000), `${'a'.repeat(1500)}!`, `${' '.repeat(2000)}x`, `${'ab'.repeat(1000)}c`, `${'/'.repeat(1000)}.`];

export interface RegexVerdict {
  ok: boolean;
  regex?: RegExp;
  reason?: string;
}

const WILDCARD_ATOM = /(?:\.|\[\\s\\S\]|\[\\S\\s\]|\[\^[^\]]*\]|\\[SWD])(?:\*|\+|\{\d+,\d*\})/g;
const UNBOUNDED = /(?:\*|\+|\{\d+,\d*\})/g;

/** Counting rules for patterns from third parties: a few quantifiers, at most two over wildcard-like atoms. */
function tooManyQuantifiers(source: string): string | null {
  const flat = source.replace(/\\./g, 'c').replace(/\[(?:\\.|[^\]\\])*\]/g, (m) => (m.startsWith('[^') || /^\[\\?[sS]\\?[sS]\]$/.test(m) ? '[^x]' : 'c'));
  const wildcards = (source.match(WILDCARD_ATOM) ?? []).length;
  const unbounded = (flat.match(UNBOUNDED) ?? []).length;
  if (wildcards > 2) return 'more than two wildcard repetitions (.*, [\\s\\S]*, [^x]*) can backtrack polynomially';
  if (unbounded > 4) return 'more than four unbounded repetitions';
  if (/\\k</.test(source)) return 'named backreferences are not allowed';
  return null;
}

function literalProbes(source: string): string[] {
  const chars = [...new Set(source.replace(/\\./g, '').match(/[A-Za-z0-9#:;.,/=_-]/g) ?? [])];
  if (chars.length === 0) return [];
  const unit = chars.join('');
  const long = unit.repeat(Math.ceil(1500 / unit.length));
  return [long, `${long}\u0001`, `${chars[0]!.repeat(1500)}\u0001`];
}

export function compileSafeRegex(source: string, flags = '', options: { strict?: boolean } = {}): RegexVerdict {
  if (source.length === 0 || source.length > 400) return { ok: false, reason: 'pattern must be 1-400 characters' };
  if (BACKREFERENCE.test(source)) return { ok: false, reason: 'backreferences and lookbehind are not allowed (lookahead is fine)' };
  if (NESTED_QUANTIFIER.test(source) || QUANTIFIED_ALTERNATION.test(source)) return { ok: false, reason: 'nested quantifiers or repeated alternation can backtrack catastrophically' };
  if (options.strict) {
    const reason = tooManyQuantifiers(source);
    if (reason) return { ok: false, reason };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    return { ok: false, reason: `invalid pattern: ${error instanceof Error ? error.message : String(error)}` };
  }
  // The probes run in a sandbox with a watchdog: a catastrophic pattern is interrupted instead of hanging the loader.
  const script = new Script('probes.some((p) => { const started = Date.now(); re.test(p); return Date.now() - started > 25; })');
  try {
    if (script.runInNewContext({ re: new RegExp(source, flags), probes: [...PROBES, ...literalProbes(source)] }, { timeout: 150 }) === true) return { ok: false, reason: 'pattern is slow on adversarial input' };
  } catch {
    return { ok: false, reason: 'pattern is slow on adversarial input' };
  }
  regex.lastIndex = 0;
  return { ok: true, regex };
}
