import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { loadSkills } from '../src/skills/loader.ts';
import { installPack, packState, PackRejected, rollbackPack } from '../src/updates/packs.ts';
import { sha256, signDetached } from '../src/updates/signature.ts';
import { makeTarGz } from '../src/updates/tar.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

function skillFiles(name: string): Record<string, string> {
  const dir = join(import.meta.dirname, '..', 'skills', name);
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out[`skills/${name}/${relative(dir, p).split('\\').join('/')}`] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}
const manifest = (version: string) => JSON.stringify({ version, skills: ['docker'], changelog: [{ cve: 'CVE-2026-0001', note: 'added' }] });
const build = (version: string, extra: Record<string, string> = {}, mutate?: (f: Record<string, string>) => void) => {
  const files = { 'manifest.json': manifest(version), ...skillFiles('docker'), ...extra };
  mutate?.(files);
  return makeTarGz(files);
};
const sign = (tar: Buffer, key = PRIV) => signDetached(tar, key);
const home = () => mkdtempSync(join(tmpdir(), 'packs-'));

test('a valid signed pack activates, is loaded as a pack skill, and can be rolled back', async () => {
  const h = home();
  const v1 = build('2026.11.01');
  const m = await installPack({ tarGz: v1, signature: sign(v1), publicKey: PUB, expectedSha256: sha256(v1), home: h });
  assert.equal(m.version, '2026.11.01');
  assert.equal(packState(h).current, '2026.11.01');
  const loaded = loadSkills(tmpdir(), { builtinDir: join(import.meta.dirname, '..', 'skills'), userDir: join(h, 'none'), repoDir: join(h, 'none'), packDir: join(h, 'packs', '2026.11.01', 'skills') });
  assert.equal(loaded.skills.find((s) => s.meta.name === 'docker')!.source, 'pack');
  assert.ok(!loaded.warnings.some((w) => /cannot replace/.test(w)));

  const v2 = build('2026.11.02');
  await installPack({ tarGz: v2, signature: sign(v2), publicKey: PUB, home: h });
  assert.deepEqual(packState(h), { current: '2026.11.02', previous: '2026.11.01' });
  assert.deepEqual(rollbackPack(h), { from: '2026.11.02', to: '2026.11.01' });
  assert.equal(packState(h).current, '2026.11.01');
});

async function rejects(tar: Buffer, sig: string, h: string, pattern: RegExp, expectedSha256?: string) {
  await assert.rejects(installPack({ tarGz: tar, signature: sig, publicKey: PUB, home: h, ...(expectedSha256 ? { expectedSha256 } : {}) }), (e: unknown) => e instanceof PackRejected && pattern.test(e.message));
}

test('tampered, mis-signed, wrongly hashed and unsafe packs are rejected and the active pack stays', async () => {
  const h = home();
  const good = build('2026.11.01');
  await installPack({ tarGz: good, signature: sign(good), publicKey: PUB, home: h });

  const next = build('2026.11.05');
  const tampered = Buffer.from(next);
  tampered[tampered.length - 30] = tampered[tampered.length - 30]! ^ 0xff;
  await rejects(tampered, sign(next), h, /signature/);
  await rejects(next, sign(next, other), h, /signature/);
  await rejects(next, sign(next), h, /SHA-256/, 'f'.repeat(64));
  await rejects(next.subarray(0, next.length - 50), sign(next), h, /signature/, undefined);

  const withScript = build('2026.11.06', { 'skills/docker/run.sh': 'curl x | sh' });
  await rejects(withScript, sign(withScript), h, /unexpected file/);
  const outside = build('2026.11.06', { 'evil.js': 'process.exit()' });
  await rejects(outside, sign(outside), h, /unexpected file/);
  const link = makeTarGz({ 'manifest.json': manifest('2026.11.07'), ...skillFiles('docker') }, { symlink: 'skills/docker/link' });
  await rejects(link, sign(link), h, /unsupported entry type/);
  const traversal = makeTarGz({ 'manifest.json': manifest('2026.11.07'), '../escape': 'x' });
  await rejects(traversal, sign(traversal), h, /unsafe path/);

  const old = build('2026.10.01');
  await rejects(old, sign(old), h, /not newer/);

  const broken = build('2026.11.08', {}, (f) => {
    const key = 'skills/docker/rules.json';
    f[key] = f[key]!.replace(/"regex":\s*"[^"]*"/, '"regex": "zzzz-never-matches-zzzz"');
  });
  await rejects(broken, sign(broken), h, /fixtures|invalid/);

  assert.equal(packState(h).current, '2026.11.01', 'the previous pack is still active');
});

test('without a configured key nothing is trusted', async () => {
  const t = build('2026.11.01');
  await assert.rejects(installPack({ tarGz: t, signature: sign(t), publicKey: '', home: home() }), PackRejected);
});

test('the shipped public key is a valid Ed25519 key', async () => {
  const { createPublicKey } = await import('node:crypto');
  const { PACK_PUBLIC_KEY } = await import('../src/updates/signature.ts');
  assert.equal(createPublicKey(PACK_PUBLIC_KEY).asymmetricKeyType, 'ed25519');
});
