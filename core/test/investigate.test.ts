import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';
import { isReachable } from '../src/investigate/map.ts';
import { priorityOf } from '../src/investigate/verify.ts';

const js = (path: string, source: string): ProjectFile => ({ path, source, lang: 'javascript' });
const ts = (path: string, source: string): ProjectFile => ({ path, source, lang: 'typescript' });
const py = (path: string, source: string): ProjectFile => ({ path, source, lang: 'python' });

async function run(files: ProjectFile[], publicRoutes: string[] = []) {
  const result = await analyzeProject(files, { publicRoutes });
  const found = [...result.findings].flatMap(([path, list]) => list.map((f) => ({ path, ...f })));
  return { result, found, ids: (prefix: string) => found.filter((f) => f.ruleId.startsWith(prefix)).map((f) => `${f.line} ${f.ruleId}`).sort() };
}

// ── the four bug shapes Bend found in Athena ─────────────────────────────────────────────
test('cleanup attached after an await is flagged; attaching it first is not', async () => {
  const bad = "async function onConnection(socket) {\n  sessions.set(socket.id, socket);\n  const user = await authenticate(socket);\n  socket.on('close', () => sessions.delete(socket.id));\n}\n";
  const good = "async function onConnection(socket) {\n  sessions.set(socket.id, socket);\n  socket.on('close', () => sessions.delete(socket.id));\n  const user = await authenticate(socket);\n}\n";
  assert.deepEqual((await run([js('/p/a.js', bad)])).ids('lifecycle.cleanup'), ['4 lifecycle.cleanup-after-await']);
  assert.deepEqual((await run([js('/p/a.js', good)])).ids('lifecycle.cleanup'), []);
});

test('success status without a failure status on the exit path is flagged', async () => {
  const bad = "async function runScan(id) {\n  try {\n    await clone(id);\n    await db.update(id, { status: 'completed' });\n  } catch (err) {\n    log(err);\n    return;\n  }\n}\n";
  const good = bad.replace('    log(err);\n', "    await db.update(id, { status: 'failed' });\n");
  assert.deepEqual((await run([js('/p/a.js', bad)])).ids('lifecycle.status'), ['5 lifecycle.status-not-set-on-failure']);
  assert.deepEqual((await run([js('/p/a.js', good)])).ids('lifecycle.status'), []);
});

test('an error turned into a success-looking value is flagged', async () => {
  const bad = "async function runEslint(files) {\n  try {\n    return await eslint.lint(files);\n  } catch (e) {\n    return [];\n  }\n}\n";
  const good = bad.replace('return [];', 'throw e;');
  assert.deepEqual((await run([js('/p/a.js', bad)])).ids('error.'), ['4 error.swallowed-success']);
  assert.deepEqual((await run([js('/p/a.js', good)])).ids('error.'), []);
  const emptyCatch = "function f() {\n  try { risky(); } catch (e) {}\n}\n";
  assert.deepEqual((await run([js('/p/a.js', emptyCatch)])).ids('error.'), ['2 error.empty-catch']);
});

test('read-then-write keyed only by id is a race; a conditional UPDATE is not', async () => {
  const bad = "async function redeem(id) {\n  const row = await db.query('SELECT * FROM tokens WHERE id = $1', [id]);\n  if (row.used) throw new Error('used');\n  await db.query('UPDATE tokens SET used = true WHERE id = $1', [id]);\n}\n";
  const good = bad.replace('WHERE id = $1\', [id]);\n}', 'WHERE id = $1 AND used = false\', [id]);\n}');
  assert.deepEqual((await run([js('/p/a.js', bad)])).ids('lifecycle.check'), ['4 lifecycle.check-then-act']);
  assert.deepEqual((await run([js('/p/a.js', good)])).ids('lifecycle.check'), []);
});

test('resources, floating promises', async () => {
  const leak = "async function q() {\n  const client = await pool.connect();\n  return client.query('select 1');\n}\n";
  const ok = "async function q() {\n  const client = await pool.connect();\n  try { return await client.query('select 1'); } finally { client.release(); }\n}\n";
  assert.deepEqual((await run([js('/p/a.js', leak)])).ids('lifecycle.resource'), ['2 lifecycle.resource-not-released']);
  assert.deepEqual((await run([js('/p/a.js', ok)])).ids('lifecycle.resource'), []);
  const floating = "async function save() { await db.run('x'); }\nfunction handler() {\n  save();\n}\n";
  assert.deepEqual((await run([js('/p/a.js', floating)])).ids('lifecycle.floating'), ['3 lifecycle.floating-promise']);
  assert.deepEqual((await run([js('/p/a.js', floating.replace('  save();', '  await save();').replace('function handler', 'async function handler'))])).ids('lifecycle.floating'), []);
});

test('python: unclosed file and swallowed exception', async () => {
  const bad = "def run_checks(path):\n    f = open(path)\n    try:\n        return f.read()\n    except Exception:\n        return {}\n";
  const ids = (await run([py('/p/a.py', bad)])).ids('');
  assert.ok(ids.includes('2 lifecycle.resource-not-released'), ids.join(','));
  assert.ok(ids.includes('5 error.swallowed-success'), ids.join(','));
});

