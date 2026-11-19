import { parse as parseToml } from 'smol-toml';

import type { Dependency } from '../types.js';
import { dep, lineOf } from './helpers.js';

/** pom.xml: declared dependencies with `${property}` resolution (including the parent-less project's own properties). */
export function parsePom(path: string, text: string): Dependency[] {
  const props = new Map<string, string>();
  for (const m of text.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) for (const p of m[1]!.matchAll(/<([\w.-]+)>\s*([^<]+?)\s*<\/\1>/g)) props.set(p[1]!, p[2]!);
  const version = /<project[^>]*>[\s\S]*?<version>\s*([^<]+?)\s*<\/version>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, ''))?.[1];
  if (version) props.set('project.version', version);
  const resolve = (v: string): string => v.replace(/\$\{([^}]+)\}/g, (_m, k: string) => props.get(k) ?? '${' + k + '}');
  const out: Dependency[] = [];
  for (const block of text.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const g = /<groupId>\s*([^<]+?)\s*<\/groupId>/.exec(block[1]!)?.[1];
    const a = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(block[1]!)?.[1];
    const v = /<version>\s*([^<]+?)\s*<\/version>/.exec(block[1]!)?.[1];
    if (!g || !a) continue;
    const resolved = v ? resolve(v) : '';
    out.push(dep('Maven', `${resolve(g)}:${a}`, resolved, true, path, lineOf(text, `<artifactId>${a}</artifactId>`), resolved && !resolved.includes('${') ? {} : { unpinned: true }));
  }
  return out;
}

export function parseGradleLock(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  text.split('\n').forEach((line, i) => {
    const m = /^([\w.-]+):([\w.-]+):([^=\s]+)=/.exec(line.trim());
    if (m) out.push(dep('Maven', `${m[1]}:${m[2]}`, m[3]!, false, path, i + 1));
  });
  return out;
}

export function parseNugetLock(path: string, text: string): Dependency[] {
  let doc: { dependencies?: Record<string, Record<string, { resolved?: string; type?: string }>> };
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const framework of Object.values(doc.dependencies ?? {})) {
    for (const [name, info] of Object.entries(framework)) if (info.resolved) out.push(dep('NuGet', name, info.resolved, info.type === 'Direct', path, lineOf(text, `"${name}"`)));
  }
  return out;
}

export function parseCsproj(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  for (const m of text.matchAll(/<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/gi)) {
    const attrs = m[1]!;
    const name = /Include=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!name) continue;
    const version = /Version=["']([^"']+)["']/i.exec(attrs)?.[1] ?? /<Version>\s*([^<]+?)\s*<\/Version>/i.exec(m[2] ?? '')?.[1] ?? '';
    out.push(dep('NuGet', name, version.replace(/[\[\]()]/g, '').split(',')[0]!, true, path, lineOf(text, name), { unpinned: !/^\d/.test(version) || /[*,]/.test(version) }));
  }
  return out;
}

export function parseGoMod(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  let inBlock = false;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; return; }
    if (inBlock && line === ')') { inBlock = false; return; }
    const m = inBlock ? /^(\S+)\s+(v\S+)/.exec(line) : /^require\s+(\S+)\s+(v\S+)/.exec(line);
    if (m) out.push(dep('Go', m[1]!, m[2]!, !/\/\/\s*indirect/.test(raw), path, i + 1));
  });
  return out;
}

export function parseCargoLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  let doc: { package?: Array<{ name?: string; version?: string; source?: string }> };
  try {
    doc = parseToml(text) as typeof doc;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const p of doc.package ?? []) {
    if (!p.name || !p.version) continue;
    // Workspace members and path crates have no `source`; git sources are private-ish and skipped from registry lookups.
    if (!p.source) continue;
    out.push(dep('crates.io', p.name, p.version, directNames.has(p.name), path, lineOf(text, `name = "${p.name}"`), p.source.startsWith('registry+') ? {} : { private: true }));
  }
  return out;
}

export function parseCargoToml(path: string, text: string): Dependency[] {
  let doc: Record<string, Record<string, unknown>>;
  try {
    doc = parseToml(text) as typeof doc;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const key of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
    for (const [name, v] of Object.entries(doc[key] ?? {})) {
      const spec = typeof v === 'string' ? v : (v as { version?: string })?.version ?? '';
      const isPrivate = typeof v === 'object' && v !== null && ('path' in v || 'git' in v || 'workspace' in v);
      out.push(dep('crates.io', name, String(spec).replace(/^[\^~=<>\s]+/, ''), true, path, lineOf(text, name), { unpinned: true, ...(isPrivate ? { private: true } : {}) }));
    }
  }
  return out;
}

export function parseComposerLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  let doc: { packages?: Array<{ name?: string; version?: string }>; 'packages-dev'?: Array<{ name?: string; version?: string }> };
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const p of [...(doc.packages ?? []), ...(doc['packages-dev'] ?? [])]) {
    if (p.name && p.version) out.push(dep('Packagist', p.name, p.version.replace(/^v/, ''), directNames.has(p.name), path, lineOf(text, `"${p.name}"`)));
  }
  return out;
}

export function parseVcpkg(path: string, text: string): Dependency[] {
  let doc: { dependencies?: Array<string | { name?: string; 'version>='?: string }>; overrides?: Array<{ name?: string; version?: string }> };
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const d of doc.dependencies ?? []) {
    const name = typeof d === 'string' ? d : d.name;
    if (name) out.push(dep('vcpkg', name, typeof d === 'string' ? '' : d['version>='] ?? '', true, path, lineOf(text, `"${name}"`), { unpinned: true }));
  }
  return out;
}

export function parseConanLock(path: string, text: string): Dependency[] {
  let doc: { requires?: string[]; build_requires?: string[] };
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const ref of [...(doc.requires ?? []), ...(doc.build_requires ?? [])]) {
    const m = /^([\w.+-]+)\/([\w.+-]+)/.exec(ref);
    if (m) out.push(dep('Conan', m[1]!, m[2]!, true, path, lineOf(text, ref)));
  }
  return out;
}
