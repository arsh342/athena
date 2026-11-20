import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';
import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { redactFrameLine } from '../src/report/redact.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';
import { scanTextForSecrets } from '../src/secrets/scan.ts';

const js = (path: string, source: string): ProjectFile => ({ path, source, lang: 'javascript' });
const py = (path: string, source: string): ProjectFile => ({ path, source, lang: 'python' });
const lang = (path: string, source: string, l: ProjectFile['lang']): ProjectFile => ({ path, source, lang: l });
async function run(files: ProjectFile[], root = '/p') {
  const r = await analyzeProject(files, { root });
  return { r, found: [...r.findings].flatMap(([path, list]) => list.map((f) => ({ path, ...f }))) };
}
const noExternal = { eslint: { enabled: false, timeoutMs: 1000 }, npmAudit: { enabled: false, timeoutMs: 1000 }, };

// ── C1: request-sourced findings are never demoted by reachability heuristics ───────────
test('C1: Django view, member-expression controller and wrapped handler stay high confidence', async () => {
  const django = await run([py('/p/views.py', "def index(request):\n    cursor.execute('select ' + request.GET['id'])\n"), py('/p/urls.py', "urlpatterns = [path('x/', views.index)]\n")]);
  assert.equal(django.found.find((f) => f.ruleId === 'taint.sql-injection')?.confidence, 'high');
  const ctrl = await run([js('/p/c.js', "exports.getUser = function (req, res) {\n  db.query('select ' + req.params.id, (err, rows) => res.send('x'));\n};\n"), js('/p/r.js', "router.get('/u/:id', requireAuth, ctrl.getUser);\n")]);
  assert.equal(ctrl.found.find((f) => f.ruleId === 'taint.sql-injection')?.confidence, 'high');
  const wrapped = await run([js('/p/w.js', "app.get('/a', asyncHandler(async (req, res) => {\n  db.query('select ' + req.query.id);\n}));\n")]);
  assert.equal(wrapped.found.find((f) => f.ruleId === 'taint.sql-injection')?.confidence, 'high');
});

// ── C2: test-path detection is relative to the scan root ───────────────────────────────
test('C2: a project that lives under a folder called spec/ or tests/ is not "test code"', async () => {
  const src = "app.get('/x', (req, res) => { eval(req.query.c); });\n";
  const inSpec = await run([js('/home/u/spec/myapp/server.js', src)], '/home/u/spec/myapp');
  assert.notEqual(inSpec.found.find((f) => f.ruleId === 'taint.code-injection')?.confidence, 'low');
  const realTest = await run([js('/home/u/app/tests/server.js', src)], '/home/u/app');
  assert.equal(realTest.found.find((f) => f.ruleId === 'taint.code-injection')?.confidence, 'low');
  const latest = await run([lang('/p/Latest.cs', 'class C { void M() { } }', 'csharp')]);
  assert.equal(latest.r.facts.get('/p/Latest.cs')?.isTest, false);
});

// ── C3: secrets never appear in `code`, `message`, evidence or frames ──────────────────
const SECRET = 'S3cr3tPassw0rd' + 'Zx9qLm';
test('C3: every occurrence and every other secret on the line is redacted', () => {
  const two = scanTextForSecrets('a.py', `password = "${SECRET}" ; confirm_password = "${SECRET}"\n`);
  assert.ok(two.length > 0);
  for (const f of two) assert.ok(!f.code.includes(SECRET), f.code);
  const key = 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYzzzzzzzz';
  const akia = 'AKIA' + 'QZ8WMN3XT6VB1CY4';
  const line = `{"id": "${akia}", "aws_secret_access_key": "${key}"}\n`;
  for (const f of scanTextForSecrets('creds.json', line)) {
    assert.ok(!f.code.includes(akia) && !f.code.includes(key), `${f.ruleId}: ${f.code}`);
  }
});
test('C3: a generic value containing spaces is redacted in full; key bodies are redacted to the end', () => {
  const value = "F12Zr47j" + "\\3yX R~X@H!jmM]Lwf/,?KT";
  const [f] = scanTextForSecrets('app.py', `app.secret_key = '${value}'\n`);
  assert.ok(f, 'detected');
  assert.ok(!f!.code.includes('R~X@H'), f!.code);
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC' + 'KkwggSlAgEAAoIBAQC7';
  for (const g of scanTextForSecrets('sa.json', `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----\\n"}\n`)) {
    assert.ok(!g.code.includes(body), `${g.ruleId}: ${g.code}`);
  }
});
test('C3: letters-only values in config files are detected, and neighbouring frame lines are redacted', () => {
  const found = scanTextForSecrets('/app/.env', 'DB_PASSWORD=correcthorsebatterystaple\n');
  assert.deepEqual(found.map((f) => f.ruleId), ['secret.hardcoded-password']);
  const finding = { source: 'athena-secrets' as const, type: 'x', message: 'y', line: 1, code: 'KEY=[REDACTED]', file: '/app/.env' };
  assert.equal(redactFrameLine(finding, 2, 'DB_PASSWORD=correcthorsebatterystaple'), 'DB_PASSWORD=[REDACTED]');
});
test('C3: raw node text of a taint finding is redacted before it reaches any output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-red-'));
  const token = 'Zq8vK2mLpX9' + 'abcdEF12ghIJ34klMN';
  const file = join(dir, 'app.py');
  writeFileSync(file, `@app.route("/u")\ndef u():\n    requests.get(request.args["u"], headers={"Authorization": "Bearer ${token}"})\n`);
  const report = await scanFiles([file], mergeConfig(noExternal), {}, { root: dir, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null });
  assert.ok(!JSON.stringify(report).includes(token));
});

