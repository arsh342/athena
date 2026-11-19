import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { LANGUAGE_FAMILY, type LanguageId } from '../lang/languages.js';
import type { Skill } from './types.js';

export interface ProjectProfile {
  languages: Set<string>;
  families: Set<string>;
  dependencies: Set<string>;
  imports: Set<string>;
  paths: string[];
}

const MANIFEST = /^(?:package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|Cargo\.toml|composer\.json|Gemfile|[\w.-]+\.(?:cs|fs|vb)proj|packages\.config)$/;
const IMPORT_PATTERNS: Array<[RegExp, number[]]> = [
  [/\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm, [1, 2, 3]],
  [/^\s*(?:from|import)\s+([\w.]+)/gm, [1]],
  [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm, [1]],
  [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm, [1]],
  [/^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+\.[\w./-]+|[\w/-]+)"\s*$/gm, [1]],
  [/^\s*(?:pub\s+)?use\s+([\w:]+)|^\s*extern\s+crate\s+(\w+)/gm, [1, 2]],
  [/^\s*use\s+([\\\w]+)/gm, [1]],
  [/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm, [1]],
];

/** Skill fixtures are deliberately vulnerable examples: never part of the project's profile or findings. */
export function isSkillFixturePath(relPath: string): boolean {
  return /(?:^|\/)(?:\.athena|core)\/skills\/[^/]+\/fixtures\//.test(relPath.split('\\').join('/'));
}

const quoted = (text: string): string[] => [...text.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1]!);
const pkgName = (spec: string): string | null => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1]?.toLowerCase() ?? null;

/** Dependency names declared by one manifest, parsed structurally (never prose, comments or descriptions). */
export function extractDependencies(fileName: string, text: string): string[] {
  const out = new Set<string>();
  const add = (n: string | null) => {
    if (n) out.add(n.toLowerCase());
  };
  const name = fileName.toLowerCase();
  if (/^requirements[\w.-]*\.txt$/.test(name)) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#') || line.startsWith('-') || /^[a-z+]+:\/\//i.test(line)) continue;
      add(pkgName(line));
    }
  } else if (name === 'pyproject.toml' || name === 'pipfile' || name === 'setup.cfg' || name === 'setup.py') {
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      const sec = /^\[([^\]]+)\]$/.exec(line);
      if (sec) {
        section = sec[1]!.toLowerCase();
        continue;
      }
      if (/^(?:tool\.poetry(?:\.group\.\w+)?\.dependencies|tool\.poetry\.dev-dependencies|packages|dev-packages)$/.test(section)) {
        const key = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line)?.[1];
        if (key && key.toLowerCase() !== 'python') add(key);
      }
    }
    for (const m of text.matchAll(/(?:^|\n)\s*(?:dependencies|install_requires|requires|optional-dependencies[\w.-]*)\s*=\s*\[([\s\S]*?)\]/g)) for (const q of quoted(m[1]!)) add(pkgName(q));
    for (const m of text.matchAll(/install_requires\s*=\s*\n((?:[ \t]+[^\n]+\n?)+)/g)) for (const l of m[1]!.split('\n')) add(pkgName(l.replace(/#.*$/, '')));
  } else if (name === 'pom.xml') {
    for (const m of text.matchAll(/<(?:artifactId|groupId)>\s*([^<\s]+)\s*<\/(?:artifactId|groupId)>/g)) add(m[1]!);
  } else if (/^build\.gradle(?:\.kts)?$/.test(name)) {
    for (const m of text.matchAll(/["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/g)) {
      add(m[1]!);
      add(m[2]!);
    }
  } else if (name === 'go.mod') {
    for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./~-]+)\s+v[\w.+-]+/gm)) add(m[1]!);
  } else if (name === 'cargo.toml') {
    let inDeps = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      const sec = /^\[([^\]]+)\]$/.exec(line);
      if (sec) inDeps = /(?:^|\.)(?:dev-|build-)?dependencies(?:\.|$)/.test(sec[1]!);
      else if (inDeps) add(/^([A-Za-z0-9][A-Za-z0-9_-]*)\s*=/.exec(line)?.[1] ?? null);
      const dotted = /^\[(?:dev-|build-)?dependencies\.([\w-]+)\]$/.exec(line);
      if (dotted) add(dotted[1]!);
    }
  } else if (name === 'gemfile') {
    for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) add(m[1]!);
  } else if (/\.(?:cs|fs|vb)proj$/.test(name)) {
    for (const m of text.matchAll(/<PackageReference\s+Include=["']([^"']+)["']/gi)) add(m[1]!);
  } else if (name === 'packages.config') {
    for (const m of text.matchAll(/<package\s+id=["']([^"']+)["']/gi)) add(m[1]!);
  }
  return [...out];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildProfile(root: string, files: Array<{ path: string; source: string; lang: LanguageId }>, extraPaths: string[] = []): ProjectProfile {
  const profile: ProjectProfile = { languages: new Set(), families: new Set(), dependencies: new Set(), imports: new Set(), paths: [] };
  const seenDirs = new Set<string>();
  for (const f of files) {
    profile.languages.add(f.lang);
    profile.families.add(LANGUAGE_FAMILY[f.lang]);
    profile.paths.push(relative(root, f.path).split('\\').join('/'));
    for (const [pattern, groups] of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const m of f.source.slice(0, 200_000).matchAll(pattern)) for (const g of groups) if (m[g]) profile.imports.add(m[g]!);
    }
    // Manifests in the file's directory and every ancestor up to the root.
    for (let dir = dirname(f.path); dir.startsWith(root) && !seenDirs.has(dir); dir = dirname(dir)) {
      seenDirs.add(dir);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names.filter((n) => MANIFEST.test(n))) {
        try {
          const path = join(dir, name);
          if (statSync(path).size > 512 * 1024) continue;
          const text = readFileSync(path, 'utf8');
          if (name === 'package.json' || name === 'composer.json') {
            try {
              const json = JSON.parse(text) as Record<string, Record<string, unknown>>;
              for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'require', 'require-dev']) for (const dep of Object.keys(json[key] ?? {})) profile.dependencies.add(dep.toLowerCase());
            } catch {
              // an unparsable manifest contributes nothing
            }
          } else for (const dep of extractDependencies(name, text)) profile.dependencies.add(dep);
        } catch {
          // unreadable manifests are ignored
        }
      }
    }
  }
  for (const p of extraPaths) profile.paths.push(relative(root, p).split('\\').join('/'));
  return profile;
}

