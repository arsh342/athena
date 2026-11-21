import assert from 'node:assert/strict';
import test from 'node:test';
import { scanTextForSecrets } from '../src/secrets/scan.ts';

// Assembled at runtime so no token-shaped literal sits in the repository.
const awsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const fixture = 'const req = mockReq({ fullName: "Test User", email: "a@b.com", password: "Tr0ub4dor&3xK9" });\n';

test('a made-up password in test code is not reported, but the same line in application code is', () => {
  assert.equal(scanTextForSecrets('server/auth.test.js', fixture, { testFile: true }).length, 0);
  const app = scanTextForSecrets('server/auth.js', fixture);
  assert.ok(app.some((f) => /hardcoded-password/.test(f.ruleId)), 'still reported outside tests');
});

test('every generic name-based rule is skipped in test code', () => {
  const lines = ['const apiKey = "Zq81xKd02LmPw93Vb7Nc";', 'const token = "Zq81xKd02LmPw93Vb7Nc";', 'const secret = "Zq81xKd02LmPw93Vb7Nc";', 'const password = "Zq81xKd02LmPw93Vb7Nc";'].join('\n');
  assert.ok(scanTextForSecrets('src/a.js', lines).length >= 1, 'reported in application code');
  assert.equal(scanTextForSecrets('tests/a.js', lines, { testFile: true }).length, 0);
});

test('a real provider key format in a test file is still reported, and never echoed', () => {
  const found = scanTextForSecrets('tests/aws.test.js', `const k = "${awsKey}";\n`, { testFile: true });
  assert.ok(found.length >= 1, 'a recognisable AWS key is reported even in a test');
  assert.ok(!JSON.stringify(found).includes(awsKey), 'the key itself is never in the finding');
});

test('through a full scan: reported in app code, silent in test files', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { scanFiles } = await import('../src/engine.ts');
  const root = mkdtempSync(join(tmpdir(), 'athena-testsecrets-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'tests'));
  const files = { 'src/auth.js': fixture, 'src/auth.test.js': fixture, 'tests/login.js': fixture };
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  const report = await scanFiles(Object.keys(files).map((f) => join(root, f)), { eslint: { enabled: false, timeoutMs: 1000 }, dependencies: { enabled: false } } as never, {}, { root });
  const hits = report.files.flatMap((f) => f.findings.filter((x) => /hardcoded/.test(String(x.ruleId))).map(() => f.path.slice(root.length + 1)));
  assert.deepEqual(hits.sort(), ['src/auth.js'], 'only the application file is reported');
});
