import assert from 'node:assert/strict';
import test from 'node:test';

import { detectLanguage, isSupportedSource, LANGUAGE_FAMILY } from '../src/lang/languages.ts';

const table: Array<[string, string]> = [
  ['a.js', 'javascript'], ['a.mjs', 'javascript'], ['a.cjs', 'javascript'],
  ['a.ts', 'typescript'], ['a.mts', 'typescript'], ['a.cts', 'typescript'],
  ['a.tsx', 'tsx'], ['a.jsx', 'tsx'],
  ['a.py', 'python'], ['a.pyi', 'python'],
  ['A.java', 'java'], ['A.cs', 'csharp'],
  ['a.c', 'c'], ['a.h', 'c'],
  ['a.cc', 'cpp'], ['a.cpp', 'cpp'], ['a.cxx', 'cpp'], ['a.hpp', 'cpp'], ['a.hh', 'cpp'], ['a.hxx', 'cpp'],
  ['a.go', 'go'], ['a.rs', 'rust'], ['a.php', 'php'], ['a.phtml', 'php'],
  ['a.sh', 'shell'], ['a.bash', 'shell'], ['a.zsh', 'shell'],
];

test('detectLanguage maps every supported extension', () => {
  for (const [file, lang] of table) assert.equal(detectLanguage(`src/${file}`), lang, file);
});

test('extensions are case-insensitive and unknown ones are null', () => {
  assert.equal(detectLanguage('Main.JAVA'), 'java');
  assert.equal(detectLanguage('README.md'), null);
  assert.equal(detectLanguage('Makefile'), null);
});

test('extensionless files use the shebang', () => {
  assert.equal(detectLanguage('bin/tool', '#!/usr/bin/env python3'), 'python');
  assert.equal(detectLanguage('bin/tool', '#!/bin/bash'), 'shell');
  assert.equal(detectLanguage('bin/tool', '#!/usr/bin/env zsh'), 'shell');
  assert.equal(detectLanguage('bin/tool', '#!/usr/bin/env node'), 'javascript');
  assert.equal(detectLanguage('bin/tool', '#!/bin/sh -e'), 'shell');
  assert.equal(detectLanguage('bin/tool', 'echo hi'), null);
  assert.equal(detectLanguage('bin/tool'), null);
  assert.equal(detectLanguage('bin/tool', '#!/usr/bin/env ruby'), null);
});

test('isSupportedSource is extension based', () => {
  assert.equal(isSupportedSource('x/y.rs'), true);
  assert.equal(isSupportedSource('x/y.txt'), false);
  assert.equal(isSupportedSource('bin/deploy'), false);
});

test('every language has a family', () => {
  assert.equal(LANGUAGE_FAMILY.tsx, 'js');
  assert.equal(LANGUAGE_FAMILY.c, 'c');
  assert.equal(LANGUAGE_FAMILY.cpp, 'c');
  assert.equal(LANGUAGE_FAMILY.shell, 'shell');
  assert.equal(Object.keys(LANGUAGE_FAMILY).length, 12);
});

test('shebang variants: env -S, env flags, versioned interpreters, BOM and CRLF', async () => {
  const { languageFromShebang } = await import('../src/lang/languages.ts');
  assert.equal(languageFromShebang('#!/usr/bin/env -S node --no-warnings'), 'javascript');
  assert.equal(languageFromShebang('#!/usr/bin/env -S python3 -u'), 'python');
  assert.equal(languageFromShebang('#!/usr/bin/env PATH=/x node'), 'javascript');
  assert.equal(languageFromShebang('#!/usr/bin/python3.11'), 'python');
  assert.equal(languageFromShebang('#!/usr/local/bin/python3.12 -O'), 'python');
  assert.equal(languageFromShebang('#!/usr/bin/env node\r'), 'javascript');
  assert.equal(languageFromShebang('﻿#!/usr/bin/env node'), 'javascript');
  assert.equal(languageFromShebang('#!/bin/sh'), 'shell');
  assert.equal(languageFromShebang('#!/usr/bin/env ruby'), null);
});
