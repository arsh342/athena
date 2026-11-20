import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';

const js = (path: string, source: string): ProjectFile => ({ path, source, lang: 'javascript' });
const py = (path: string, source: string): ProjectFile => ({ path, source, lang: 'python' });

async function taint(files: ProjectFile[]) {
  const result = await analyzeProject(files);
  return [...result.findings].flatMap(([path, list]) => list.filter((f) => f.source === 'athena-taint').map((f) => ({ path, ...f })));
}

test('direct flow is found with a source-to-sink trace', async () => {
  const [f] = await taint([js('/p/a.js', "app.get('/', (req, res) => {\n  const q = req.query.q;\n  db.query('select ' + q);\n});\n")]);
  assert.equal(f!.ruleId, 'taint.sql-injection');
  assert.equal(f!.line, 3);
  assert.deepEqual(f!.trace!.map((t) => t.line), [2, 2, 3]);
  assert.match(f!.trace![0]!.note, /^source: req\.query\.q/);
  assert.match(f!.trace!.at(-1)!.note, /reaches db\.query\(\)/);
});

test('flow through a helper function summary is found at the call site', async () => {
  const found = await taint([js('/p/a.js', "function wrap(x) { return '<b>' + x + '</b>'; }\napp.get('/', (req, res) => {\n  res.send(wrap(req.query.n));\n});\n")]);
  assert.deepEqual(found.map((f) => `${f.line} ${f.ruleId}`), ['3 taint.xss']);
});

test('a sanitizer on the path stops the flow', async () => {
  const found = await taint([js('/p/a.js', "app.get('/', (req, res) => {\n  const q = escapeHtml(req.query.q);\n  res.send(q);\n});\n")]);
  assert.deepEqual(found, []);
});

test('re-assigning through a sanitizer clears the taint', async () => {
  const found = await taint([js('/p/a.js', "app.get('/', (req, res) => {\n  let q = req.query.q;\n  q = parseInt(q, 10);\n  db.query('select ' + q);\n});\n")]);
  assert.deepEqual(found, []);
});

test('cross-file JS flows resolve require and import', async () => {
  const found = await taint([
    js('/p/routes.js', "const { run } = require('./util');\nconst u = require('./util2');\napp.post('/x', (req, res) => {\n  run(req.body.cmd);\n  u.q(req.query.a);\n});\n"),
    js('/p/util.js', "const { exec } = require('child_process');\nfunction run(c) { exec(c); }\nmodule.exports = { run };\n"),
    js('/p/util2.js', "function q(a) { return db.query('select ' + a); }\nmodule.exports = { q };\n"),
  ]);
  assert.deepEqual(found.map((f) => `${f.path}:${f.line} ${f.ruleId}`).sort(), ['/p/routes.js:4 taint.command-injection', '/p/routes.js:5 taint.sql-injection']);
  assert.equal(found[0]!.trace!.some((t) => t.file === '/p/util.js'), true, 'trace enters the callee file');
});

test('cross-file Python flows resolve relative imports', async () => {
  const found = await taint([
    py('/p/a.py', "from .b import go\n@app.route('/x')\ndef h():\n    go(request.args['u'])\n"),
    py('/p/b.py', 'import os\ndef go(x):\n    os.system(x)\n'),
  ]);
  assert.deepEqual(found.map((f) => `${f.path}:${f.line} ${f.ruleId}`), ['/p/a.py:4 taint.command-injection']);
});

test('mutual recursion terminates quickly', async () => {
  const started = Date.now();
  const found = await taint([js('/p/a.js', "function a(x) { return b(x); }\nfunction b(x) { return a(x); }\napp.get('/', (req, res) => { db.query(a(req.query.q)); });\n")]);
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(found, []);
});

test('a reversed call chain of five helpers still reaches the sink', async () => {
  const source = "app.get('/', (req, res) => { f1(req.query.c); });\nfunction f1(a) { f2(a); }\nfunction f2(a) { f3(a); }\nfunction f3(a) { f4(a); }\nfunction f4(a) { f5(a); }\nfunction f5(a) { eval(a); }\n";
  const found = await taint([js('/p/a.js', source)]);
  assert.deepEqual(found.map((f) => `${f.line} ${f.ruleId}`), ['1 taint.code-injection']);
});

test('pathological nesting finishes or is reported, never hangs', async () => {
  let body = 'x';
  for (let i = 0; i < 400; i += 1) body = `f${i}(${body} + req.query.a)`;
  const started = Date.now();
  const result = await analyzeProject([js('/p/a.js', `app.get('/', (req, res) => { const x = ${body}; db.query(x); });\n`)]);
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms`);
  assert.ok(result.timedOut.length === 0 || result.timedOut[0] === '/p/a.js');
});

const FLASK_ERR = (body: string, sink: string) => `from flask import Flask, request, render_template_string, jsonify
app = Flask(__name__)

@app.route("/q")
def q():
    try:
${body}
    except Exception as e:
        template = '<h3>%s</h3>' % str(e)
        return ${sink}
`;

test('exception text from a try block that handles request data reaches a template sink', async () => {
  const found = await taint([py('/p/a.py', FLASK_ERR("        cur.execute('select ' + request.args['x'])", 'render_template_string(template)'))]);
  const hit = found.filter((f) => f.ruleId === 'taint.template-injection');
  assert.equal(hit.length, 1);
  assert.match(hit[0]!.trace![0]!.note, /exception/);
});

test('exception text is not tainted when the try block handles no request data, and only template/code sinks use it', async () => {
  assert.deepEqual(await taint([py('/p/a.py', FLASK_ERR("        cur.execute('select 1')", 'render_template_string(template)'))]), []);
  assert.deepEqual((await taint([py('/p/a.py', FLASK_ERR("        cur.execute('select ' + request.args['x'])", 'Response(template)'))])).filter((x) => x.ruleId === 'taint.xss'), [], 'exception text is not reported as XSS');
  assert.deepEqual(await taint([py('/p/a.py', FLASK_ERR("        cur.execute('select ' + request.args['x'])", 'jsonify(template)'))]).then((f) => f.filter((x) => x.ruleId === 'taint.xss')), []);
});
