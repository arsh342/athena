import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanBusyError, activeScanCount, withScanSlot } from '../src/scanner.ts';

test('only the allowed number of scans run at once; the rest are turned away with a clear message and the slot frees afterwards', async () => {
  process.env.MAX_CONCURRENT_SCANS = '2';
  try {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = withScanSlot(() => gate);
    const second = withScanSlot(() => gate);
    assert.equal(activeScanCount(), 2);
    await assert.rejects(() => withScanSlot(async () => 'never'), (e: unknown) => e instanceof ScanBusyError && /busy/i.test((e as Error).message));
    release();
    await Promise.all([first, second]);
    assert.equal(activeScanCount(), 0, 'both slots are free again');
    assert.equal(await withScanSlot(async () => 'ok'), 'ok');
  } finally {
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});

test('a scan that fails still frees its slot', async () => {
  process.env.MAX_CONCURRENT_SCANS = '1';
  try {
    await assert.rejects(() => withScanSlot(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(activeScanCount(), 0);
    assert.equal(await withScanSlot(async () => 1), 1);
  } finally {
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});

test('the default is one scan at a time', async () => {
  delete process.env.MAX_CONCURRENT_SCANS;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const first = withScanSlot(() => gate);
  await assert.rejects(() => withScanSlot(async () => 'never'), ScanBusyError);
  release();
  await first;
});

test('the web scanner has a 500 MB budget (about 227 files), a smaller container lowers it, and settings override it', async () => {
  const { maxScanFiles, estimateScanMb } = await import('../src/scanner.ts');
  assert.equal(maxScanFiles(null, {}), 227, 'default: a 500 MB budget');
  assert.equal(maxScanFiles(8192, {}), 227, 'a bigger server does not raise the web limit by itself');
  assert.equal(maxScanFiles(400, {}), 136, 'a smaller container lowers it');
  assert.equal(maxScanFiles(100, {}), 50, 'never below a useful minimum');
  assert.equal(maxScanFiles(null, { SCAN_MEMORY_MB: '1500' }), 1136, 'the budget can be raised on a bigger instance');
  assert.equal(maxScanFiles(512, { SCAN_MAX_FILES: '1000' }), 1000, 'an explicit file limit wins');
  assert.equal(estimateScanMb(519), 821);
});

test('a repository over the limit fails with a message that says what to do, and the server keeps running', async () => {
  process.env.SCAN_MAX_FILES = '1';
  process.env.MAX_CONCURRENT_SCANS = '8';
  try {
    const { runUploadScan } = await import('../src/scanner.ts');
    const file = (name: string) => ({ originalname: `big/${name}`, buffer: Buffer.from('export const a = 1;\n'), size: 20 });
    const result = await runUploadScan({ mode: 'folder', rootName: 'big', files: [file('x.ts'), file('y.ts')] });
    assert.equal(result.scan.status, 'FAILED');
    assert.ok(result.terminalLines.some((l) => /limited to 500 MB.*Download the CLI.*athena scan/.test(l)), 'the message points to the CLI');
  } finally {
    delete process.env.SCAN_MAX_FILES;
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});

test('coverage gaps: a missing tool is "not installed on this server", a failed lookup is not', async () => {
  const { describeCoverageGap } = await import('../src/scanner.ts');
  assert.equal(describeCoverageGap('semgrep unavailable'), 'semgrep not installed on this server');
  assert.match(describeCoverageGap('7 registry lookup(s) unavailable'), /^7 registry lookup\(s\) could not be completed .*did not answer/);
  assert.doesNotMatch(describeCoverageGap('7 registry lookup(s) unavailable'), /not installed/);
  assert.equal(describeCoverageGap('3 file(s) not parsed'), '3 file(s) not parsed');
});

test('web scans leave test directories out like the CLI does, list them as excluded, and report no secrets from them', async () => {
  process.env.MAX_CONCURRENT_SCANS = '8';
  try {
    const { runUploadScan } = await import('../src/scanner.ts');
    const body = 'const req = mockReq({ email: "a@b.com", password: "Tr0ub4dor&3xK9" });\n';
    const file = (name: string, text: string) => ({ originalname: `app/${name}`, buffer: Buffer.from(text), size: Buffer.byteLength(text) });
    const result = await runUploadScan({
      mode: 'folder',
      rootName: 'app',
      files: [file('src/index.ts', 'export const ok = 1;\n'), file('server/tests/auth.test.js', body), file('src/login.test.js', body)],
    });
    assert.equal(result.scan.status, 'COMPLETED');
    assert.equal(result.findings.filter((f) => /hardcoded/i.test(f.type) || /hardcoded/i.test(f.ruleId ?? '')).length, 0, 'no hardcoded-credential findings from test code');
    assert.ok(!result.scan.coverage?.gaps.some((g) => /not parsed|excluded/.test(g)), 'excluded test files are not coverage gaps');
  } finally {
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});