// ── I1: guards must apply to the variable that is checked ───────────────────────────────
test('I1: an unrelated prefix check or basename elsewhere does not suppress a path traversal', async () => {
  const bad = "app.get('/f', (req, res) => {\n  const safe = path.resolve(BASE, 'fixed');\n  if (!safe.startsWith(BASE)) return;\n  fs.readFileSync(req.query.d);\n});\n";
  assert.deepEqual((await run([js('/p/a.js', bad)])).found.filter((f) => f.ruleId === 'taint.path-traversal').map((f) => f.line), [4]);
  const good = "app.get('/f', (req, res) => {\n  const p = path.resolve(BASE, req.query.d);\n  if (!p.startsWith(BASE)) return;\n  fs.readFileSync(p);\n});\n";
  assert.deepEqual((await run([js('/p/a.js', good)])).found.filter((f) => f.ruleId === 'taint.path-traversal'), []);
});

// ── I2: budgets ────────────────────────────────────────────────────────────────────────
test('I2: many tainted sinks with many resolve tokens stay linear', async () => {
  let body = '';
  for (let i = 0; i < 400; i += 1) body += `  const r${i} = path.resolve(BASE, 'x${i}');\n`;
  for (let i = 0; i < 40; i += 1) body += `  fs.readFileSync(req.query.d${i});\n`;
  const started = Date.now();
  await run([js('/p/a.js', `app.get('/f', (req, res) => {\n${body}});\n`)]);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});
test('I2: a file with thousands of string literals does not make secret scanning quadratic', () => {
  const lines = Array.from({ length: 6000 }, (_, i) => `const s${i} = "value-number-${i}-padding-text-here";`).join('\n');
  const started = Date.now();
  scanTextForSecrets('big.js', lines);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});
test('I2: many SELECT strings in nested functions stay bounded', async () => {
  let src = '';
  for (let i = 0; i < 60; i += 1) src += `function f${i}() {\n  db.query("SELECT * FROM t${i} WHERE id = 1");\n`;
  src += '}\n'.repeat(60);
  const started = Date.now();
  await run([js('/p/a.js', src)]);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

// ── I3: odd but valid code never crashes the scan ───────────────────────────────────────
test('I3: unusual declarators and $-identifiers do not throw', async () => {
  const src = "async function f() {\n  const { a = \")\" } = await pool.connect();\n  const $client = await pool.connect();\n  $client.release();\n}\n";
  const { found } = await run([js('/p/a.js', src)]);
  assert.ok(!found.some((f) => f.ruleId === 'lifecycle.resource-not-released' && f.line === 3));
});

// ── I4: common safe idioms stay silent ──────────────────────────────────────────────────
test('I4: safe idioms are not flagged', async () => {
  const cases: Array<[ProjectFile, string]> = [
    [py('/p/a.py', "@app.route('/x')\ndef f():\n    name = request.args['n']\n    cmd = ['git', 'log', name]\n    subprocess.run(cmd)\n    return Response(json.dumps({'a': name}), mimetype='application/json')\n"), ''],
    [lang('/p/A.java', 'class A { void f(HttpServletRequest request) throws Exception { String pw = request.getParameter("p"); md.update(pw.getBytes()); cache.query(pw); } }', 'java'), ''],
    [lang('/p/a.go', 'package m\nfunc h(w http.ResponseWriter, r *http.Request) {\n\tname := r.URL.Query().Get("n")\n\tcache.Get(name)\n\trows := db.Query("SELECT 1")\n\tos.Open(rows)\n}\n', 'go'), ''],
    [lang('/p/a.rs', 'async fn h(Query(p): Query<P>) { users.get(p.id); }\n', 'rust'), ''],
    [lang('/p/C.cs', 'class C { public IActionResult A([FromBody] string body) { var u = JsonSerializer.Deserialize(body, typeof(User)); return Content(body); } }', 'csharp'), ''],
    [py('/p/m.py', "password = db.Column(db.String(80))\npassword = content['password']\ncust.password = str(base64.b64encode(x))\n"), ''],
  ];
  for (const [file] of cases) {
    const { found } = await run([file]);
    const bad = found.filter((f) => f.source !== 'athena-investigate').map((f) => f.ruleId);
    const secrets = scanTextForSecrets(file.path, file.source).map((f) => f.ruleId);
    assert.deepEqual([...bad, ...secrets], [], file.path);
  }
});
test('I4: login and register routes and express-session are not authentication conventions', async () => {
  const routes = ["router.use(session({ secret: 'x' }));", ...[1, 2, 3, 4, 5].map((i) => `router.get('/r${i}', requireAuth, (req, res) => res.send('x'));`), "router.post('/login', (req, res) => res.send('x'));", "router.post('/register', (req, res) => res.send('x'));"].join('\n') + '\n';
  const { found } = await run([js('/p/routes.js', routes)]);
  assert.deepEqual(found.filter((f) => f.ruleId === 'conv.missing-auth'), []);
  const open = ["router.use(session({ secret: 'x' }));", ...[1, 2, 3, 4, 5].map((i) => `router.get('/r${i}', requireAuth, (req, res) => res.send('x'));`), "router.get('/admin-data', (req, res) => res.send('x'));"].join('\n') + '\n';
  assert.deepEqual((await run([js('/p/routes.js', open)])).found.filter((f) => f.ruleId === 'conv.missing-auth').map((f) => f.line), [7]);
});

// ── I5: vendored, generated and minified code ───────────────────────────────────────────
test('I5: vendored/generated/minified files are not rule-analysed but are listed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-vend-'));
  mkdirSync(join(dir, 'third_party'));
  const evil = "app.get('/x', (req, res) => { eval(req.query.c); });\n";
  const files = [join(dir, 'third_party', 'x.js'), join(dir, 'app.min.js'), join(dir, 'gen.js')];
  writeFileSync(files[0]!, evil);
  writeFileSync(files[1]!, evil);
  writeFileSync(files[2]!, `// Code generated by protoc. DO NOT EDIT.\n${evil}`);
  const report = await scanFiles(files, mergeConfig(noExternal), {}, { root: dir, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null });
  assert.equal(report.files.flatMap((f) => f.findings).filter((f) => f.ruleId.startsWith('taint.')).length, 0);
  for (const f of report.summary.coverage!.files) assert.equal(f.status, 'skipped-excluded', f.path);
});
test('I5: a secret on a very long line is still found', () => {
  const akia = 'AKIA' + 'QZ8WMN3XT6VB1CY4';
  const found = scanTextForSecrets('bundle.txt', `${'x'.repeat(4500)} "${akia}" ${'y'.repeat(300)}\n`);
  assert.ok(found.some((f) => f.ruleId === 'secret.aws-access-key'));
});

