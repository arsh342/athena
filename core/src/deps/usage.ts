/** What a source file takes from which package. JS/TS, Python and Go, by lightweight scanning of import statements. */
export interface PackageUse {
  pkg: string;
  /** Named imports (`import { a }`, `from pkg import a`, `const { a } = require()`). */
  named: string[];
  /** Local names bound to the whole module or its default export (`import x`, `import * as x`, `const x = require()`, `import pkg`). */
  bindings: string[];
  line: number;
  /** Dynamic or unparseable import: callers must not draw "absent" conclusions. */
  opaque?: boolean;
}

export const NODE_BUILTINS = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'test', 'sea', 'sqlite']);

/** Python 3 standard-library top-level modules. */
export const PY_STDLIB = new Set(['__future__', 'abc', 'argparse', 'array', 'ast', 'asyncio', 'atexit', 'base64', 'binascii', 'bisect', 'builtins', 'bz2', 'calendar', 'cmath', 'cmd', 'codecs', 'collections', 'colorsys', 'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'csv', 'ctypes', 'dataclasses', 'datetime', 'decimal', 'difflib', 'dis', 'email', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'linecache', 'locale', 'logging', 'lzma', 'mailbox', 'marshal', 'math', 'mimetypes', 'mmap', 'multiprocessing', 'netrc', 'numbers', 'operator', 'optparse', 'os', 'pathlib', 'pdb', 'pickle', 'pkgutil', 'platform', 'plistlib', 'poplib', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib', 'resource', 'runpy', 'sched', 'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtplib', 'socket', 'socketserver', 'sqlite3', 'ssl', 'stat', 'statistics', 'string', 'struct', 'subprocess', 'sys', 'sysconfig', 'syslog', 'tarfile', 'tempfile', 'termios', 'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty', 'types', 'typing', 'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser', 'xml', 'xmlrpc', 'zipfile', 'zipimport', 'zlib', 'zoneinfo']);

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`; relative and absolute paths -> null; `node:` and builtins -> null. */
export function packageOfSpecifier(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || /^[a-z]+:/i.test(spec) || spec.startsWith('#') || spec.startsWith('~') || spec.startsWith('@/')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  if (!name || (spec.startsWith('@') && parts.length < 2)) return null;
  return name;
}

const lineAt = (text: string, index: number): number => {
  let n = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
};

function namesOf(list: string): string[] {
  return list.split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()).filter((x) => /^[\w$]+$/.test(x));
}

export function jsUses(source: string): PackageUse[] {
  const out: PackageUse[] = [];
  const add = (spec: string, index: number, named: string[], bindings: string[]) => {
    const pkg = packageOfSpecifier(spec);
    if (pkg) out.push({ pkg, named, bindings, line: lineAt(source, index) });
  };
  for (const m of source.matchAll(/\bimport\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) continue; // type-only imports do not run
    const clause = m[2]!.trim();
    const named: string[] = [];
    const bindings: string[] = [];
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) named.push(...namesOf(brace[1]!));
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    for (const part of rest.split(/\s+/)) {
      if (part === '*' || part === 'as' || !part) continue;
      if (/^[\w$]+$/.test(part)) bindings.push(part);
    }
    add(m[3]!, m.index!, named, bindings);
  }
  for (const m of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) add(m[1]!, m.index!, [], []);
  for (const m of source.matchAll(/(?:(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*)?(?:await\s+)?(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)(\.[\w$]+)?/g)) {
    const target = m[1];
    if (target?.startsWith('{')) add(m[2]!, m.index!, namesOf(target.slice(1, -1).replace(/:\s*[\w$]+/g, '')), []);
    else if (m[3]) add(m[2]!, m.index!, [m[3].slice(1)], []);
    else add(m[2]!, m.index!, [], target ? [target] : []);
  }
  return out;
}

export function pyUses(source: string): PackageUse[] {
  const out: PackageUse[] = [];
  for (const m of source.matchAll(/^[ \t]*from\s+([A-Za-z_][\w.]*)\s+import\s+(\([^)]*\)|[^\n#]+)/gm)) {
    const named = m[2]!.replace(/[()]/g, '').split(',').map((x) => x.trim().split(/\s+as\s+/)[0]!.trim()).filter((x) => /^\w+$/.test(x));
    out.push({ pkg: m[1]!.split('.')[0]!, named, bindings: [], line: lineAt(source, m.index!) });
  }
  for (const m of source.matchAll(/^[ \t]*import\s+([^\n#]+)/gm)) {
    for (const part of m[1]!.split(',')) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      if (mod && /^[A-Za-z_][\w.]*$/.test(mod)) out.push({ pkg: mod.split('.')[0]!, named: [], bindings: [alias ?? mod.split('.')[0]!], line: lineAt(source, m.index!) });
    }
  }
  return out;
}

export function goUses(source: string): PackageUse[] {
  const out: PackageUse[] = [];
  const block = /import\s*\(([\s\S]*?)\)/.exec(source);
  const specs = [...(block ? block[1]!.matchAll(/(?:(\w+|\.|_)\s+)?"([^"]+)"/g) : []), ...source.matchAll(/^import\s+(?:(\w+|\.|_)\s+)?"([^"]+)"/gm)];
  for (const m of specs) {
    const path = m[2]!;
    out.push({ pkg: path, named: [], bindings: [m[1] ?? path.split('/').pop()!.replace(/^v\d+$/, '')], line: lineAt(source, m.index ?? 0) });
  }
  return out;
}

export function usesOf(path: string, source: string): PackageUse[] {
  if (/\.py$/.test(path)) return pyUses(source);
  if (/\.go$/.test(path)) return goUses(source);
  return jsUses(source);
}
