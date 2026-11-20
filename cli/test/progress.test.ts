import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgress, shouldShowProgress } from '../src/utils/scan-progress.ts';

function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  return { isTTY, columns: 80, write: (s: string) => { writes.push(s); return true; }, writes } as unknown as NodeJS.WriteStream & { writes: string[] };
}

test('progress is silent when disabled', () => {
  const stream = fakeStream(false);
  const p = createProgress({ enabled: false, stream });
  p.onProgress({ phase: 'files', filePath: 'a', index: 1, total: 2, status: 'scanning', findings: 0 });
  p.stop();
  assert.deepEqual(stream.writes, []);
});

test('shouldShowProgress needs a TTY, no CI and no --quiet', () => {
  assert.equal(shouldShowProgress(false, fakeStream(true), {}), true);
  assert.equal(shouldShowProgress(true, fakeStream(true), {}), false);
  assert.equal(shouldShowProgress(false, fakeStream(false), {}), false);
  assert.equal(shouldShowProgress(false, fakeStream(true), { CI: 'true' }), false);
});

test('enabled progress draws one line and stop clears it', () => {
  const stream = fakeStream(true);
  const p = createProgress({ enabled: true, stream });
  p.onProgress({ phase: 'files', filePath: 'a.ts', index: 1, total: 2, status: 'scanned', findings: 3 });
  p.stop();
  const all = stream.writes.join('');
  assert.match(all, /1\/2 files · 3 findings/);
  assert.ok(stream.writes[stream.writes.length - 1].includes('\r\x1b[2K'));
});

test('the spinner uses Claude Code glyphs, shows elapsed time, and the status spinner stops cleanly', async () => {
  const { createStatus } = await import('../src/utils/scan-progress.ts');
  let clock = 0;
  const stream = fakeStream(true);
  const p = createProgress({ enabled: true, stream, label: 'Scanning', now: () => clock });
  clock = 3200;
  p.onProgress({ phase: 'files', filePath: 'a.ts', index: 1, total: 2, status: 'scanned', findings: 3 });
  p.stop();
  const all = stream.writes.join('');
  assert.match(all, /Scanning… .*\(3s · .*1\/2 files · 3 findings\)/);
  assert.match(all, /[·✢✳✶✻✽]/);

  const s2 = fakeStream(true);
  const st = createStatus({ enabled: true, stream: s2, label: 'Verifying with AI', now: () => 4000 });
  st.stop();
  assert.match(s2.writes.join(''), /Verifying with AI… .*\(0s\)/);
  assert.ok(s2.writes.at(-1)!.includes('\r\x1b[2K'));
  const off = fakeStream(false);
  createStatus({ enabled: false, stream: off, label: 'x' }).stop();
  assert.deepEqual(off.writes, []);
});
