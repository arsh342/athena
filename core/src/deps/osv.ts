import type { Severity } from '../types.js';
import type { DepsClient } from './net.js';
import type { Dependency } from './types.js';
import { hasLocal, queryLocal } from '../updates/vulndb.js';

export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  malicious: boolean;
  fixed: string[];
  /** Functions/symbols the advisory says are affected (when the database lists them). */
  symbols: string[];
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { ecosystem?: string; name?: string };
    ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string }> }>;
    ecosystem_specific?: { affected_functions?: string[]; imports?: Array<{ symbols?: string[] }> };
  }>;
}

const OSV_ECOSYSTEM: Record<string, string> = { npm: 'npm', PyPI: 'PyPI', Maven: 'Maven', NuGet: 'NuGet', Go: 'Go', 'crates.io': 'crates.io', Packagist: 'Packagist' };

/** CVSS v3.x base score from a vector string. */
export function cvss3Score(vector: string): number | null {
  const m = new Map(vector.split('/').slice(1).map((p) => p.split(':') as [string, string]));
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.get('AV') ?? ''];
  const ac = { L: 0.77, H: 0.44 }[m.get('AC') ?? ''];
  const scopeChanged = m.get('S') === 'C';
  const pr = ({ N: 0.85, L: scopeChanged ? 0.68 : 0.62, H: scopeChanged ? 0.5 : 0.27 } as Record<string, number>)[m.get('PR') ?? ''];
  const ui = { N: 0.85, R: 0.62 }[m.get('UI') ?? ''];
  const impact = (k: string) => ({ H: 0.56, L: 0.22, N: 0 })[m.get(k) as 'H' | 'L' | 'N'];
  const [c, i, a] = [impact('C'), impact('I'), impact('A')];
  if ([av, ac, pr, ui, c, i, a].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impactScore = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impactScore <= 0) return 0;
  const exploit = 8.22 * av! * ac! * pr! * ui!;
  const raw = scopeChanged ? Math.min(1.08 * (impactScore + exploit), 10) : Math.min(impactScore + exploit, 10);
  return Math.ceil(raw * 10) / 10;
}

export function severityFromScore(score: number): Severity {
  return score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW';
}

export function advisoryOf(v: OsvVuln, dep: Pick<Dependency, 'ecosystem' | 'name'>): Advisory {
  const malicious = v.id.startsWith('MAL-');
  let severity: Severity = 'MEDIUM';
  const text = v.database_specific?.severity?.toUpperCase();
  const vector = v.severity?.find((s) => s.type?.startsWith('CVSS_V3'))?.score;
  if (malicious) severity = 'CRITICAL';
  else if (vector && cvss3Score(vector) !== null) severity = severityFromScore(cvss3Score(vector)!);
  else if (text) severity = text === 'MODERATE' ? 'MEDIUM' : (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(text) ? (text as Severity) : 'MEDIUM');
  const fixed = new Set<string>();
  const symbols = new Set<string>();
  for (const a of v.affected ?? []) {
    if (a.package?.name && a.package.name !== dep.name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed.add(e.fixed);
    for (const f of a.ecosystem_specific?.affected_functions ?? []) symbols.add(f);
    for (const imp of a.ecosystem_specific?.imports ?? []) for (const s of imp.symbols ?? []) symbols.add(s);
  }
  return { id: v.id, aliases: v.aliases ?? [], summary: v.summary ?? v.details?.split('\n')[0]?.slice(0, 160) ?? v.id, severity, malicious, fixed: [...fixed], symbols: [...symbols] };
}

export interface VulnResult {
  advisories: Map<string, Advisory[]>;
  unavailable: number;
}

const key = (d: Pick<Dependency, 'ecosystem' | 'name' | 'version'>): string => `${d.ecosystem}\0${d.name}\0${d.version}`;
export const depKey = key;

/** Query OSV for every unique package version (batches of 1,000), then fetch each distinct advisory once. */
export async function queryVulnerabilities(client: DepsClient, queries: Array<Pick<Dependency, 'ecosystem' | 'name' | 'version'>>, local: { enabled: boolean; home?: string } = { enabled: false }): Promise<VulnResult> {
  const advisories = new Map<string, Advisory[]>();
  let unavailable = 0;
  const idsFor = new Map<string, string[]>();
  const usable = queries.filter((q) => OSV_ECOSYSTEM[q.ecosystem]);
  // Ecosystems with a local database are answered from it (no network); the rest fall back to the OSV API.
  const supported: typeof usable = [];
  for (const q of usable) {
    if (local.enabled && hasLocal(q.ecosystem, local.home)) {
      const list = queryLocal(q.ecosystem, q.name, q.version, local.home);
      if (list.length > 0) advisories.set(key(q), list);
    } else supported.push(q);
  }
  for (let i = 0; i < supported.length; i += 1000) {
    const chunk = supported.slice(i, i + 1000);
    const body = { queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: OSV_ECOSYSTEM[q.ecosystem] }, version: q.version.replace(/^v(?=\d)/, '') })) };
    const res = await client.json<{ results?: Array<{ vulns?: Array<{ id: string }> }> }>('POST', `${client.osvUrl}/v1/querybatch`, { body, advisory: true });
    if (res.kind !== 'ok') {
      unavailable += chunk.length;
      continue;
    }
    chunk.forEach((q, n) => idsFor.set(key(q), (res.data.results?.[n]?.vulns ?? []).map((v) => v.id)));
  }
  const details = new Map<string, OsvVuln | null>();
  const distinct = [...new Set([...idsFor.values()].flat())];
  await Promise.all(distinct.map(async (id) => {
    const res = await client.json<OsvVuln>('GET', `${client.osvUrl}/v1/vulns/${encodeURIComponent(id)}`, { advisory: true });
    if (res.kind === 'ok') details.set(id, res.data);
    else {
      details.set(id, null);
      if (res.kind === 'unavailable') unavailable += 1;
    }
  }));
  for (const q of supported) {
    const list: Advisory[] = [];
    const seen = new Set<string>();
    for (const id of idsFor.get(key(q)) ?? []) {
      const v = details.get(id);
      const adv = v ? advisoryOf(v, q) : { id, aliases: [], summary: id, severity: 'MEDIUM' as Severity, malicious: id.startsWith('MAL-'), fixed: [], symbols: [] };
      // The same issue under several ids (GHSA/CVE aliases) is reported once.
      if ([adv.id, ...adv.aliases].some((x) => seen.has(x))) continue;
      for (const x of [adv.id, ...adv.aliases]) seen.add(x);
      list.push(adv);
    }
    if (list.length > 0) advisories.set(key(q), list);
  }
  return { advisories, unavailable };
}