function hasDependency(profile: ProjectProfile, name: string): boolean {
  const n = name.toLowerCase();
  for (const dep of profile.dependencies) {
    if (dep === n || dep.startsWith(`${n}-`) || dep.startsWith(`${n}.`) || dep.startsWith(`${n}/`)) return true;
  }
  return false;
}

function languageMatches(skill: Skill, profile: ProjectProfile): boolean {
  const wanted = skill.meta.appliesTo.languages;
  if (!wanted || wanted.length === 0) return true;
  return wanted.some((w) => profile.languages.has(w) || profile.families.has(w));
}

/** Why a skill is active for this project, or null when it is not. Detection uses manifests and imports, never free text. */
export function activationReason(skill: Skill, profile: ProjectProfile): string | null {
  if (!languageMatches(skill, profile)) return null;
  const detect = skill.meta.appliesTo.detect ?? {};
  const hasDetect = (detect.dependencies?.length ?? 0) + (detect.imports?.length ?? 0) + (detect.files?.length ?? 0) > 0;
  if (detect.always || !hasDetect) return 'always applies to this language';
  for (const dep of detect.dependencies ?? []) if (hasDependency(profile, dep)) return `dependency ${dep}`;
  for (const imp of detect.imports ?? []) {
    for (const found of profile.imports) if (found === imp || found.startsWith(`${imp}/`) || found.startsWith(`${imp}.`) || found.startsWith(`${imp}::`) || found.startsWith(`${imp}\\`)) return `imports ${imp}`;
  }
  for (const file of detect.files ?? []) {
    const r = new RegExp(file, 'i');
    if (profile.paths.some((p) => r.test(p))) return `file matching ${file}`;
  }
  return null;
}
