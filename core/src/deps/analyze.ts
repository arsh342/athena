import { createHash } from 'node:crypto';

import type { ClassifiedFinding, ExplainedScore, Severity } from '../types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { discoverManifests, discoverSources, readManifest, relManifest } from './discover.js';
import { declaredJsPackages, missingApis } from './api-exists.js';
import { collectUsage, reachabilityOf } from './reachability.js';
import { NODE_BUILTINS } from './usage.js';
import { DepsClient, type DepsClientOptions } from './net.js';
import { depKey, queryVulnerabilities, type Advisory } from './osv.js';
import { parseManifests, uniqueQueries } from './parsers/index.js';
import { lookupPackage, RELIABLE_EXISTENCE, type PackageInfo } from './registries.js';
import { popularList, typosquatOf } from './typosquat.js';
import type { Dependency } from './types.js';

export interface DepsOptions extends DepsClientOptions {
  /** Look packages up on registries (existence, deprecation, freshness). OSV is always queried. */
  registryChecks?: boolean;
  /** Override the popular-package lists (tests). */
  popular?: Partial<Record<Dependency['ecosystem'], string[]>>;
  /** Fresh-release cooldown (default 72 h). */
  cooldownMs?: number;
  /** Extra analysis hook: advisories get a reachability verdict from the project's imports. */
  reachability?: (dep: Dependency, advisory: Advisory) => 'reached' | 'not-reached' | 'unknown';
}

export interface DepsResult {
  findings: ClassifiedFinding[];
  dependencies: Dependency[];
  /** Coverage check detail: why dependency data may be incomplete. */
  gaps: string[];
  status: 'ran' | 'unavailable' | 'failed';
  detail: string;
}

const NO_SCORE: ExplainedScore = { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] };
const DAY = 24 * 3600 * 1000;

const lower = (s: Severity): Severity => (s === 'CRITICAL' ? 'HIGH' : s === 'HIGH' ? 'MEDIUM' : 'LOW');

