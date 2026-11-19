/** Version ordering good enough to evaluate OSV ranges for semver-like ecosystems, PEP 440 and Maven-style qualifiers. */
interface Parsed {
  epoch: number;
  release: number[];
  /** Lower than a release when present. `null` for a final release. */
  pre: Array<number | string> | null;
  post: number;
}

const PRE_WORDS = /^(?:alpha|beta|a|b|rc|c|pre|preview|dev|snapshot|m|milestone)/i;
const FINAL_WORDS = /^(?:final|release|ga|sp\d*)$/i;

export function parseVersion(raw: string): Parsed {
  let v = raw.trim().replace(/^v(?=\d)/i, '').replace(/\+.*$/, '');
  let epoch = 0;
  const e = /^(\d+)!/.exec(v);
  if (e) {
    epoch = Number(e[1]);
    v = v.slice(e[0].length);
  }
  const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(v);
  if (!m) return { epoch, release: [0], pre: [v.toLowerCase()], post: 0 };
  const release = m[1]!.split('.').map(Number);
  const rest = m[2]!.replace(/^[-._]/, '');
  let pre: Parsed['pre'] = null;
  let post = 0;
  if (rest) {
    const postM = /^(?:post|p|rev|r)\.?(\d+)$/i.exec(rest);
    if (postM) post = Number(postM[1]);
    else if (FINAL_WORDS.test(rest)) pre = null;
    else if (PRE_WORDS.test(rest) || /^\d/.test(rest) === false) pre = rest.toLowerCase().split(/[-._]/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    else pre = null;
  }
  return { epoch, release, pre, post };
}

const PRE_RANK: Record<string, number> = { dev: 0, snapshot: 0, alpha: 1, a: 1, beta: 2, b: 2, m: 2, milestone: 2, preview: 3, pre: 3, rc: 4, c: 4 };

function comparePre(a: Array<number | string>, b: Array<number | string>): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'number') return -1;
    else if (typeof y === 'number') return 1;
    else {
      const rx = PRE_RANK[x.replace(/\d+$/, '')] ?? 2.5;
      const ry = PRE_RANK[y.replace(/\d+$/, '')] ?? 2.5;
      if (rx !== ry) return rx < ry ? -1 : 1;
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x.epoch !== y.epoch) return x.epoch < y.epoch ? -1 : 1;
  for (let i = 0; i < Math.max(x.release.length, y.release.length); i += 1) {
    const p = x.release[i] ?? 0;
    const q = y.release[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  if (x.pre && y.pre) {
    const c = comparePre(x.pre, y.pre);
    if (c !== 0) return c;
  }
  return x.post === y.post ? 0 : x.post < y.post ? -1 : 1;
}

export interface RangeEvent { introduced?: string; fixed?: string; last_affected?: string; limit?: string }

/** OSV range evaluation: is `version` inside any introduced..fixed / last_affected interval? */
export function inRange(version: string, events: RangeEvent[]): boolean {
  const keyed = events.map((e) => ({ e, at: e.introduced ?? e.fixed ?? e.last_affected ?? e.limit ?? '0' }));
  keyed.sort((p, q) => (p.at === '0' ? (q.at === '0' ? 0 : -1) : q.at === '0' ? 1 : compareVersions(p.at, q.at) || (p.e.introduced !== undefined ? -1 : 1)));
  let affected = false;
  for (const { e } of keyed) {
    if (e.introduced !== undefined) {
      if (e.introduced === '0' || compareVersions(version, e.introduced) >= 0) affected = true;
    } else if (e.fixed !== undefined) {
      if (compareVersions(version, e.fixed) >= 0) affected = false;
    } else if (e.last_affected !== undefined) {
      if (compareVersions(version, e.last_affected) > 0) affected = false;
    }
  }
  return affected;
}
