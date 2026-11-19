/**
 * Token-based randomness score for candidate secrets (the idea behind Betterleaks): instead of Shannon
 * entropy, ask how much of the string is made of ordinary words/code tokens and how often the character
 * class changes. "ThisIsAReallyLongString" is entirely words; "k8Vq2LmZpX9aRt4wYb7N" is not.
 */
const WORDS = new Set((
  'this is a an the really long string very value name user admin test data file path url host port key token secret password pass word get set add new old max min low high default config setting settings option options enable disable true false null none empty nil void number text content body header footer title label button input output error warning info debug trace level mode type kind class object array list map hash table index count total size length width height color image icon logo page view model controller service handler manager factory builder helper util utils common base core main app application server client request response session cookie cache store state context provider consumer event listener callback promise async await sync load save read write open close start stop begin end first last next prev previous current local global public private protected static final const let var function method property field param parameter argument return result status message code success failure invalid valid required optional version release build deploy production development staging environment database query select insert update delete create remove find search filter sort group order limit offset page cursor token auth login logout signup register account profile email phone address street city country region zone domain subdomain website webhook callback redirect secure encrypt decrypt cipher random generate generated sample example placeholder demo foo bar baz hello world lorem ipsum dolor sit amet from with without into onto over under above below before after between across through during within against along among around behind beyond inside outside toward upon'
).split(/\s+/));

function classOf(ch: string): number {
  if (/[a-z]/.test(ch)) return 1;
  if (/[A-Z]/.test(ch)) return 2;
  if (/[0-9]/.test(ch)) return 3;
  return 4;
}

export function shannon(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Share of characters covered by known words after splitting camelCase / snake / digits. */
export function wordCoverage(value: string): number {
  const parts = value.split(/[^A-Za-z]+/).flatMap((chunk) => chunk.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? []);
  let covered = 0;
  for (const part of parts) if (part.length >= 2 && WORDS.has(part.toLowerCase())) covered += part.length;
  return covered / value.length;
}

export function classTransitions(value: string): number {
  let n = 0;
  for (let i = 1; i < value.length; i += 1) if (classOf(value[i]!) !== classOf(value[i - 1]!)) n += 1;
  return n / (value.length - 1 || 1);
}

export interface GenericVerdict {
  secret: boolean;
  reason: string;
}

/** Decide whether a quoted/assigned string looks like a random credential. */
export function looksLikeRandomSecret(value: string, keywordContext = false): GenericVerdict {
  if (value.length < (keywordContext ? 12 : 24) || value.length > 200) return { secret: false, reason: 'length' };
  if (/^[0-9a-f]{40}$/i.test(value) && !keywordContext) return { secret: false, reason: 'git sha' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return { secret: false, reason: 'uuid' };
  if (/^(?:https?:|\/|\.\/|[A-Za-z]:\\)/.test(value) || /\s/.test(value)) return { secret: false, reason: 'url or path' };
  if (/^[A-Za-z]+(?:[._-][A-Za-z]+)+$/.test(value) && wordCoverage(value) > 0.4) return { secret: false, reason: 'identifier' };
  if (wordCoverage(value) >= 0.5) return { secret: false, reason: 'dictionary words' };
  const classes = new Set([...value].map(classOf)).size;
  const entropy = shannon(value);
  if (classes < 2) return { secret: false, reason: 'single character class' };
  if (entropy < 3.5) return { secret: false, reason: 'low entropy' };
  if (classTransitions(value) < (keywordContext ? 0.25 : 0.4)) return { secret: false, reason: 'few class transitions' };
  return { secret: true, reason: `entropy ${entropy.toFixed(1)}, ${Math.round(classTransitions(value) * 100)}% class changes` };
}