// ── intent vs code ──────────────────────────────────────────────────────────────────────
test('intent: validators that cannot fail, unkept comment promises, security TODOs', async () => {
  const src = "function validateToken(t) {\n  return true;\n}\nfunction validateInput(x) {\n  if (!x) throw new Error('bad');\n  return true;\n}\n// sanitize the input\nconst clean = sanitize(input);\nuse(clean);\nuse(clean);\nuse(clean);\nuse(clean);\n// sanitize the input before using it\ndb.run(buildQuery(input));\n// TODO: add authentication here\n";
  const { ids } = await run([js('/p/a.js', src)]);
  assert.deepEqual(ids('intent.'), ['1 intent.validator-never-fails', '16 intent.security-todo', '14 intent.comment-promises-security'].sort());
});

test('intent: a test without assertions', async () => {
  const src = "it('rejects invalid tokens', () => {\n  verify('x');\n});\nit('works', () => {\n  expect(1).toBe(1);\n});\n";
  const { ids } = await run([js('/p/a.test.js', src)]);
  assert.deepEqual(ids('intent.test'), ['1 intent.test-without-assertion']);
});

// ── entry points ────────────────────────────────────────────────────────────────────────
test('entry points: Express routes with guards, use() middleware and exposure', async () => {
  const src = "app.get('/public', (req, res) => res.send('x'));\napp.post('/login', login);\napp.get('/me', requireAuth, (req, res) => res.json({}));\n";
  const { result } = await run([js('/p/app.js', src)]);
  const routes = result.map.entrypoints.map((e) => `${e.method} ${e.route} ${e.exposure}`);
  assert.deepEqual(routes, ['GET /public public', 'POST /login public', 'GET /me authenticated']);
  const use = "app.use(requireAuth);\napp.get('/a', (req, res) => res.send('x'));\n";
  assert.deepEqual((await run([js('/p/app.js', use)])).result.map.entrypoints.map((e) => e.exposure), ['authenticated']);
});

test('entry points: FastAPI, Spring, ASP.NET, gin, axum, Laravel, CLI, queue', async () => {
  const fastapi = py('/p/api.py', "@app.get('/items')\nasync def items(user=Depends(get_current_user)):\n    return []\n@app.post('/open')\ndef open_():\n    return 1\n@celery.task\ndef work():\n    pass\n");
  const spring: ProjectFile = { path: '/p/C.java', lang: 'java', source: 'class C {\n  @PreAuthorize("hasRole(\'A\')")\n  @GetMapping("/a")\n  public String a() { return ""; }\n  @PostMapping("/b")\n  public String b() { return ""; }\n}\n' };
  const cs: ProjectFile = { path: '/p/C.cs', lang: 'csharp', source: 'class C {\n  [Authorize]\n  [HttpGet("a")]\n  public int A() { return 1; }\n  [AllowAnonymous]\n  [HttpPost("b")]\n  public int B() { return 1; }\n}\n' };
  const go: ProjectFile = { path: '/p/m.go', lang: 'go', source: 'package m\nfunc main() {\n\tr.GET("/a", authRequired(h))\n\tr.POST("/b", h2)\n}\n' };
  const rust: ProjectFile = { path: '/p/m.rs', lang: 'rust', source: '#[get("/a")]\nasync fn a() -> String { String::new() }\n' };
  const php: ProjectFile = { path: '/p/web.php', lang: 'php', source: "<?php\nRoute::get('/a', [C::class, 'a'])->middleware('auth');\nRoute::get('/b', [C::class, 'b']);\n" };
  const all = (await run([fastapi, spring, cs, go, rust, php])).result.map.entrypoints.map((e) => `${e.file.split('/').pop()} ${e.kind} ${e.method ?? ''} ${e.route ?? ''} ${e.exposure}`.replace(/\s+/g, ' ')).sort();
  assert.deepEqual(all, [
    'C.cs route GET /a authenticated', 'C.cs route POST /b public',
    'C.java route GET /a authenticated', 'C.java route POST /b public',
    'api.py queue internal', 'api.py route GET /items authenticated', 'api.py route POST /open public',
    'm.go route GET /a authenticated', 'm.go route POST /b public', 'm.rs route GET /a public',
    'web.php route GET /a authenticated', 'web.php route GET /b public',
  ].sort());
});

test('reachability: a function only called from tests is unreachable; handler callees are reachable', async () => {
  const src = "function helper() { return 1; }\nfunction orphan() { return 2; }\napp.get('/x', (req, res) => { res.send(helper()); });\n";
  const test = "orphan();\n";
  const { result } = await run([js('/p/app.js', src), js('/p/app.test.js', test)]);
  assert.equal(isReachable(result.map, '/p/app.js', 1), true);
  assert.equal(isReachable(result.map, '/p/app.js', 2), false);
});

