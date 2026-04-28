import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import type { ESLintConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface ESLintResultMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

interface ESLintResultFile {
  filePath: string;
  messages: ESLintResultMessage[];
}

export interface ESLintFinding {
  id: string;
  ruleId: string;
  file: string;
  line: number;
  column: number;
  code: string;
  type: string;
  message: string;
  category: string;
  severity: Severity;
}

/**
 * Run ESLint on selected files and return normalized findings.
 * Uses programmatic ESLint API for better performance and integration.
 */
export async function runESLint(filePaths: string[], config: ESLintConfig): Promise<ESLintFinding[]> {
  if (!config.enabled || filePaths.length === 0) return [];

  try {
    // Dynamic import to avoid ESLint being a required dependency
    const eslintModule = await import('eslint');

    // ESLint 9+ uses different import structure
    const ESLintClass = (eslintModule as any).ESLint || (eslintModule as any).default;

    if (!ESLintClass || typeof ESLintClass !== 'function') {
      console.warn('[athena-core] ESLint module structure not supported; skipping ESLint scan');
      return [];
    }

    // Load security plugin
    // @ts-ignore - eslint-plugin-security doesn't have type definitions
    const securityPlugin = await import('eslint-plugin-security');
    const originalPaths = filePaths.map((filePath) => resolve(process.cwd(), filePath));
    const parserResult = await loadTypeScriptParser(config.timeoutMs);
    const scanInputs = await prepareEslintInputs(originalPaths, parserResult.module);

    if (scanInputs.targets.length === 0) {
      return [];
    }

    const eslintConfig: any[] = [
      {
        files: ['**/*.{js,jsx,mjs,cjs}'],
        plugins: {
          security: securityPlugin.default,
        },
        rules: getSecurityRules(config.rules),
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          globals: {
            process: 'readonly',
            Buffer: 'readonly',
            __dirname: 'readonly',
            __filename: 'readonly',
            window: 'readonly',
            document: 'readonly',
            console: 'readonly',
          },
          parserOptions: {
            ecmaFeatures: {
              jsx: true,
            },
          },
        },
      },
    ];

    if (parserResult.module) {
      eslintConfig.push({
        files: ['**/*.{ts,tsx,mts,cts}'],
        plugins: {
          security: securityPlugin.default,
        },
        rules: getSecurityRules(config.rules),
        languageOptions: {
          parser: parserResult.module,
          ecmaVersion: 'latest',
          sourceType: 'module',
          globals: {
            process: 'readonly',
            Buffer: 'readonly',
            __dirname: 'readonly',
            __filename: 'readonly',
            window: 'readonly',
            document: 'readonly',
            console: 'readonly',
          },
          parserOptions: {
            ecmaFeatures: {
              jsx: true,
            },
          },
        },
      });
    }

    const eslint = new ESLintClass({
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: eslintConfig,
      ignore: false,
    });

    try {
      const results = await eslint.lintFiles(scanInputs.targets);
      return results.flatMap((result: ESLintResultFile) =>
        result.messages
          .filter((msg: ESLintResultMessage) => msg.ruleId !== null)
          .map((msg: ESLintResultMessage) =>
            normalizeESLintFinding(
              scanInputs.pathMap.get(resolve(result.filePath)) ?? result.filePath,
              msg,
            ))
      );
    } finally {
      await scanInputs.cleanup();
      await parserResult.cleanup();
    }
  } catch (error) {
    const withMessage = error as { message?: string; code?: string };

    if (withMessage?.code === 'MODULE_NOT_FOUND') {
      console.warn('[athena-core] ESLint not installed; skipping ESLint scan. Install with: npm install --save-dev eslint eslint-plugin-security');
      return [];
    }

    const detail = withMessage?.message || String(error);
    console.warn(`[athena-core] ESLint execution failed: ${detail}`);
    return [];
  }
}

type EslintScanInputs = {
  cleanup: () => Promise<void>;
  pathMap: Map<string, string>;
  targets: string[];
};

type ParserLoadResult = {
  cleanup: () => Promise<void>;
  module: unknown | null;
};

async function loadTypeScriptParser(timeoutMs: number): Promise<ParserLoadResult> {
  try {
    const parserSpecifier = '@typescript-eslint/parser';
    const parserModule = await import(parserSpecifier);
    return {
      cleanup: async () => undefined,
      module: (parserModule as { default?: unknown }).default ?? parserModule,
    };
  } catch {
    return installTypeScriptParserInTempDir(timeoutMs);
  }
}

