import { LANGUAGE_FAMILY, type LanguageFamily, type LanguageId } from '../lang/languages.js';
import { murmur3 } from './murmur3.js';

/** Bump on ANY change to the feature definition; the model file records the spec it was trained with. */
export const FEATURE_SPEC = 'fs1';
export const HASH_SEED = 0x41544845;
export const HASH_BITS = 18;
export const HASH_BUCKETS = 1 << HASH_BITS;
export const FAMILIES: LanguageFamily[] = ['js', 'python', 'java', 'csharp', 'c', 'go', 'rust', 'php', 'shell'];

export const DENSE_FEATURE_NAMES = [
  'lines', 'code_lines', 'blank_ratio', 'comment_ratio', 'avg_line_len', 'max_line_len', 'std_line_len',
  'comment_len_avg', 'comment_line_share_trailing', 'doc_comment', 'ident_len_avg', 'ident_unique_ratio',
  'snake_ratio', 'camel_ratio', 'upper_ratio', 'short_ident_ratio', 'long_ident_ratio',
  'tab_indent_ratio', 'indent_consistency', 'trailing_ws_ratio', 'semicolon_ratio',
  'dq_ratio', 'sq_ratio', 'trailing_comma_ratio', 'number_literal_density', 'string_literal_density',
  'punct_density', 'avg_tokens_per_line', 'try_density', 'todo_count', 'non_ascii_ratio', 'blank_run_max',
  'early_return_density', 'type_annotation_density', 'param_count',
] as const;

export interface FeatureInput {
  code: string;
  name?: string;
}

export interface UnitFeatures {
  dense: Float32Array;
  /** Signed, log-scaled, L2-normalised hashed n-gram values keyed by bucket. */
  hashed: Map<number, number>;
  /** One-hot over FAMILIES. */
  family: Float32Array;
}

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\sA-Za-z0-9_]/g;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_CHARS = 6000;

