export type LanguageId =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'java'
  | 'csharp'
  | 'c'
  | 'cpp'
  | 'go'
  | 'rust'
  | 'php'
  | 'shell';

export type LanguageFamily = 'js' | 'python' | 'java' | 'csharp' | 'c' | 'go' | 'rust' | 'php' | 'shell';

export const LANGUAGE_FAMILY: Record<LanguageId, LanguageFamily> = {
  javascript: 'js',
  typescript: 'js',
  tsx: 'js',
  python: 'python',
  java: 'java',
  csharp: 'csharp',
  c: 'c',
  cpp: 'c',
  go: 'go',
  rust: 'rust',
  php: 'php',
  shell: 'shell',
};

const EXTENSIONS: Record<string, LanguageId> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx', jsx: 'tsx',
  py: 'python', pyi: 'python',
  java: 'java',
  cs: 'csharp',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  go: 'go',
  rs: 'rust',
  php: 'php', phtml: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
};

const SHEBANG_INTERPRETERS: Record<string, LanguageId> = {
  sh: 'shell', bash: 'shell', zsh: 'shell',
  python: 'python', python3: 'python',
  node: 'javascript',
};

function extensionOf(filePath: string): string | null {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return base.slice(dot + 1).toLowerCase();
}

/** Language from the file extension, or for extensionless files from a `#!` first line. */
export function detectLanguage(filePath: string, firstLine?: string): LanguageId | null {
  const ext = extensionOf(filePath);
  if (ext !== null) return EXTENSIONS[ext] ?? null;
  return firstLine === undefined ? null : languageFromShebang(firstLine);
}

export function languageFromShebang(firstLine: string): LanguageId | null {
  const line = firstLine.replace(/^\uFEFF/, '').replace(/\r$/, '');
  const match = /^#!\s*(\S+)((?:\s+\S+)*)/.exec(line);
  if (!match) return null;
  const program = match[1]!.split('/').pop()!;
  let interpreter: string | undefined = program;
  if (program === 'env') {
    // `env [-S|-i|--flag] [NAME=value ...] interpreter [args]`: the first word that is neither a flag nor an assignment.
    interpreter = match[2]!.trim().split(/\s+/).find((w) => w && !w.startsWith('-') && !w.includes('='));
  }
  if (!interpreter) return null;
  // python3.11 -> python3, node18 stays as is.
  const base = interpreter.replace(/^(python\d?)\.\d+$/, '$1');
  return SHEBANG_INTERPRETERS[base] ?? null;
}

/** Cheap, extension-only check (no file read). Extensionless shebang scripts need detectLanguage. */
export function isSupportedSource(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return ext !== null && ext in EXTENSIONS;
}

/** Supported extension, or an extensionless file whose first line is a known shebang (reads at most 256 bytes). */
export async function isSourceCandidate(filePath: string): Promise<boolean> {
  if (isSupportedSource(filePath)) return true;
  if (hasExtension(filePath)) return false;
  const { open, stat } = await import('node:fs/promises');
  if (!(await stat(filePath).catch(() => null))?.isFile()) return false;
  const handle = await open(filePath, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return languageFromShebang(buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0] ?? '') !== null;
  } finally {
    await handle.close();
  }
}

export function hasExtension(filePath: string): boolean {
  return extensionOf(filePath) !== null;
}