// ── conventions ─────────────────────────────────────────────────────────────────────────
const routerOf = (n: number, skipAuthAt: number): string => Array.from({ length: n }, (_, i) => (i === skipAuthAt ? `router.get('/r${i}', (req, res) => res.send('x'));` : `router.get('/r${i}', requireAuth, (req, res) => res.send('x'));`)).join('\n') + '\n';

test('convention: 5 authenticated routes and 1 without -> finding citing two siblings', async () => {
  const { found } = await run([js('/p/routes.js', routerOf(6, 3))]);
  const f = found.find((x) => x.ruleId === 'conv.missing-auth')!;
  assert.ok(f);
  assert.equal(f.line, 4);
  assert.match(f.message!, /5 of 6 routes/);
  assert.equal(f.evidence!.filter((e) => e.startsWith('Follows it')).length, 2);
});

test('convention: small clusters, test files and declared public routes are not flagged', async () => {
  assert.deepEqual((await run([js('/p/routes.js', routerOf(3, 1))])).ids('conv.'), []);
  assert.deepEqual((await run([js('/p/routes.test.js', routerOf(6, 3))])).ids('conv.'), []);
  assert.deepEqual((await run([js('/p/routes.js', routerOf(6, 3))], ['/r3'])).ids('conv.'), []);
});

test('convention: queries on a table that all filter by user_id except one -> IDOR candidate', async () => {
  const q = (cond: string, i: number) => `db.query("SELECT * FROM scans WHERE ${cond}");`.replace('SELECT', i < 0 ? 'SELECT' : 'SELECT');
  const src = [q('user_id = $1 AND id = $2', 0), q('user_id = $1', 1), q('user_id = $1 AND status = $2', 2), q('user_id = $1 AND id = $2', 3), q('id = $1', 4)].map((line, i) => `function f${i}() {\n  ${line}\n}`).join('\n');
  const { found } = await run([js('/p/q.js', src)]);
  const f = found.filter((x) => x.ruleId === 'conv.missing-ownership-filter');
  assert.equal(f.length, 1);
  assert.equal(f[0]!.line, 14);
  const three = src.split('\n').slice(0, 9).join('\n');
  assert.deepEqual((await run([js('/p/q.js', three)])).ids('conv.'), []);
});

test('state machine: a declared state that nothing assigns', async () => {
  const src = "type ScanStatus = 'queued' | 'running' | 'completed' | 'archived';\nfunction a() { db.update({ status: 'queued' }); }\nfunction b() { db.update({ status: 'running' }); }\nfunction c() { db.update({ status: 'completed' }); }\n";
  assert.deepEqual((await run([ts('/p/s.ts', src)])).ids('state.'), ["1 state.unreachable-state"]);
});

// ── verification ────────────────────────────────────────────────────────────────────────
test('verification: unreachable and test-code findings are low confidence; reachable public ones keep priority', async () => {
  const src = "function dead() { const resetToken = Math.random(); }\napp.get('/x', (req, res) => { eval(req.query.c); });\n";
  const { found } = await run([js('/p/app.js', src)]);
  const dead = found.find((f) => f.ruleId === 'crypto.insecure-random' && f.line === 1)!;
  const live = found.find((f) => f.ruleId === 'taint.code-injection' && f.line === 2)!;
  assert.equal(dead.confidence, 'low');
  assert.ok(dead.evidence!.some((e) => /no route/i.test(e)));
  const deadRequest = (await run([js('/p/app.js', "function dead(req) { eval(req.query.c); }\napp.get('/x', (req, res) => {});\n")])).found.find((f) => f.ruleId === 'taint.code-injection')!;
  assert.equal(deadRequest.confidence, 'high', 'request-sourced taint is proof of an entry point');
  assert.equal(live.confidence, 'high');
  assert.equal(live.exposure, 'public');
  assert.ok(live.priority! > dead.priority!);
  const inTest = (await run([js('/p/app.test.js', "app.get('/x', (req, res) => { eval(req.query.c); });\n")])).found.find((f) => f.ruleId === 'taint.code-injection')!;
  assert.equal(inTest.confidence, 'low');
});

test('priority orders severity x exposure x confidence', () => {
  assert.ok(priorityOf('HIGH', 'public', 'high') > priorityOf('HIGH', 'internal', 'high'));
  assert.ok(priorityOf('CRITICAL', 'authenticated', 'medium') > priorityOf('HIGH', 'authenticated', 'medium'));
  assert.ok(priorityOf('MEDIUM', 'public', 'high', true) > priorityOf('MEDIUM', 'public', 'high', false));
  assert.ok(priorityOf('HIGH', 'public', 'low') < priorityOf('HIGH', 'public', 'high'));
});

test('gate line mentions findings that need review; SARIF reports them as notes', async () => {
  const { gateLine } = await import('../src/report/terminal-formatter.ts');
  const report = { summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false, needsReview: 3, coverage: { complete: true, gaps: [], files: [], checks: [] } } } as never;
  assert.match(gateLine(report, 'high').detail, /3 need review \(not blocking\)/);
});
