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
  const match = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(firstLine);
  if (!match) return null;
  const program = match[1]!.split('/').pop()!;
  const interpreter = program === 'env' ? match[2] : program;
  return interpreter ? SHEBANG_INTERPRETERS[interpreter] ?? null : null;
}

/** Cheap, extension-only check (no file read). Extensionless shebang scripts need detectLanguage. */
export function isSupportedSource(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return ext !== null && ext in EXTENSIONS;
}

export function hasExtension(filePath: string): boolean {
  return extensionOf(filePath) !== null;
}
