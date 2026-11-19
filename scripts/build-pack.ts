/**
 * Maintainer: build and sign a rule/skill pack.
 *   ATHENA_PACK_PRIVATE_KEY="$(cat key.pem)" node --import tsx scripts/build-pack.ts --version 2026.11.21 --out dist-packs [--changelog changelog.json] [skill-dir ...]
 * Skill directories default to every directory in core/skills. Output: athena-pack-<version>.tar.gz, .sig, .sha256.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { makeTarGz } from '../core/src/updates/tar.ts';
import { sha256, signDetached } from '../core/src/updates/signature.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = opt('version');
const out = opt('out') ?? 'dist-packs';
const key = process.env.ATHENA_PACK_PRIVATE_KEY;
if (!version || !/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(version)) throw new Error('--version yyyy.mm.dd is required');
if (!key) throw new Error('set ATHENA_PACK_PRIVATE_KEY (PEM); the key must never be committed');
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const skillsRoot = join(import.meta.dirname, '..', 'core', 'skills');
const dirs = positional.length > 0 ? positional : readdirSync(skillsRoot).map((n) => join(skillsRoot, n)).filter((p) => statSync(p).isDirectory());

const files: Record<string, string> = {};
const walk = (root: string, dir: string) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === '.git' || e === '.skill-source.json') continue;
    if (statSync(p).isDirectory()) walk(root, p);
    else files[`skills/${basename(root)}/${relative(root, p).split('\\').join('/')}`] = readFileSync(p, 'utf8');
  }
};
for (const d of dirs) walk(d, d);
const changelogPath = opt('changelog');
const changelog = changelogPath ? JSON.parse(readFileSync(changelogPath, 'utf8')) : [];
files['manifest.json'] = JSON.stringify({ version, created: new Date().toISOString(), changelog, skills: dirs.map((d) => basename(d)) }, null, 2);
const tar = makeTarGz(files);
mkdirSync(out, { recursive: true });
const name = `athena-pack-${version}.tar.gz`;
writeFileSync(join(out, name), tar);
writeFileSync(join(out, `${name}.sig`), signDetached(tar, key));
writeFileSync(join(out, `${name}.sha256`), `${sha256(tar)}  ${name}\n`);
console.log(`${name}: ${dirs.length} skills, ${tar.length} bytes, sha256 ${sha256(tar)}`);
