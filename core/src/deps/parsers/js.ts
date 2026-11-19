import YAML from 'yaml';

import type { Dependency } from '../types.js';
import { dep, lineOf, PRIVATE_SPEC } from './helpers.js';

function declared(pkg: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = pkg[key];
    if (section && typeof section === 'object') for (const [n, v] of Object.entries(section)) out.set(n, String(v));
  }
  return out;
}

/** package.json: declared ranges (reported as unpinned unless a lockfile resolves them). */
export function parsePackageJson(path: string, text: string): Dependency[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const [name, spec] of declared(pkg)) {
    out.push(dep('npm', name, spec, true, path, lineOf(text, `"${name}"`), { unpinned: true, ...(PRIVATE_SPEC.test(spec) ? { private: true } : {}) }));
  }
  return out;
}

/** package-lock.json / npm-shrinkwrap.json, lockfile versions 1, 2 and 3. */
export function parseNpmLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  let lock: { packages?: Record<string, { version?: string; link?: boolean; resolved?: string }>; dependencies?: Record<string, { version?: string; resolved?: string; dependencies?: unknown }> };
  try {
    lock = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  const seen = new Set<string>();
  const push = (name: string, version: string | undefined, isPrivate: boolean, locator = `"${name}"`) => {
    if (!version || seen.has(`${name}@${version}`)) return;
    seen.add(`${name}@${version}`);
    out.push(dep('npm', name, version, directNames.has(name), path, lineOf(text, locator), isPrivate ? { private: true } : {}));
  };
  if (lock.packages) {
    for (const [key, info] of Object.entries(lock.packages)) {
      if (!key) continue;
      const name = key.split('node_modules/').pop()!;
      push(name, info.version, !!info.link || !!info.resolved && !/registry\.(?:npmjs\.org|yarnpkg\.com)/.test(info.resolved), `"${key}"`);
    }
  } else if (lock.dependencies) {
    const walk = (deps: Record<string, { version?: string; resolved?: string; dependencies?: unknown }>) => {
      for (const [name, info] of Object.entries(deps)) {
        push(name, info.version, !!info.version && PRIVATE_SPEC.test(info.version));
        if (info.dependencies && typeof info.dependencies === 'object') walk(info.dependencies as typeof deps);
      }
    };
    walk(lock.dependencies);
  }
  return out;
}

/** yarn.lock v1 and Berry. */
export function parseYarnLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  const out: Dependency[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^"?((?:@[^/@"]+\/)?[^@"\s,]+)@[^"]*"?(?:,\s*"?[^"]+"?)*:\s*$/.exec(lines[i]!);
    if (!header) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(lines[j]!);
      if (v) {
        const name = header[1]!;
        if (!seen.has(`${name}@${v[1]}`)) {
          seen.add(`${name}@${v[1]}`);
          out.push(dep('npm', name, v[1]!, directNames.has(name), path, i + 1));
        }
        break;
      }
    }
  }
  return out;
}

/** pnpm-lock.yaml (v5-v9). */
export function parsePnpmLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  let doc: { packages?: Record<string, unknown>; snapshots?: Record<string, unknown> };
  try {
    doc = YAML.parse(text) as typeof doc;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys({ ...(doc.packages ?? {}), ...(doc.snapshots ?? {}) })) {
    const m = /^\/?((?:@[^/@]+\/)?[^@/]+)[@/](\d[^(_\s]*)/.exec(key);
    if (!m) continue;
    const id = `${m[1]}@${m[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(dep('npm', m[1]!, m[2]!, directNames.has(m[1]!), path, lineOf(text, key)));
  }
  return out;
}

export function directNamesOf(text: string): Set<string> {
  try {
    return new Set(declared(JSON.parse(text) as Record<string, unknown>).keys());
  } catch {
    return new Set();
  }
}
