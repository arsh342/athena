import { parse as parseToml } from 'smol-toml';

import type { Dependency } from '../types.js';
import { dep, lineOf } from './helpers.js';

const norm = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');

export function parseRequirements(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  const customIndex = /^\s*(?:--index-url|--extra-index-url|-i)[\s=]/m.test(text);
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || /^[a-z+]+:\/\//i.test(line)) return;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*((?:==|>=|<=|~=|!=|>|<|===)\s*[^;,\s]+(?:\s*,\s*(?:==|>=|<=|~=|!=|>|<)\s*[^;,\s]+)*)?/.exec(line);
    if (!m) return;
    const spec = (m[2] ?? '').replace(/\s+/g, '');
    const pinned = /^===?(\d[\w.!+-]*)$/.exec(spec);
    const minimum = /^(?:>=|~=)(\d[\w.!+-]*)/.exec(spec);
    out.push(dep('PyPI', norm(m[1]!), pinned?.[1] ?? minimum?.[1] ?? '', true, path, i + 1, { ...(pinned ? {} : { unpinned: true }), ...(customIndex ? { registryPrivate: true } : {}) }));
  });
  return out;
}

export function parsePoetryOrUvLock(path: string, text: string, directNames: Set<string>): Dependency[] {
  let doc: { package?: Array<{ name?: string; version?: string; source?: { type?: string; registry?: string; git?: string; path?: string } }> };
  try {
    doc = parseToml(text) as typeof doc;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const p of doc.package ?? []) {
    if (!p.name || !p.version) continue;
    const isPrivate = !!p.source && (p.source.type === 'git' || p.source.type === 'directory' || p.source.type === 'file' || !!p.source.git || !!p.source.path) || p.source?.type === 'virtual';
    out.push(dep('PyPI', norm(p.name), p.version, directNames.has(norm(p.name)), path, lineOf(text, `name = "${p.name}"`), isPrivate ? { private: true } : {}));
  }
  return out;
}

export function parsePipfileLock(path: string, text: string): Dependency[] {
  let doc: Record<string, Record<string, { version?: string; git?: string; path?: string }>>;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  for (const section of ['default', 'develop']) {
    for (const [name, info] of Object.entries(doc[section] ?? {})) {
      const version = info.version?.replace(/^==/, '');
      if (version) out.push(dep('PyPI', norm(name), version, false, path, lineOf(text, `"${name}"`), info.git || info.path ? { private: true } : {}));
    }
  }
  return out;
}

/** pyproject.toml declared dependencies (PEP 621 and poetry), used for the direct flag and when there is no lock. */
export function parsePyproject(path: string, text: string): Dependency[] {
  let doc: { project?: { dependencies?: string[]; 'optional-dependencies'?: Record<string, string[]> }; tool?: { poetry?: { dependencies?: Record<string, unknown>; group?: Record<string, { dependencies?: Record<string, unknown> }> } } };
  try {
    doc = parseToml(text) as typeof doc;
  } catch {
    return [];
  }
  const out: Dependency[] = [];
  const fromSpecs = (specs: string[] | undefined) => {
    for (const spec of specs ?? []) out.push(...parseRequirements(path, spec).map((d) => ({ ...d, line: lineOf(text, spec.split(/[\s=<>~!;[]/)[0]!) })));
  };
  fromSpecs(doc.project?.dependencies);
  for (const list of Object.values(doc.project?.['optional-dependencies'] ?? {})) fromSpecs(list);
  const poetry = doc.tool?.poetry;
  const addPoetry = (table: Record<string, unknown> | undefined) => {
    for (const [name, v] of Object.entries(table ?? {})) {
      if (name.toLowerCase() === 'python') continue;
      const spec = typeof v === 'string' ? v : typeof (v as { version?: string })?.version === 'string' ? (v as { version: string }).version : '';
      const isPrivate = typeof v === 'object' && v !== null && ('git' in v || 'path' in v || 'url' in v);
      out.push(dep('PyPI', norm(name), spec.replace(/^[\^~>=<]+/, ''), true, path, lineOf(text, name), { unpinned: true, ...(isPrivate ? { private: true } : {}) }));
    }
  };
  addPoetry(poetry?.dependencies);
  for (const g of Object.values(poetry?.group ?? {})) addPoetry(g.dependencies);
  return out;
}
