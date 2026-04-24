import type { Severity } from '../types';

interface SeverityBadgeProps {
  severity: Severity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return <span className={`severity-badge severity-${severity.toLowerCase()}`}>{severity}</span>;
}