function make(root: string, d: Dependency, ruleId: string, severity: Severity, type: string, message: string, extra: Partial<ClassifiedFinding> = {}): ClassifiedFinding {
  const file = relManifest(root, d.manifest);
  return {
    id: createHash('sha1').update(`${ruleId}:${file}:${d.ecosystem}:${d.name}:${d.version}:${extra.evidence?.[0] ?? ''}`).digest('hex').slice(0, 10),
    severity,
    type,
    category: 'dependency',
    message,
    file: d.manifest,
    line: d.line,
    column: 1,
    code: `${d.name}${d.version ? `@${d.version}` : ''}`,
    aiScore: 0,
    explainedScore: NO_SCORE,
    source: 'athena-deps',
    ruleId,
    confidence: 'high',
    dependency: { ecosystem: d.ecosystem, name: d.name, version: d.version, manifest: file },
    ...extra,
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

/** Dependency intelligence for the project at `root`: vulnerabilities, malicious/nonexistent/typosquatted/deprecated/fresh packages. */
export async function analyzeDependencies(root: string, options: DepsOptions = {}): Promise<DepsResult> {
  const manifests = await discoverManifests(root);
  if (manifests.length === 0) return { findings: [], dependencies: [], gaps: [], status: 'ran', detail: 'no manifests found' };
  const deps = await parseManifests(manifests, readManifest);
  const privateScopes = await privateNpmScopes(root, manifests);
  for (const d of deps) if (d.ecosystem === 'npm' && d.name.startsWith('@') && privateScopes.has(d.name.split('/')[0]!)) d.registryPrivate = true;
  const client = new DepsClient(options);
  const findings: ClassifiedFinding[] = [];
  const gaps: string[] = [];
  const now = (options.now ?? Date.now)();

  const sources = await discoverSources(root);
  const usage = await collectUsage(sources);
  const reach = options.reachability ?? ((d: Dependency, a: Advisory) => reachabilityOf(usage, d, a));
  const queries = uniqueQueries(deps);
  const vulns = await queryVulnerabilities(client, queries);
  if (vulns.unavailable > 0) gaps.push(`${vulns.unavailable} vulnerability lookup(s) unavailable`);

  for (const d of deps) {
    if (d.private || !d.version) continue;
    for (const adv of vulns.advisories.get(depKey(d)) ?? []) {
      const verdict = reach(d, adv);
      const base = adv.severity;
      const severity = verdict === 'not-reached' && !adv.malicious ? lower(base) : base;
      const fix = adv.fixed.length > 0 ? ` Upgrade to ${adv.fixed.sort().pop()} or later.` : ' No fixed version is listed.';
      const evidence = [`advisory ${adv.id}${adv.aliases.length ? ` (${adv.aliases.slice(0, 3).join(', ')})` : ''}`];
      if (verdict === 'reached') evidence.push('the affected API is imported by this project');
      if (verdict === 'not-reached') evidence.push(`severity lowered from ${base}: the affected API is not imported by this project`);
      findings.push(make(root, d, adv.malicious ? 'deps.malicious-package' : 'deps.vulnerable', severity, adv.malicious ? 'Malicious package' : 'Vulnerable dependency',
        adv.malicious ? `${d.name}@${d.version} is a known malicious package (${adv.id}). Remove it and rotate any secrets it could read.` : `${d.name}@${d.version}: ${adv.summary} (${adv.id}).${fix}`, { evidence }));
    }
  }

  if (options.registryChecks !== false) {
    const seen = new Map<string, PackageInfo | 'notfound' | 'unavailable'>();
    const targets = deps.filter((d) => !d.private && (d.version || RELIABLE_EXISTENCE.has(d.ecosystem)));
    const unique = new Map(targets.map((d) => [`${d.ecosystem}\0${d.name}\0${d.version}`, d]));
    let unavailable = 0;
    await pool([...unique.values()], 8, async (d) => {
      const res = await lookupPackage(client, d);
      if (!res) return;
      if (res.status === 'ok') seen.set(`${d.ecosystem}\0${d.name}\0${d.version}`, res.info);
      else if (res.status === 'notfound') seen.set(`${d.ecosystem}\0${d.name}\0${d.version}`, 'notfound');
      else {
        seen.set(`${d.ecosystem}\0${d.name}\0${d.version}`, 'unavailable');
        unavailable += 1;
      }
    });
    if (unavailable > 0) gaps.push(`${unavailable} registry lookup(s) unavailable`);
    const cooldown = options.cooldownMs ?? 3 * DAY;
    for (const d of deps) {
      if (d.private) continue;
      const r = seen.get(`${d.ecosystem}\0${d.name}\0${d.version}`);
      if (!r || r === 'unavailable') continue;
      if (r === 'notfound') {
        if (RELIABLE_EXISTENCE.has(d.ecosystem) && !d.registryPrivate) findings.push(make(root, d, 'deps.package-not-found', 'HIGH', 'Package does not exist', `${d.name} is not on the ${d.ecosystem} registry. It may be a hallucinated name; anyone could register it and ship malicious code to you. Remove it or point it at the package you meant.`));
        continue;
      }
      if (r.deprecated) findings.push(make(root, d, 'deps.deprecated', 'MEDIUM', 'Deprecated dependency', `${d.name}@${d.version} is deprecated: ${r.deprecated.slice(0, 160)}`));
      if (r.yanked) findings.push(make(root, d, 'deps.yanked', 'MEDIUM', 'Yanked release', `${d.name}@${d.version} was yanked by its maintainers. Move to a newer release.`));
      if (r.versionPublished !== null && now - r.versionPublished < cooldown && now >= r.versionPublished) findings.push(make(root, d, 'deps.fresh-release', 'MEDIUM', 'Very new release', `${d.name}@${d.version} was published less than ${Math.round(cooldown / 3600000)} hours ago. New releases are where hijacked packages show up; wait out the cooldown or review it.`));
      if (r.latestPublished !== null && now - r.latestPublished > 3 * 365 * DAY && r.archivedOrAbandoned) findings.push(make(root, d, 'deps.abandoned', 'LOW', 'Abandoned package', `${d.name} has had no release in over three years and is marked inactive.`));
      if (d.direct && r.installScripts.length > 0) findings.push(make(root, d, 'deps.install-script', 'MEDIUM', 'Install script', `${d.name}@${d.version} runs ${r.installScripts.join(', ')} when installed. Review the script or install with --ignore-scripts.`));
    }
  }

  for (const d of deps) {
    if (!d.direct || d.private) continue;
    const list = options.popular?.[d.ecosystem] ?? popularList(d.ecosystem);
    const like = typosquatOf(d.ecosystem, d.name, list);
    if (like) findings.push(make(root, d, 'deps.typosquat', 'MEDIUM', 'Possible typosquat', `${d.name} looks like a misspelling of the popular package ${like}. If you meant ${like}, fix the name; if not, check who publishes ${d.name}.`));
  }

  if (options.registryChecks !== false) {
    // Imports of packages that are not declared anywhere and do not exist on the registry: hallucinated names.
    const declared = declaredJsPackages(root, manifests);
    const aliases = tsAliases(root, manifests);
    const candidates: Array<{ pkg: string; file: string; line: number }> = [];
    for (const [pkg, uses] of usage.byPackage) {
      const js = uses.filter((u) => /\.[cm]?[jt]sx?$/.test(u.file));
      if (js.length === 0 || declared.has(pkg) || (pkg.startsWith('@') && privateScopes.has(pkg.split('/')[0]!)) || NODE_BUILTINS.has(pkg) || pkg.startsWith('@types/') || aliases.some((a) => pkg === a || pkg.startsWith(`${a}/`))) continue;
      candidates.push({ pkg, file: js[0]!.file, line: js[0]!.use.line });
    }
    await pool(candidates.slice(0, 60), 8, async (c) => {
      const res = await lookupPackage(client, { ecosystem: 'npm', name: c.pkg, version: '' });
      if (res?.status !== 'notfound') return;
      const d: Dependency = { ecosystem: 'npm', name: c.pkg, version: '', direct: true, manifest: c.file, line: c.line };
      findings.push(make(root, d, 'deps.undeclared-import', 'HIGH', 'Imported package not declared and not found', `${c.pkg} is imported but is not in any package.json and does not exist on the npm registry. It is likely a hallucinated package name.`));
    });
  }

  const byId = new Map(findings.map((f) => [`${f.id}:${f.file}:${f.line}`, f]));
  const out = [...byId.values()];
  const detail = client.offline
    ? `offline${Number.isFinite(client.stats.oldestCache) ? ` (cache from ${new Date(client.stats.oldestCache).toISOString().slice(0, 10)})` : ' (no cache)'}`
    : `${deps.length} dependencies from ${manifests.length} manifest(s)`;
  if (client.offline && client.stats.unavailable > 0 && client.stats.cacheHits === 0) return { findings: out, dependencies: deps, gaps: [...gaps, 'dependencies: offline and no cached data'], status: 'unavailable', detail };
  return { findings: out, dependencies: deps, gaps, status: 'ran', detail };
}

function tsAliases(root: string, manifests: string[]): string[] {
  const out: string[] = [];
  for (const dir of new Set([root, ...manifests.map((m) => m.replace(/[\\/][^\\/]+$/, ''))])) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      try {
        const cfg = JSON.parse(readFileSync(join(dir, name), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { compilerOptions?: { paths?: Record<string, unknown>; baseUrl?: string } };
        for (const key of Object.keys(cfg.compilerOptions?.paths ?? {})) out.push(key.replace(/\/?\*$/, ''));
      } catch {
        // missing or non-JSON tsconfig: no aliases
      }
    }
  }
  return out.filter(Boolean);
}

/** HIGH findings for members that the installed package's type declarations do not contain. Offline. */
export async function checkApiExistence(root: string): Promise<ClassifiedFinding[]> {
  const findings: ClassifiedFinding[] = [];
  for (const file of await discoverSources(root)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of missingApis(root, file, source)) {
      findings.push({
        id: createHash('sha1').update(`api:${file}:${m.line}:${m.pkg}.${m.member}`).digest('hex').slice(0, 10),
        severity: 'HIGH',
        type: 'Hallucinated API call',
        category: 'runtime-failure',
        message: `${m.member} does not exist in ${m.pkg}${m.version && m.version !== 'node' ? `@${m.version}` : ''} (checked against its type declarations). This call will fail at runtime.`,
        file: m.file,
        line: m.line,
        column: 1,
        code: m.code,
        aiScore: 0,
        explainedScore: NO_SCORE,
        source: 'hallucination-detector',
        ruleId: 'hallucination.invalid-api-call',
        confidence: 'high',
      });
    }
  }
  return findings;
}

/** Scopes mapped to a non-default registry in .npmrc or .yarnrc.yml: their packages are private, never "not found". */
async function privateNpmScopes(root: string, manifests: string[]): Promise<Set<string>> {
  const scopes = new Set<string>();
  const dirs = new Set([root, ...manifests.map((m) => m.replace(/[\\/][^\\/]+$/, ''))]);
  for (const dir of dirs) {
    for (const name of ['.npmrc', '.yarnrc.yml']) {
      let text: string;
      try {
        text = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(/^\s*(@[\w.-]+):registry\s*=/gm)) scopes.add(m[1]!);
      for (const m of text.matchAll(/^\s{2,}["']?(@?[\w.-]+)["']?:\s*\n(?:\s+.*\n)*?\s+npmRegistryServer:/gm)) scopes.add(m[1]!.startsWith('@') ? m[1]! : `@${m[1]!}`);
    }
  }
  return scopes;
}
