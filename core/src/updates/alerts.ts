import type { Advisory } from '../deps/osv.js';
import type { ScanReport } from '../types.js';
import { hasLocal, queryLocal } from './vulndb.js';

export interface Alert { ecosystem: string; name: string; version: string; manifest: string; advisory: Advisory }

/**
 * Re-check a past scan's dependency inventory against the current local advisory data and return the vulnerabilities
 * the scan did not already report. Ecosystems without a local database are listed in `missing` (nothing is sent anywhere).
 */
export function newAlerts(previous: ScanReport, home?: string): { alerts: Alert[]; missing: string[]; checked: number } {
  const known = new Set<string>();
  for (const f of previous.files.flatMap((x) => x.findings)) {
    if (f.source !== 'athena-deps' || !f.dependency) continue;
    for (const m of f.evidence?.[0]?.matchAll(ADVISORY_ID) ?? []) known.add(`${f.dependency.ecosystem}\0${f.dependency.name}\0${f.dependency.version}\0${m[0]}`);
  }
  return alertsForInventory(previous.inventory ?? [], known, home);
}

/** Advisory ids already reported for a package: keys are `ecosystem\0name\0version\0id`. */
export const ADVISORY_ID = /(?:GHSA|CVE|MAL|PYSEC|RUSTSEC|GO|OSV)-[\w-]+/g;

export function alertsForInventory(inventory: Array<{ ecosystem: string; name: string; version: string; manifest: string }>, known: Set<string>, home?: string): { alerts: Alert[]; missing: string[]; checked: number } {
  const alerts: Alert[] = [];
  const missing = new Set<string>();
  let checked = 0;
  const done = new Set<string>();
  for (const d of inventory) {
    const key = `${d.ecosystem}\0${d.name}\0${d.version}`;
    if (!d.version || done.has(key)) continue;
    done.add(key);
    if (!hasLocal(d.ecosystem, home)) {
      missing.add(d.ecosystem);
      continue;
    }
    checked += 1;
    for (const adv of queryLocal(d.ecosystem, d.name, d.version, home)) {
      if ([adv.id, ...adv.aliases].some((id) => known.has(`${key}\0${id}`))) continue;
      alerts.push({ ecosystem: d.ecosystem, name: d.name, version: d.version, manifest: d.manifest, advisory: adv });
    }
  }
  return { alerts, missing: [...missing].sort(), checked };
}
