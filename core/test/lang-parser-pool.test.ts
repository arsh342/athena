import assert from 'node:assert/strict';
import test from 'node:test';

import type { LanguageId } from '../src/lang/languages.ts';
import { __setGrammarDirForTests, getParser, ParserUnavailableError } from '../src/lang/parser-pool.ts';

const programs: Record<LanguageId, string> = {
  javascript: 'let a = 1;',
  typescript: 'let a: number = 1;',
  tsx: 'const a = <b />;',
  python: 'def f(x):\n    return x\n',
  java: 'class A { void f() {} }',
  csharp: 'class A { void F() {} }',
  c: 'int f(void) { return 1; }',
  cpp: 'int f() { return 1; }',
  go: 'package m\nfunc f() {}\n',
  rust: 'fn f() {}',
  php: '<?php function f() {}',
  shell: 'echo hi',
};

test('every language parses a one-line program without errors', async () => {
  for (const [lang, src] of Object.entries(programs) as Array<[LanguageId, string]>) {
    const parser = await getParser(lang);
    const tree = parser.parse(src);
    assert.ok(tree, lang);
    assert.equal(tree.rootNode.hasError, false, lang);
  }
});

test('parsers are cached per language', async () => {
  assert.equal(await getParser('python'), await getParser('python'));
});

test('a missing grammar directory rejects with ParserUnavailableError', async () => {
  __setGrammarDirForTests('/nonexistent-athena-grammars');
  try {
    await assert.rejects(getParser('go'), (err: unknown) => err instanceof ParserUnavailableError && err.lang === 'go');
  } finally {
    __setGrammarDirForTests(null);
  }
  const ok = await getParser('go');
  assert.equal(ok.parse('package m').rootNode.hasError, false);
});
