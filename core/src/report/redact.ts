import type { ClassifiedFinding } from '../types.js';

const SECRET_PATTERN = /(['"][^'"]{4,}['"]|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,})/g;

/** Same rule the backend and frontend use to decide a finding carries a secret. */
export function isSecretFinding(finding: Pick<ClassifiedFinding, 'source' | 'type' | 'message'>): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector' || /secret|token|password|key|credential|jwt/.test(haystack);
}

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}
