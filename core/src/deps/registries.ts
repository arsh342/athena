import type { DepsClient, Fetched } from './net.js';
import type { Dependency } from './types.js';

export interface PackageInfo {
  deprecated: string | null;
  yanked: boolean;
  /** Publication time of the exact version, when the registry says. */
  versionPublished: number | null;
  /** Time of the newest release. */
  latestPublished: number | null;
  installScripts: string[];
  archivedOrAbandoned: boolean;
}

export type Lookup = { status: 'ok'; info: PackageInfo } | { status: 'notfound' } | { status: 'unavailable'; reason: string };

const empty = (): PackageInfo => ({ deprecated: null, yanked: false, versionPublished: null, latestPublished: null, installScripts: [], archivedOrAbandoned: false });
const ms = (v: unknown): number | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

function wrap<T>(res: Fetched<T>, map: (data: T) => PackageInfo): Lookup {
  if (res.kind === 'notfound') return { status: 'notfound' };
  if (res.kind === 'unavailable') return { status: 'unavailable', reason: res.reason };
  return { status: 'ok', info: map(res.data) };
}

/** Ecosystems whose "not found" answer is reliable enough to call a package non-existent without review. */
/*
 * Registry documents list every release with its full metadata (dependencies, file lists, readmes). Only a few fields are used, so each response
 * is reduced to those before it is cached or kept: a version absent from the reduced `versions` map simply has nothing to report.
 */
type Json = Record<string, any>;
function slimNpm(data: Json): Json {
  const versions: Json = {};
  for (const [v, doc] of Object.entries((data?.versions ?? {}) as Json)) {
    const scripts: Json = {};
    for (const s of ['preinstall', 'install', 'postinstall']) if (doc?.scripts?.[s]) scripts[s] = doc.scripts[s];
    if (doc?.deprecated || Object.keys(scripts).length > 0 || doc?.hasInstallScript) {
      versions[v] = { ...(doc.deprecated ? { deprecated: String(doc.deprecated).slice(0, 300) } : {}), scripts, ...(doc.hasInstallScript ? { hasInstallScript: true } : {}) };
    }
  }
  return { versions, time: data?.time ?? {}, 'dist-tags': data?.['dist-tags'] ?? {} };
}
function slimPypi(data: Json): Json {
  const releases: Json = {};
  for (const [v, files] of Object.entries((data?.releases ?? {}) as Json)) {
    const f = Array.isArray(files) ? files[0] : undefined;
    releases[v] = f ? [{ yanked: !!f.yanked, upload_time_iso_8601: f.upload_time_iso_8601 }] : [];
  }
  return { info: { classifiers: data?.info?.classifiers ?? [] }, releases };
}
function slimCrates(data: Json): Json {
  return { crate: { updated_at: data?.crate?.updated_at }, versions: ((data?.versions ?? []) as Json[]).map((v) => ({ num: v.num, yanked: v.yanked, created_at: v.created_at })) };
}

export const RELIABLE_EXISTENCE: ReadonlySet<Dependency['ecosystem']> = new Set(['npm', 'PyPI', 'crates.io', 'Packagist', 'NuGet']);

