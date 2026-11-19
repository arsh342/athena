import { basename, dirname, join } from 'node:path';

import type { Dependency } from '../types.js';
import { MANIFEST_FILE } from '../types.js';
import { directNamesOf, parseNpmLock, parsePackageJson, parsePnpmLock, parseYarnLock } from './js.js';
import { parseCargoLock, parseCargoToml, parseComposerLock, parseConanLock, parseCsproj, parseGoMod, parseGradleLock, parseNugetLock, parsePom, parseVcpkg } from './other.js';
import { parsePipfileLock, parsePoetryOrUvLock, parsePyproject, parseRequirements } from './python.js';

export { MANIFEST_FILE };

/**
 * Parse every manifest/lockfile among `paths` (read through `read`). A lockfile supersedes the declared ranges of the
 * manifest next to it: resolved versions are used, and the manifest only supplies the `direct` flag.
 */
export async function parseManifests(paths: string[], read: (path: string) => Promise<string | null>): Promise<Dependency[]> {
  const out: Dependency[] = [];
  const texts = new Map<string, string>();
  const get = async (p: string): Promise<string | null> => {
    if (!texts.has(p)) {
      const t = await read(p);
      if (t === null) return null;
      texts.set(p, t);
    }
    return texts.get(p)!;
  };
  const files = paths.filter((p) => MANIFEST_FILE.test(p));
  const has = (p: string) => files.includes(p);
  for (const path of files) {
    const name = basename(path);
    const dir = dirname(path);
    const text = await get(path);
    if (text === null) continue;
    const pkgPath = join(dir, 'package.json');
    const directJs = has(pkgPath) ? directNamesOf((await get(pkgPath)) ?? '') : new Set<string>();
    const pyprojectPath = join(dir, 'pyproject.toml');
    const directPy = has(pyprojectPath) ? new Set(parsePyproject(pyprojectPath, (await get(pyprojectPath)) ?? '').map((d) => d.name)) : new Set<string>();
    const cargoPath = join(dir, 'Cargo.toml');
    const directRust = has(cargoPath) ? new Set(parseCargoToml(cargoPath, (await get(cargoPath)) ?? '').map((d) => d.name)) : new Set<string>();
    const composerPath = join(dir, 'composer.json');
    const directPhp = new Set<string>();
    if (has(composerPath)) {
      try {
        const j = JSON.parse((await get(composerPath)) ?? '{}') as { require?: object; 'require-dev'?: object };
        for (const k of Object.keys({ ...j.require, ...j['require-dev'] })) directPhp.add(k);
      } catch {
        // composer.json unreadable: everything is treated as transitive
      }
    }
    if (name === 'package.json') {
      if (!files.some((f) => dirname(f) === dir && /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(basename(f)))) out.push(...parsePackageJson(path, text));
    } else if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json') out.push(...parseNpmLock(path, text, directJs));
    else if (name === 'yarn.lock') out.push(...parseYarnLock(path, text, directJs));
    else if (name === 'pnpm-lock.yaml') out.push(...parsePnpmLock(path, text, directJs));
    else if (/^requirements[\w.-]*\.txt$/.test(name)) out.push(...parseRequirements(path, text));
    else if (name === 'poetry.lock' || name === 'uv.lock') out.push(...parsePoetryOrUvLock(path, text, directPy));
    else if (name === 'Pipfile.lock') out.push(...parsePipfileLock(path, text));
    else if (name === 'pyproject.toml') {
      if (!files.some((f) => dirname(f) === dir && /^(?:poetry|uv)\.lock$/.test(basename(f)))) out.push(...parsePyproject(path, text));
    } else if (name === 'pom.xml') out.push(...parsePom(path, text));
    else if (name === 'gradle.lockfile') out.push(...parseGradleLock(path, text));
    else if (name === 'packages.lock.json') out.push(...parseNugetLock(path, text));
    else if (/\.(?:cs|fs|vb)proj$/.test(name)) {
      if (!files.some((f) => dirname(f) === dir && basename(f) === 'packages.lock.json')) out.push(...parseCsproj(path, text));
    } else if (name === 'go.mod') out.push(...parseGoMod(path, text));
    else if (name === 'Cargo.lock') out.push(...parseCargoLock(path, text, directRust));
    else if (name === 'Cargo.toml') {
      if (!files.some((f) => dirname(f) === dir && basename(f) === 'Cargo.lock')) out.push(...parseCargoToml(path, text));
    } else if (name === 'composer.lock') out.push(...parseComposerLock(path, text, directPhp));
    else if (name === 'vcpkg.json') out.push(...parseVcpkg(path, text));
    else if (name === 'conan.lock') out.push(...parseConanLock(path, text));
  }
  return out;
}

/** The same package@version found in several manifests is queried once; each occurrence keeps its own location. */
export function uniqueQueries(deps: Dependency[]): Array<{ ecosystem: Dependency['ecosystem']; name: string; version: string }> {
  const seen = new Set<string>();
  const out: Array<{ ecosystem: Dependency['ecosystem']; name: string; version: string }> = [];
  for (const d of deps) {
    if (d.private || !d.version) continue;
    const key = `${d.ecosystem}\0${d.name}\0${d.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ecosystem: d.ecosystem, name: d.name, version: d.version });
    }
  }
  return out;
}