// ── I5b: the real shapes behind the Bend-found bugs ─────────────────────────────────────
test('I5b: connection handler that awaits before attaching close is flagged', async () => {
  const src = "wss.on('connection', async (ws, req) => {\n  const user = await authenticate(req);\n  const session = registerSession(user);\n  ws.on('close', () => clear(session));\n});\n";
  const { found } = await run([js('/p/a.js', src)]);
  assert.deepEqual(found.filter((f) => f.ruleId === 'lifecycle.cleanup-after-await').map((f) => f.line), [4]);
  const ok = "wss.on('connection', (ws, req) => {\n  ws.on('close', () => clear());\n  authenticate(req).then(() => {});\n});\n";
  assert.deepEqual((await run([js('/p/a.js', ok)])).found.filter((f) => f.ruleId === 'lifecycle.cleanup-after-await'), []);
});

// ── I7 ──────────────────────────────────────────────────────────────────────────────────
test('I7: a Python absolute import never resolves to a same-named file in another package', async () => {
  const { found } = await run([
    py('/p/a/utils.py', 'import os\ndef run(x):\n    os.system(x)\n'),
    py('/p/b/utils.py', 'def run(x):\n    return len(x)\n'),
    py('/p/b/main.py', "from utils import run\n@app.route('/x')\ndef h():\n    run(request.args['u'])\n"),
  ]);
  assert.deepEqual(found.filter((f) => f.path === '/p/b/main.py' && f.ruleId === 'taint.command-injection'), []);
});
test('I7: sanitizing a variable after its use does not erase the earlier flow', async () => {
  const after = "app.get('/', (req, res) => {\n  let p = req.query.p;\n  db.query('select ' + p);\n  p = escape(p);\n});\n";
  assert.deepEqual((await run([js('/p/a.js', after)])).found.filter((f) => f.ruleId === 'taint.sql-injection').map((f) => f.line), [3]);
  const before = after.replace("  db.query('select ' + p);\n  p = escape(p);\n", "  p = escape(p);\n  db.query('select ' + p);\n");
  assert.deepEqual((await run([js('/p/a.js', before)])).found.filter((f) => f.ruleId === 'taint.sql-injection'), []);
});
test('I7: inline require("child_process").exec is a sink', async () => {
  const { found } = await run([js('/p/a.js', "app.get('/', (req, res) => {\n  require('child_process').exec(req.query.c);\n});\n")]);
  assert.deepEqual(found.filter((f) => f.ruleId === 'taint.command-injection').map((f) => f.line), [2]);
});

test('a sentence assigned to a secret-named constant is not a secret', () => {
  assert.deepEqual(scanTextForSecrets('catalog.ts', "const secretWhy = 'Credentials committed to source control are readable by anyone with repository access.';\n"), []);
});
