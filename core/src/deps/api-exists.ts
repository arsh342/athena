import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { NODE_BUILTINS, usesOf } from './usage.js';

export interface MissingApi {
  file: string;
  line: number;
  pkg: string;
  member: string;
  version: string;
  code: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function typesEntry(pkgDir: string, manifest: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  for (const key of ['types', 'typings']) if (typeof manifest[key] === 'string') candidates.push(manifest[key] as string);
  const exp = manifest.exports as Record<string, unknown> | undefined;
  const dot = exp && typeof exp === 'object' ? (exp['.'] as unknown) : undefined;
  const pick = (v: unknown): void => {
    if (typeof v === 'string' && /\.d\.[cm]?ts$/.test(v)) candidates.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v as object)) pick(x);
  };
  pick(dot);
  if (typeof manifest.main === 'string') candidates.push((manifest.main as string).replace(/\.[cm]?js$/, '.d.ts'));
  candidates.push('index.d.ts');
  for (const c of candidates) {
    const p = resolve(pkgDir, c);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const IDENT = /[A-Za-z_$][\w$]*/g;

/** Every identifier declared in a package's type declarations (following relative imports/exports, bounded). */
function declaredIdentifiers(entry: string): { names: Set<string>; open: boolean } {
  const names = new Set<string>();
  let open = false;
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0 && seen.size < 60) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      open = true;
      continue;
    }
    for (const m of text.matchAll(IDENT)) names.add(m[0]);
    if (/\[\s*(?:key|k|name|prop)\s*:\s*string\s*\]\s*:\s*any/.test(text) || /export\s+default\s+any\b/.test(text)) open = true;
    for (const m of text.matchAll(/(?:from|import|reference\s+path=)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)) {
      const base = resolve(dirname(file), m[1]!);
      const next = [`${base}.d.ts`, join(base, 'index.d.ts'), base.replace(/\.js$/, '.d.ts'), `${base}.d.mts`, `${base}.d.cts`].find((p) => existsSync(p) && statSync(p).isFile());
      if (next) queue.push(next);
      else open = true;
    }
    for (const m of text.matchAll(/export\s+\*\s+from\s+['"]([^./][^'"]*)['"]/g)) { void m; open = true; }
  }
  if (queue.length > 0) open = true;
  return { names, open };
}

interface PackageTypes {
  names: Set<string>;
  version: string;
}
const typesCache = new Map<string, PackageTypes | null>();

/** Declared identifiers of the installed package (or its `@types/` companion); null when it is not installed or untyped. */
export function packageTypes(root: string, pkg: string): PackageTypes | null {
  const key = `${root}\0${pkg}`;
  if (typesCache.has(key)) return typesCache.get(key)!;
  let result: PackageTypes | null = null;
  const dir = join(root, 'node_modules', pkg);
  const manifest = readJson(join(dir, 'package.json'));
  const version = typeof manifest?.version === 'string' ? manifest.version : '';
  let entry = manifest ? typesEntry(dir, manifest) : null;
  if (!entry) {
    const typesDir = join(root, 'node_modules', '@types', pkg.replace(/^@([^/]+)\//, '$1__'));
    const tm = readJson(join(typesDir, 'package.json'));
    if (tm) entry = typesEntry(typesDir, tm);
  }
  if (entry) {
    const { names, open } = declaredIdentifiers(entry);
    result = open ? null : { names, version };
  }
  typesCache.set(key, result);
  return result;
}

/** Built-in modules are typed by @types/node: `fs.readFilePromise` is checked against `node_modules/@types/node/fs.d.ts`. */
function builtinTypes(root: string, mod: string): PackageTypes | null {
  const file = join(root, 'node_modules', '@types', 'node', `${mod}.d.ts`);
  if (!existsSync(file)) return null;
  const key = `${root}\0node:${mod}`;
  if (!typesCache.has(key)) {
    const { names, open } = declaredIdentifiers(file);
    typesCache.set(key, open ? null : { names, version: 'node' });
  }
  return typesCache.get(key)!;
}

/** Members used from a package (`import { x }`, `pkg.member(`) that the installed package's type declarations do not contain. */
export function missingApis(root: string, file: string, source: string): MissingApi[] {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  const out: MissingApi[] = [];
  const lines = source.split('\n');
  for (const use of usesOf(file, source)) {
    const types = packageTypes(root, use.pkg);
    if (!types) continue;
    for (const name of use.named) {
      if (!types.names.has(name)) out.push({ file, line: use.line, pkg: use.pkg, member: name, version: types.version, code: lines[use.line - 1]?.trim().slice(0, 160) ?? name });
    }
    for (const binding of use.bindings) {
      const re = new RegExp(`(?<![\\w$.])${binding.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
      for (const m of source.matchAll(re)) {
        if (types.names.has(m[1]!)) continue;
        const line = source.slice(0, m.index).split('\n').length;
        out.push({ file, line, pkg: use.pkg, member: m[1]!, version: types.version, code: lines[line - 1]?.trim().slice(0, 160) ?? m[0] });
      }
    }
  }
  // Built-in modules: `fs.readFilePromise(...)`.
  for (const m of source.matchAll(/(?:import\s+(?:\*\s+as\s+)?(\w+)\s+from|(?:const|let|var)\s+(\w+)\s*=\s*require\()\s*['"](?:node:)?(\w+)['"]/g)) {
    const mod = m[3]!;
    if (!NODE_BUILTINS.has(mod)) continue;
    const binding = m[1] ?? m[2]!;
    const types = builtinTypes(root, mod);
    if (!types) continue;
    for (const call of source.matchAll(new RegExp(`(?<![\\w$.])${binding}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))) {
      if (types.names.has(call[1]!)) continue;
      const line = source.slice(0, call.index).split('\n').length;
      out.push({ file, line, pkg: mod, member: call[1]!, version: 'node', code: lines[line - 1]?.trim().slice(0, 160) ?? call[0] });
    }
  }
  return out;
}

/** Packages declared by any package.json under root (including workspace member names), for undeclared-import checks. */
export function declaredJsPackages(root: string, manifestPaths: string[]): Set<string> {
  const names = new Set<string>();
  for (const p of manifestPaths.filter((x) => x.endsWith('package.json'))) {
    const j = readJson(p);
    if (!j) continue;
    if (typeof j.name === 'string') names.add(j.name);
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const sec = j[k];
      if (sec && typeof sec === 'object') for (const n of Object.keys(sec)) names.add(n);
    }
  }
  void root;
  void readdirSync;
  return names;
}
