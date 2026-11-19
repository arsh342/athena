/** Find new reviewed HIGH/CRITICAL advisories that link a fix commit (OSV records, which include GitHub Advisory Database entries). */
export interface OsvRecord {
  id: string;
  aliases?: string[];
  summary?: string;
  published?: string;
  modified?: string;
  withdrawn?: string;
  database_specific?: { severity?: string; cwe_ids?: string[]; github_reviewed?: boolean };
  references?: Array<{ type?: string; url?: string }>;
  affected?: Array<{ package?: { ecosystem?: string; name?: string } }>;
}

export interface Candidate {
  id: string;
  aliases: string[];
  ecosystem: string;
  pkg: string;
  severity: 'HIGH' | 'CRITICAL';
  summary: string;
  cwe: string[];
  fix: { owner: string; repo: string; sha: string };
}

export interface Skipped { id: string; reason: string }

const COMMIT = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/commit\/([0-9a-f]{7,40})\b/;

export function fixCommitOf(record: OsvRecord): { owner: string; repo: string; sha: string } | null {
  for (const ref of record.references ?? []) {
    const m = ref.url ? COMMIT.exec(ref.url) : null;
    if (m && (ref.type === 'FIX' || ref.type === 'WEB' || ref.type === undefined)) return { owner: m[1]!, repo: m[2]!, sha: m[3]! };
  }
  return null;
}

/** Turn a record into a candidate, or say why it was skipped (shown in the PR/run summary, never silent). */
export function toCandidate(record: OsvRecord, ecosystems: string[]): Candidate | Skipped {
  if (record.withdrawn) return { id: record.id, reason: 'withdrawn' };
  if (!record.id.startsWith('GHSA-')) return { id: record.id, reason: 'not a reviewed GitHub advisory' };
  const severity = record.database_specific?.severity?.toUpperCase();
  if (severity !== 'HIGH' && severity !== 'CRITICAL') return { id: record.id, reason: `severity ${severity ?? 'unknown'} is below HIGH` };
  const affected = record.affected?.find((a) => a.package?.name && a.package.ecosystem && ecosystems.includes(a.package.ecosystem));
  if (!affected) return { id: record.id, reason: 'no supported ecosystem' };
  const fix = fixCommitOf(record);
  if (!fix) return { id: record.id, reason: 'no fix commit linked' };
  return { id: record.id, aliases: record.aliases ?? [], ecosystem: affected.package!.ecosystem!, pkg: affected.package!.name!, severity, summary: record.summary ?? record.id, cwe: record.database_specific?.cwe_ids ?? [], fix };
}

/** Records modified after `since` for one ecosystem, via the OSV export listing. */
export async function findNew(options: { since: string; ecosystem: string; base?: string; fetchText?: (url: string) => Promise<string>; limit?: number }): Promise<{ candidates: Candidate[]; skipped: Skipped[] }> {
  const base = options.base ?? 'https://osv-vulnerabilities.storage.googleapis.com';
  const get = options.fetchText ?? (async (u: string) => {
    const r = await fetch(u, { headers: { 'user-agent': 'athena-advisory-watch' } });
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.text();
  });
  const ids = (await get(`${base}/${options.ecosystem}/modified_id.csv`)).split('\n').filter(Boolean)
    .map((l) => l.split(',') as [string, string]).filter(([at, id]) => at > options.since && id.startsWith('GHSA-')).map(([, id]) => id.trim());
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const id of [...new Set(ids)].slice(0, options.limit ?? 200)) {
    const c = toCandidate(JSON.parse(await get(`${base}/${options.ecosystem}/${id}.json`)) as OsvRecord, [options.ecosystem]);
    if ('reason' in c) skipped.push(c);
    else candidates.push(c);
  }
  return { candidates, skipped };
}