function ratio(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function extractFeatures(unit: FeatureInput, lang: LanguageId): UnitFeatures {
  const code = unit.code.length > MAX_CHARS ? unit.code.slice(0, MAX_CHARS) : unit.code;
  const lines = code.split(/\r?\n/);
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const commentPrefix = lang === 'python' || lang === 'shell' ? /^\s*#/ : /^\s*(\/\/|\/\*|\*|#)/;
  const commentLines = lines.filter((l) => commentPrefix.test(l));
  const codeLines = nonBlank.length - commentLines.length;
  const lengths = nonBlank.map((l) => l.length);
  const meanLen = ratio(lengths.reduce((a, b) => a + b, 0), lengths.length);
  const stdLen = Math.sqrt(ratio(lengths.reduce((a, b) => a + (b - meanLen) ** 2, 0), lengths.length));

  const tokens = code.match(TOKEN_RE) ?? [];
  const idents = tokens.filter((t) => IDENT_RE.test(t));
  const identLens = idents.map((t) => t.length);
  const identSet = new Set(idents);
  const snake = idents.filter((t) => t.includes('_') && t === t.toLowerCase()).length;
  const camel = idents.filter((t) => /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)).length;
  const upper = idents.filter((t) => t.length > 1 && t === t.toUpperCase()).length;

  const indents = nonBlank.map((l) => /^[ \t]*/.exec(l)![0]);
  const tabLines = indents.filter((i) => i.startsWith('\t')).length;
  const spaceWidths = indents.filter((i) => i.length > 0 && !i.includes('\t')).map((i) => i.length);
  const unit2 = spaceWidths.length > 0 ? Math.min(...spaceWidths) : 0;
  const consistent = unit2 > 0 ? spaceWidths.filter((w) => w % unit2 === 0).length : 0;

  const trailing = lines.filter((l) => /[ \t]+$/.test(l)).length;
  const semis = nonBlank.filter((l) => l.trimEnd().endsWith(';')).length;
  const dq = (code.match(/"/g) ?? []).length;
  const sq = (code.match(/'/g) ?? []).length;
  const trailingComma = nonBlank.filter((l) => l.trimEnd().endsWith(',')).length;
  const numbers = tokens.filter((t) => /^\d/.test(t)).length;
  const strings = tokens.filter((t) => t[0] === '"' || t[0] === "'").length;
  const punct = tokens.filter((t) => t.length === 1 && /[^\sA-Za-z0-9_]/.test(t)).length;
  const tryCount = (code.match(/\b(?:try|catch|except|rescue|finally)\b/g) ?? []).length;
  const todo = (code.match(/\b(?:TODO|FIXME|XXX|HACK)\b/g) ?? []).length;
  const nonAscii = (code.match(/[^\x00-\x7f]/g) ?? []).length;
  const earlyReturns = (code.match(/^\s*(?:if|unless)\b.*\b(?:return|continue|break|raise|throw)\b/gm) ?? []).length;
  const typeAnn = (code.match(/[:)]\s*(?:string|number|boolean|int|str|bool|float|void|\w+\[\]|List|Dict|Optional)\b|->\s*\w/g) ?? []).length;
  let blankRun = 0;
  let maxRun = 0;
  for (const l of lines) {
    blankRun = l.trim() === '' ? blankRun + 1 : 0;
    if (blankRun > maxRun) maxRun = blankRun;
  }
  const commentLens = commentLines.map((l) => l.trim().length);
  const trailingComments = nonBlank.filter((l) => !commentPrefix.test(l) && /\s(?:\/\/|#)\s*\S/.test(l)).length;
  const params = /\(([^()]*)\)/.exec(code);
  const paramCount = params && params[1]!.trim() !== '' ? params[1]!.split(',').length : 0;
  const doc = /^\s*(?:\/\*\*|"""|'''|\/\/\/)/m.test(code) || /^\s*"""/m.test(code) ? 1 : 0;

  const dense = Float32Array.from([
    Math.log1p(lines.length), Math.log1p(codeLines), ratio(lines.length - nonBlank.length, lines.length),
    ratio(commentLines.length, nonBlank.length), meanLen / 100, Math.max(0, ...lengths) / 200, stdLen / 100,
    ratio(commentLens.reduce((a, b) => a + b, 0), commentLens.length) / 100, ratio(trailingComments, nonBlank.length), doc,
    ratio(identLens.reduce((a, b) => a + b, 0), identLens.length) / 20, ratio(identSet.size, idents.length),
    ratio(snake, idents.length), ratio(camel, idents.length), ratio(upper, idents.length),
    ratio(identLens.filter((n) => n <= 2).length, idents.length), ratio(identLens.filter((n) => n >= 15).length, idents.length),
    ratio(tabLines, nonBlank.length), ratio(consistent, spaceWidths.length), ratio(trailing, lines.length), ratio(semis, nonBlank.length),
    ratio(dq, dq + sq), ratio(sq, dq + sq), ratio(trailingComma, nonBlank.length), ratio(numbers, tokens.length), ratio(strings, tokens.length),
    ratio(punct, tokens.length), ratio(tokens.length, nonBlank.length) / 20, ratio(tryCount, nonBlank.length), Math.min(todo, 5) / 5,
    ratio(nonAscii, code.length), Math.min(maxRun, 5) / 5, ratio(earlyReturns, nonBlank.length), ratio(typeAnn, nonBlank.length), Math.min(paramCount, 10) / 10,
  ]);

  const counts = new Map<number, number>();
  const add = (feature: string): void => {
    const h = murmur3(feature, HASH_SEED);
    const bucket = h & (HASH_BUCKETS - 1);
    const sign = (h >>> 31) === 1 ? -1 : 1;
    counts.set(bucket, (counts.get(bucket) ?? 0) + sign);
  };
  const norm = tokens.map((t) => (/^\d/.test(t) ? '<num>' : t[0] === '"' || t[0] === "'" ? '<str>' : t));
  for (let i = 0; i < norm.length; i += 1) {
    add(`u:${norm[i]}`);
    if (i + 1 < norm.length) add(`b:${norm[i]} ${norm[i + 1]}`);
  }
  const compact = code.replace(/[ \t]+/g, ' ').slice(0, 3000);
  for (let n = 3; n <= 5; n += 1) {
    for (let i = 0; i + n <= compact.length; i += 1) add(`c${n}:${compact.slice(i, i + n)}`);
  }

  const hashed = new Map<number, number>();
  let sumSq = 0;
  for (const [bucket, count] of counts) {
    if (count === 0) continue;
    const value = Math.sign(count) * Math.log1p(Math.abs(count));
    hashed.set(bucket, value);
    sumSq += value * value;
  }
  const scale = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
  for (const [bucket, value] of hashed) hashed.set(bucket, Math.fround(value * scale));

  const family = new Float32Array(FAMILIES.length);
  family[FAMILIES.indexOf(LANGUAGE_FAMILY[lang])] = 1;
  return { dense, hashed, family };
}
