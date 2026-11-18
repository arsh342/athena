import type { ClassifiedFinding } from '../types.js';

const SECRET_PATTERN = /(['"][^'"]{4,}['"]|`[^`]{4,}`|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9._-]{10,})/g;
const STRONG_PATTERN = /(AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/g;
const CREDENTIAL_ASSIGNMENT = /((?:password|api[_-]?key|token|secret)\s*[:=]\s*)(['"`])[^'"`\r\n]{8,}\2/gi;

/** Same rule the backend and frontend use to decide a finding carries a secret. */
export function isSecretFinding(finding: Pick<ClassifiedFinding, 'source' | 'type' | 'message'>): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector' || /secret|token|password|key|credential|jwt/.test(haystack);
}

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}

/**
 * Redacts only what is recognisably a secret: known token shapes and credential assignments.
 * Used for code frames of findings that are not secret findings, where blanking every string
 * would make the code unreadable but a neighbouring secret must still never be printed.
 */
export function redactKnownSecrets(text: string): string {
  return text.replace(CREDENTIAL_ASSIGNMENT, '$1[REDACTED]').replace(STRONG_PATTERN, '[REDACTED]');
}
