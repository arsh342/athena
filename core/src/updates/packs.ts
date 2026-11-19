import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { testSkill } from '../skills/selftest.js';
import { validateSkill } from '../skills/validate.js';
import { athenaHome } from '../util/athena-home.js';
import { readTarGz, TarError } from './tar.js';
import { sha256, verifyDetached } from './signature.js';

export interface PackManifest {
  version: string;
  created?: string;
  /** What this pack added detection for, one line each (CVE id and note). */
  changelog?: Array<{ cve?: string; note: string }>;
  skills: string[];
}

export interface PackState { current: string | null; previous: string | null }

export class PackRejected extends Error {}

const VERSION = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;
const SKILL_FILE = /^skills\/([a-z0-9][a-z0-9-]{0,62})\/(SKILL\.md|rules\.json|taint\.json|LICENSE|README\.md|fixtures\/[^/]+(?:\/[^/]+)*)$/;

const packsDir = (home = athenaHome()): string => join(home, 'packs');
const statePath = (home?: string): string => join(packsDir(home), 'state.json');

export function packState(home?: string): PackState {
  try {
    return JSON.parse(readFileSync(statePath(home), 'utf8')) as PackState;
  } catch {
    return { current: null, previous: null };
  }
}

function writeState(state: PackState, home?: string): void {
  mkdirSync(packsDir(home), { recursive: true });
  const tmp = `${statePath(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, statePath(home));
}

/** Directory holding the active pack's skills, or null. */
export function activePackSkillsDir(home?: string): string | null {
  const { current } = packState(home);
  if (!current) return null;
  const dir = join(packsDir(home), current, 'skills');
  return existsSync(dir) ? dir : null;
}

export interface InstallInput {
  tarGz: Buffer;
  /** Base64 detached Ed25519 signature over the .tar.gz bytes. */
  signature: string;
  publicKey: string;
  /** Hex SHA-256 published next to the pack, when available. */
  expectedSha256?: string;
  home?: string;
}

/**
 * Verify, unpack, self-test and activate a pack. Any failure throws `PackRejected` and leaves the active pack untouched.
 * Packs hold data only (skills in the phase 7b format); every skill is validated and every rule's fixtures must pass.
 */
export async function installPack(input: InstallInput): Promise<PackManifest> {
  if (!verifyDetached(input.tarGz, input.signature, input.publicKey)) throw new PackRejected('signature does not verify (or no trusted key is configured)');
  if (input.expectedSha256 && sha256(input.tarGz) !== input.expectedSha256.trim().toLowerCase()) throw new PackRejected('SHA-256 does not match the published hash');
  let entries;
  try {
    entries = readTarGz(input.tarGz);
  } catch (error) {
    throw new PackRejected(error instanceof TarError ? error.message : `unreadable pack: ${String(error)}`);
  }
  const manifestEntry = entries.find((e) => e.path === 'manifest.json');
  if (!manifestEntry) throw new PackRejected('manifest.json missing');
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8')) as PackManifest;
  } catch {
    throw new PackRejected('manifest.json is not valid JSON');
  }
  if (!VERSION.test(manifest.version ?? '') || !Array.isArray(manifest.skills)) throw new PackRejected('manifest needs a yyyy.mm.dd version and a skills list');
  for (const e of entries) if (e.path !== 'manifest.json' && e.path !== 'CHANGELOG.md' && !SKILL_FILE.test(e.path)) throw new PackRejected(`unexpected file in pack: ${e.path} (packs contain skill data only)`);

  const state = packState(input.home);
  if (state.current && manifest.version <= state.current) throw new PackRejected(`pack ${manifest.version} is not newer than the active pack ${state.current}`);

  mkdirSync(packsDir(input.home), { recursive: true });
  const staging = mkdtempSync(join(packsDir(input.home), 'staging-'));
  try {
    for (const e of entries) {
      const target = join(staging, e.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, e.data);
    }
    const skillsRoot = join(staging, 'skills');
    const names = [...new Set(entries.map((e) => SKILL_FILE.exec(e.path)?.[1]).filter((x): x is string => !!x))];
    if (names.length === 0) throw new PackRejected('pack contains no skills');
    for (const name of names) {
      const { skill, issues } = validateSkill(join(skillsRoot, name), 'pack');
      if (!skill) throw new PackRejected(`skill ${name} is invalid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
      if (skill.meta.name !== name) throw new PackRejected(`skill folder ${name} does not match its name ${skill.meta.name}`);
      const result = await testSkill(skill);
      if (!result.ok) throw new PackRejected(`skill ${name} fails its own fixtures: ${result.failures.slice(0, 3).join('; ')}`);
    }
    const finalDir = join(packsDir(input.home), manifest.version);
    rmSync(finalDir, { recursive: true, force: true });
    renameSync(staging, finalDir);
    writeState({ current: manifest.version, previous: state.current }, input.home);
    return manifest;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (error instanceof PackRejected) throw error;
    throw new PackRejected(error instanceof Error ? error.message : String(error));
  }
}

/** Switch back to the previously active pack. Returns the version now active (null = built-in skills only). */
export function rollbackPack(home?: string): { from: string | null; to: string | null } | null {
  const state = packState(home);
  if (!state.current) return null;
  const target = state.previous && existsSync(join(packsDir(home), state.previous)) ? state.previous : null;
  writeState({ current: target, previous: null }, home);
  return { from: state.current, to: target };
}

export interface RemotePack { version: string; tarGz: Buffer; signature: string; sha256?: string }

/** Newest `athena-pack-<version>.tar.gz` release asset (with its `.sig` and optional `.sha256`) of a GitHub repository. */
export async function fetchLatestPack(options: { repo: string; apiBase?: string; currentVersion?: string | null }): Promise<RemotePack | null> {
  const base = options.apiBase ?? 'https://api.github.com';
  const headers = { 'user-agent': 'athena-cli', accept: 'application/vnd.github+json' };
  const res = await fetch(`${base}/repos/${options.repo}/releases?per_page=20`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`pack releases: HTTP ${res.status}`);
  const releases = (await res.json()) as Array<{ assets?: Array<{ name: string; browser_download_url: string }> }>;
  let best: { version: string; urls: Record<string, string> } | null = null;
  for (const r of releases) {
    const tar = r.assets?.find((a) => /^athena-pack-\d{4}\.\d{2}\.\d{2}(?:\.\d+)?\.tar\.gz$/.test(a.name));
    if (!tar) continue;
    const version = /athena-pack-(.+)\.tar\.gz$/.exec(tar.name)![1]!;
    if (best && version <= best.version) continue;
    best = { version, urls: Object.fromEntries((r.assets ?? []).map((a) => [a.name, a.browser_download_url])) };
    best.urls.tar = tar.browser_download_url;
  }
  if (!best || (options.currentVersion && best.version <= options.currentVersion)) return null;
  const get = async (url: string): Promise<Response> => {
    const r = await fetch(url, { headers: { 'user-agent': 'athena-cli' }, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r;
  };
  const sigUrl = best.urls[`athena-pack-${best.version}.tar.gz.sig`];
  if (!sigUrl) throw new Error(`pack ${best.version} has no .sig asset`);
  const shaUrl = best.urls[`athena-pack-${best.version}.tar.gz.sha256`];
  return {
    version: best.version,
    tarGz: Buffer.from(await (await get(best.urls.tar!)).arrayBuffer()),
    signature: (await (await get(sigUrl)).text()).trim(),
    ...(shaUrl ? { sha256: (await (await get(shaUrl)).text()).trim().split(/\s+/)[0]! } : {}),
  };
}

