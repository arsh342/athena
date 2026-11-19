import { advisoryOf, type Advisory } from '../deps/osv.js';
import { inRange } from './version.js';
import { loadRecords, readMeta, type SlimVuln } from './store.js';

const norm = (eco: string, name: string): string => (eco === 'PyPI' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name);

class EcoIndex {
  private readonly byName = new Map<string, SlimVuln[]>();
  constructor(readonly eco: string, records: Map<string, SlimVuln>) {
    for (const v of records.values()) {
      if (v.withdrawn) continue;
      const names = new Set<string>();
      for (const a of v.affected ?? []) if (a.package?.name && (!a.package.ecosystem || a.package.ecosystem === eco)) names.add(norm(eco, a.package.name));
      for (const n of names) this.byName.set(n, [...(this.byName.get(n) ?? []), v]);
    }
  }
  query(name: string, version: string): SlimVuln[] {
    return (this.byName.get(norm(this.eco, name)) ?? []).filter((v) => (v.affected ?? []).some((a) => {
      if (!a.package?.name || norm(this.eco, a.package.name) !== norm(this.eco, name)) return false;
      if (a.versions?.includes(version) || a.versions?.includes(version.replace(/^v/, ''))) return true;
      return (a.ranges ?? []).some((r) => r.type !== 'GIT' && inRange(version, (r.events ?? []) as never));
    }));
  }
}

const cache = new Map<string, { stamp: string; index: EcoIndex }>();

/** Does a local database exist for this ecosystem? */
export function hasLocal(eco: string, home?: string): boolean {
  return readMeta(eco, home) !== null;
}

/** Advisories affecting `name@version`, answered from the local database (no network). */
export function queryLocal(eco: string, name: string, version: string, home?: string): Advisory[] {
  const meta = readMeta(eco, home);
  if (!meta) return [];
  const key = `${home ?? ''}\0${eco}`;
  let entry = cache.get(key);
  if (!entry || entry.stamp !== meta.updatedAt) {
    entry = { stamp: meta.updatedAt, index: new EcoIndex(eco, loadRecords(eco, home)) };
    cache.set(key, entry);
  }
  return entry.index.query(name, version).map((v) => advisoryOf(v as never, { ecosystem: eco as never, name }));
}

export function forgetLocalCache(): void {
  cache.clear();
}
