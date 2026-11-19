import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { LanguageId } from './languages.js';

/** Minimal structural types for the web-tree-sitter API we use. */
export interface TSPoint { row: number; column: number }
export interface TSNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TSPoint;
  endPosition: TSPoint;
  isNamed: boolean;
  isMissing: boolean;
  isError: boolean;
  hasError: boolean;
  parent: TSNode | null;
  childCount: number;
  namedChildCount: number;
  children: Array<TSNode | null>;
  namedChildren: Array<TSNode | null>;
  child(index: number): TSNode | null;
  namedChild(index: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
  previousNamedSibling: TSNode | null;
  previousSibling: TSNode | null;
  nextNamedSibling: TSNode | null;
}
export interface TSTree { rootNode: TSNode; delete(): void }
export interface TSQueryCapture { name: string; node: TSNode }
export interface TSQueryMatch { patternIndex: number; captures: TSQueryCapture[] }
export interface TSQuery { matches(node: TSNode): TSQueryMatch[]; delete(): void }
export interface TSLanguage { name: string | null }
export interface TreeSitterParser {
  parse(source: string): TSTree | null;
  language: TSLanguage | null;
}
interface TreeSitterModule {
  Parser: { init(opts: { locateFile: (file: string) => string }): Promise<void>; new (): TreeSitterParser & { setLanguage(l: TSLanguage): void } };
  Language: { load(path: string): Promise<TSLanguage> };
  Query: new (language: TSLanguage, source: string) => TSQuery;
}

export class ParserUnavailableError extends Error {
  constructor(readonly lang: LanguageId, reason: string) {
    super(`parser for ${lang} unavailable: ${reason}`);
    this.name = 'ParserUnavailableError';
  }
}

const GRAMMAR_FILE: Record<LanguageId, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  java: 'tree-sitter-java.wasm',
  csharp: 'tree-sitter-c-sharp.wasm',
  // No C grammar ships in the package; C is parsed with the C++ grammar.
  c: 'tree-sitter-cpp.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  php: 'tree-sitter-php.wasm',
  shell: 'tree-sitter-bash.wasm',
};

const require = createRequire(import.meta.url);
let packageWasmDir: string | null = null;
function wasmDir(): string {
  packageWasmDir ??= join(dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm');
  return packageWasmDir;
}

let grammarDirOverride: string | null = null;
let runtime: Promise<TreeSitterModule> | null = null;
let runtimeModule: TreeSitterModule | null = null;
const languages = new Map<string, Promise<TSLanguage>>();
const parsers = new Map<LanguageId, TreeSitterParser>();
const loaded = new Map<LanguageId, TSLanguage>();

function loadRuntime(): Promise<TreeSitterModule> {
  runtime ??= (async () => {
    const dir = wasmDir();
    const mod = require(join(dir, 'tree-sitter.js')) as TreeSitterModule;
    await mod.Parser.init({ locateFile: (file: string) => join(dir, file) });
    runtimeModule = mod;
    return mod;
  })();
  runtime.catch(() => { runtime = null; });
  return runtime;
}

function loadLanguage(mod: TreeSitterModule, file: string): Promise<TSLanguage> {
  const path = join(grammarDirOverride ?? wasmDir(), file);
  let pending = languages.get(path);
  if (!pending) {
    pending = mod.Language.load(path);
    languages.set(path, pending);
    pending.catch(() => languages.delete(path));
  }
  return pending;
}

/** A parser for `lang`, loaded once and cached. Rejects with ParserUnavailableError, never crashes. */
export async function getParser(lang: LanguageId): Promise<TreeSitterParser> {
  const cached = parsers.get(lang);
  if (cached) return cached;
  let mod: TreeSitterModule;
  let language: TSLanguage;
  try {
    mod = await loadRuntime();
    language = await loadLanguage(mod, GRAMMAR_FILE[lang]);
  } catch (error) {
    throw new ParserUnavailableError(lang, error instanceof Error ? error.message : String(error));
  }
  const existing = parsers.get(lang);
  if (existing) return existing;
  const parser = new mod.Parser();
  parser.setLanguage(language);
  parsers.set(lang, parser);
  loaded.set(lang, language);
  return parser;
}

/** Synchronous access to an already-loaded parser (see warmParsers). */
export function getLoadedParser(lang: LanguageId): TreeSitterParser | null {
  return parsers.get(lang) ?? null;
}

const queries = new Map<string, TSQuery>();
/** A compiled query for an already-loaded language, cached by language and source. */
export function getQuery(lang: LanguageId, source: string): TSQuery {
  const key = `${GRAMMAR_FILE[lang]}\0${source}`;
  let query = queries.get(key);
  if (!query) {
    const language = loaded.get(lang);
    if (!language || !runtimeModule) throw new Error(`parser for ${lang} is not loaded`);
    query = new runtimeModule.Query(language, source);
    queries.set(key, query);
  }
  return query;
}

/** Test hook: load grammars from another directory (null restores the package directory). */
export function __setGrammarDirForTests(dir: string | null): void {
  grammarDirOverride = dir;
  parsers.clear();
  loaded.clear();
  queries.clear();
}
