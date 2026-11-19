import { randomUUID } from 'node:crypto';

import type { ScanReport } from '../types.js';

export interface InventoryItem { ecosystem: string; name: string; version: string; direct: boolean; manifest: string }

/** Package URL for a dependency (https://github.com/package-url/purl-spec). */
export function purl(ecosystem: string, name: string, version: string): string | null {
  const v = version ? `@${encodeURIComponent(version.replace(/^v(?=\d)/, ''))}` : '';
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  switch (ecosystem) {
    case 'npm': return `pkg:npm/${name.startsWith('@') ? `%40${enc(name.slice(1))}` : enc(name)}${v}`;
    case 'PyPI': return `pkg:pypi/${enc(name.toLowerCase())}${v}`;
    case 'Maven': {
      const [g, a] = name.split(':');
      return g && a ? `pkg:maven/${enc(g)}/${enc(a)}${v}` : null;
    }
    case 'NuGet': return `pkg:nuget/${enc(name)}${v}`;
    case 'Go': return `pkg:golang/${enc(name)}${v ? `@${encodeURIComponent(version)}` : ''}`;
    case 'crates.io': return `pkg:cargo/${enc(name)}${v}`;
    case 'Packagist': return `pkg:composer/${enc(name)}${v}`;
    default: return null;
  }
}

const SEVERITY: Record<string, string> = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

/** CycloneDX 1.6 SBOM (JSON) from the scan's dependency inventory, with the vulnerabilities Athena found. */
export function formatCycloneDx(report: ScanReport, options: { toolVersion: string; projectName?: string }): string {
  const inventory = report.inventory ?? [];
  const seen = new Map<string, InventoryItem>();
  for (const d of inventory) {
    const key = `${d.ecosystem}\0${d.name}\0${d.version}`;
    if (!seen.has(key) || d.direct) seen.set(key, d);
  }
  const ref = (d: InventoryItem) => purl(d.ecosystem, d.name, d.version) ?? `${d.ecosystem}:${d.name}@${d.version}`;
  const components = [...seen.values()].map((d) => ({
    type: 'library',
    'bom-ref': ref(d),
    name: d.name,
    ...(d.version ? { version: d.version } : {}),
    ...(purl(d.ecosystem, d.name, d.version) ? { purl: purl(d.ecosystem, d.name, d.version) } : {}),
    properties: [{ name: 'athena:direct', value: String(d.direct) }, { name: 'athena:manifest', value: d.manifest }],
  }));
  const vulnerabilities: object[] = [];
  const byId = new Map<string, { id: string; summary: string; severity: string; affects: Set<string> }>();
  for (const f of report.files.flatMap((x) => x.findings)) {
    if (f.source !== 'athena-deps' || !f.dependency || !/^deps\.(vulnerable|malicious-package)$/.test(f.ruleId)) continue;
    const id = /\(((?:GHSA|CVE|MAL|PYSEC|RUSTSEC|GO)-[\w-]+)\)/.exec(f.message)?.[1] ?? /advisory ([\w-]+)/.exec(f.evidence?.[0] ?? '')?.[1] ?? f.id;
    const entry = byId.get(id) ?? { id, summary: f.message, severity: SEVERITY[f.severity] ?? 'unknown', affects: new Set<string>() };
    entry.affects.add(ref({ ...f.dependency, direct: true } as InventoryItem));
    byId.set(id, entry);
  }
  for (const v of byId.values()) {
    vulnerabilities.push({ id: v.id, source: { name: 'OSV' }, description: v.summary, ratings: [{ severity: v.severity }], affects: [...v.affects].map((r) => ({ ref: r })) });
  }
  return JSON.stringify({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: { timestamp: report.timestamp, tools: { components: [{ type: 'application', name: 'athena', version: options.toolVersion }] }, ...(options.projectName ? { component: { type: 'application', name: options.projectName, 'bom-ref': 'root' } } : {}) },
    components,
    vulnerabilities,
  }, null, 2);
}
