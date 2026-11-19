import { STRONG_SECRET_PATTERNS } from '../secrets/detectors.js';
import { isConfigTextFile } from '../util/text-files.js';
import type { ClassifiedFinding } from '../types.js';

const SECRET_PATTERN = /(['"][^'"]{4,}['"]|`[^`]{4,}`|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9._-]{10,})/g;
const STRONG_PATTERN = /(AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/g;
const UNQUOTED_ASSIGNMENT = /((?:password|passwd|pwd|api[_-]?key|token|secret|credentials?|private[_-]?key)[\w-]*\s*=\s*)(?=[^\s'"`()\[\]]*\d)[^\s'"`()\[\]]{12,}/gi;
const CREDENTIAL_ASSIGNMENT = /((?:password|passwd|pwd|api[_-]?key|token|secret|credentials?|private[_-]?key)[\w-]*['"]?\s*[:=]\s*)(['"`])[^'"`\r\n]{8,}\2/gi;

/** Same rule the backend and frontend use to decide a finding carries a secret. */
export function isSecretFinding(finding: Pick<ClassifiedFinding, 'source' | 'type' | 'message'>): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector' || finding.source === 'athena-secrets' || /secret|token|password|key|credential|jwt/.test(haystack);
}

export function redactSecrets(text: string): string {
  return redactKnownSecrets(text.replace(SECRET_PATTERN, '[REDACTED]'));
}

/**
 * One line of a code frame. A secret finding's own line is replaced by the finding's pre-redacted `code`,
 * so unquoted values (`KEY=value` in .env files) can never leak through pattern gaps.
 */
const CONFIG_ASSIGNMENT = /((?:password|passwd|pwd|api[_-]?key|token|secret|credentials?|private[_-]?key|access[_-]?key)[\w-]*['"]?\s*[:=]\s*)(?:(['"`])[^\n]*?\2|[^\s'"`#]+)/gi;

export function redactFrameLine(finding: Pick<ClassifiedFinding, 'source' | 'type' | 'message' | 'line' | 'code'> & { file?: string }, lineNumber: number, text: string): string {
  if (finding.source === 'athena-secrets' && lineNumber === finding.line) return finding.code;
  const base = isSecretFinding(finding) ? redactSecrets(text) : redactKnownSecrets(text);
  // In config files every `KEY=value` with a secret-looking key is treated as a secret, even on neighbouring lines.
  return finding.file && isConfigTextFile(finding.file) ? base.replace(CONFIG_ASSIGNMENT, '$1[REDACTED]') : base;
}

/**
 * Redacts only what is recognisably a secret: known token shapes and credential assignments.
 * Used for code frames of findings that are not secret findings, where blanking every string
 * would make the code unreadable but a neighbouring secret must still never be printed.
 */
export function redactKnownSecrets(text: string): string {
  let out = text.replace(CREDENTIAL_ASSIGNMENT, '$1[REDACTED]').replace(UNQUOTED_ASSIGNMENT, '$1[REDACTED]').replace(STRONG_PATTERN, '[REDACTED]');
  for (const pattern of STRONG_SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}