export async function lookupPackage(client: DepsClient, d: Pick<Dependency, 'ecosystem' | 'name' | 'version'>): Promise<Lookup | null> {
  const u = client.urls;
  switch (d.ecosystem) {
    case 'npm': {
      const res = await client.json<{ versions?: Record<string, { deprecated?: string; scripts?: Record<string, string>; hasInstallScript?: boolean }>; time?: Record<string, string>; 'dist-tags'?: { latest?: string } }>('GET', `${u.npm}/${d.name.replace('/', '%2f')}`, { slim: slimNpm });
      return wrap(res, (data) => {
        const v = data.versions?.[d.version];
        const scripts = v?.scripts ?? {};
        const info = empty();
        info.deprecated = v?.deprecated ?? null;
        info.versionPublished = ms(data.time?.[d.version]);
        info.latestPublished = ms(data.time?.[data['dist-tags']?.latest ?? ''] ?? data.time?.modified);
        info.installScripts = ['preinstall', 'install', 'postinstall'].filter((s) => scripts[s]);
        if (info.installScripts.length === 0 && v?.hasInstallScript) info.installScripts = ['install'];
        return info;
      });
    }
    case 'PyPI': {
      const res = await client.json<{ info?: { classifiers?: string[] }; releases?: Record<string, Array<{ yanked?: boolean; upload_time_iso_8601?: string }>> }>('GET', `${u.pypi}/pypi/${encodeURIComponent(d.name)}/json`, { slim: slimPypi });
      return wrap(res, (data) => {
        const info = empty();
        const rel = data.releases?.[d.version]?.[0];
        info.yanked = !!rel?.yanked;
        info.versionPublished = ms(rel?.upload_time_iso_8601);
        const all = Object.values(data.releases ?? {}).flat().map((r) => ms(r.upload_time_iso_8601)).filter((x): x is number => x !== null);
        info.latestPublished = all.length > 0 ? Math.max(...all) : null;
        info.archivedOrAbandoned = !!data.info?.classifiers?.some((c) => /Development Status :: 7 - Inactive/.test(c));
        return info;
      });
    }
    case 'crates.io': {
      const res = await client.json<{ versions?: Array<{ num?: string; yanked?: boolean; created_at?: string }>; crate?: { updated_at?: string } }>('GET', `${u.crates}/api/v1/crates/${encodeURIComponent(d.name)}`, { slim: slimCrates });
      return wrap(res, (data) => {
        const info = empty();
        const v = data.versions?.find((x) => x.num === d.version);
        info.yanked = !!v?.yanked;
        info.versionPublished = ms(v?.created_at);
        info.latestPublished = ms(data.crate?.updated_at);
        return info;
      });
    }
    case 'Packagist': {
      const res = await client.json<{ packages?: Record<string, Array<{ version?: string; time?: string; abandoned?: boolean | string }>> }>('GET', `${u.packagist}/p2/${d.name}.json`);
      return wrap(res, (data) => {
        const info = empty();
        const list = data.packages?.[d.name] ?? [];
        const v = list.find((x) => x.version?.replace(/^v/, '') === d.version);
        info.versionPublished = ms(v?.time);
        info.latestPublished = list.map((x) => ms(x.time)).filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null;
        const ab = list[0]?.abandoned;
        info.deprecated = ab ? (typeof ab === 'string' ? `abandoned, use ${ab}` : 'abandoned') : null;
        return info;
      });
    }
    case 'NuGet': {
      const res = await client.json<{ versions?: string[] }>('GET', `${u.nuget}/v3-flatcontainer/${d.name.toLowerCase()}/index.json`);
      return wrap(res, () => empty());
    }
    case 'Maven': {
      const [g, a] = d.name.split(':');
      const res = await client.json<{ response?: { numFound?: number; docs?: Array<{ timestamp?: number }> } }>('GET', `${u.maven}/solrsearch/select?q=${encodeURIComponent(`g:"${g}" AND a:"${a}"`)}&rows=1&wt=json`);
      if (res.kind === 'ok' && (res.data.response?.numFound ?? 0) === 0) return { status: 'notfound' };
      return wrap(res, (data) => {
        const info = empty();
        const t = data.response?.docs?.[0]?.timestamp;
        info.latestPublished = typeof t === 'number' ? t : null;
        return info;
      });
    }
    case 'Go': {
      const escaped = d.name.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
      const res = await client.json<{ Version?: string; Time?: string }>('GET', `${u.goproxy}/${escaped}/@v/${d.version}.info`);
      return wrap(res, (data) => {
        const info = empty();
        info.versionPublished = ms(data.Time);
        info.latestPublished = info.versionPublished;
        return info;
      });
    }
    default:
      return null;
  }
}
