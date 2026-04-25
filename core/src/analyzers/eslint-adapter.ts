import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ESLintConfig, Severity } from '../types.js';

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

    // Create flat config directly for ESLint v9
    const eslintConfig = [
      {
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
        },
      },
    ];

    const eslint = new ESLintClass({
      cwd: process.cwd(),
      overrideConfig: eslintConfig,
      ignore: false,
    });

    const results = await eslint.lintFiles(filePaths);
    return results.flatMap((result: ESLintResultFile) =>
      result.messages.map((msg: ESLintResultMessage) => normalizeESLintFinding(result.filePath, msg))
    );
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

async function createTempFlatConfig(customRules?: string[], baseDir?: string): Promise<{ tempConfigPath: string }> {
  const rules = getSecurityRules(customRules);

  // ESLint v9 flat config format (JavaScript file)
  const configContent = `
import security from 'eslint-plugin-security';

export default [
  {
    plugins: {
      security,
    },
    rules: ${JSON.stringify(rules, null, 2)},
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
    },
  },
];
`;

  // Create temp config in the project root directory
  const tempDir = baseDir || process.cwd();
  await mkdir(tempDir, { recursive: true });
  // Use unique filename to avoid conflicts
  const tempConfigPath = join(tempDir, `.athena-eslint-config-${Date.now()}.mjs`);
  await writeFile(tempConfigPath, configContent, 'utf-8');
  return { tempConfigPath };
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