async function installTypeScriptParserInTempDir(timeoutMs: number): Promise<ParserLoadResult> {
  const tempDir = await mkdtemp(join(process.cwd(), '.athena-eslint-parser-'));

  try {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({
      name: 'athena-eslint-parser-temp',
      private: true,
      type: 'module',
    }), 'utf8');

    const installTimeoutMs = Math.min(20_000, Math.max(3_000, Math.floor(timeoutMs / 2)));
    await execFileAsync('npm', ['install', '--no-save', '--no-package-lock', '@typescript-eslint/parser'], {
      cwd: tempDir,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
      timeout: installTimeoutMs,
    });

    const tempRequire = createRequire(join(tempDir, 'package.json'));
    const resolved = tempRequire.resolve('@typescript-eslint/parser');
    const parserModule = await import(pathToFileURL(resolved).href);

    return {
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      },
      module: (parserModule as { default?: unknown }).default ?? parserModule,
    };
  } catch (error) {
    const withMessage = error as { message?: string; stderr?: string };
    const detail = withMessage.stderr?.trim() || withMessage.message || String(error);
    console.warn(`[athena-core] Temp TypeScript parser install failed; using transpile fallback. ${detail}`);
    await rm(tempDir, { recursive: true, force: true });
    return {
      cleanup: async () => undefined,
      module: null,
    };
  }
}

async function prepareEslintInputs(filePaths: string[], parserModule: unknown | null): Promise<EslintScanInputs> {
  const jsTargets = filePaths.filter((filePath) => /\.(?:[cm]?js|jsx)$/i.test(filePath));
  const tsTargets = filePaths.filter((filePath) => /\.(?:[cm]?ts|tsx)$/i.test(filePath));
  const pathMap = new Map<string, string>();

  for (const filePath of jsTargets) {
    pathMap.set(resolve(filePath), resolve(filePath));
  }

  if (tsTargets.length === 0) {
    return {
      cleanup: async () => undefined,
      pathMap,
      targets: jsTargets,
    };
  }

  if (parserModule) {
    for (const filePath of tsTargets) {
      pathMap.set(resolve(filePath), resolve(filePath));
    }

    return {
      cleanup: async () => undefined,
      pathMap,
      targets: [...jsTargets, ...tsTargets],
    };
  }

  const tempDir = await mkdtemp(join(process.cwd(), '.athena-eslint-'));
  const shadowTargets: string[] = [];

  for (const filePath of tsTargets) {
    const source = await readFile(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: filePath.endsWith('.tsx') ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
      },
      fileName: basename(filePath),
      reportDiagnostics: false,
    });

    const ext = filePath.endsWith('.tsx') ? '.jsx' : '.js';
    const shadowPath = join(tempDir, `${createHash('sha1').update(filePath).digest('hex').slice(0, 12)}${ext}`);
    await writeFile(shadowPath, transpiled.outputText, 'utf8');
    shadowTargets.push(shadowPath);
    pathMap.set(resolve(shadowPath), resolve(filePath));
  }

  return {
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
    pathMap,
    targets: [...jsTargets, ...shadowTargets],
  };
}

function getSecurityRules(customRules?: string[]): Record<string, any> {
  const defaultSecurityRules: Record<string, any> = {
    // Security rules from eslint-plugin-security
    'security/detect-unsafe-regex': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-object-injection': 'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-no-csrf-before-method-override': 'warn',
    'security/detect-buffer-noassert': 'warn',
    'security/detect-child-process': 'warn',
    'security/detect-disable-mustache-escape': 'warn',
    'security/detect-new-buffer': 'warn',
    'security/detect-pseudoRandomBytes': 'warn',
  };

  if (!customRules || customRules.length === 0) {
    return defaultSecurityRules;
  }

  // If custom rules are provided, use only those
  const customRulesMap: Record<string, any> = {};
  for (const rule of customRules) {
    if (rule in defaultSecurityRules) {
      customRulesMap[rule] = defaultSecurityRules[rule];
    }
  }

  return customRulesMap;
}

function normalizeESLintFinding(filePath: string, message: ESLintResultMessage): ESLintFinding {
  const ruleId = message.ruleId || 'eslint.unknown-rule';
  const severity = mapESLintSeverity(message.severity);

  return {
    id: createHash('sha1').update(`eslint:${filePath}:${message.line}:${message.column}:${ruleId}`).digest('hex').slice(0, 10),
    ruleId,
    file: filePath,
    line: message.line,
    column: message.column,
    code: '', // ESLint doesn't provide code context in basic results
    type: formatESLintType(ruleId),
    message: message.message,
    category: getESLintCategory(ruleId),
    severity,
  };
}

function mapESLintSeverity(severity: number): Severity {
  // ESLint severity: 0 = off, 1 = warn, 2 = error
  if (severity === 2) return 'HIGH';
  if (severity === 1) return 'MEDIUM';
  return 'LOW';
}

function formatESLintType(ruleId: string): string {
  const last = ruleId.split('/').slice(-1)[0] || ruleId;
  return `ESLint ${last.replace(/[-_]/g, ' ')}`;
}

function getESLintCategory(ruleId: string): string {
  if (ruleId.startsWith('security/')) {
    return 'code-security';
  }
  if (ruleId.includes('regex')) {
    return 'regex-security';
  }
  if (ruleId.includes('eval') || ruleId.includes('buffer')) {
    return 'unsafe-code-execution';
  }
  return 'code-quality';
}
