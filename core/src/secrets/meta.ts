import { meta } from '../rules/common.js';
import type { RuleMeta } from '../rules/types.js';
import { PROVIDER_DETECTORS } from './detectors.js';

const WHY = 'Credentials committed to source control are readable by anyone with repository access and stay in git history after deletion.';
const FIX = 'Revoke and rotate the credential, remove it from the code (and from git history if the repository was shared), and load it from an environment variable or a secrets manager.';

export function secretRuleMeta(): RuleMeta[] {
  const rules = PROVIDER_DETECTORS.map((d) => meta(d.id, d.label, d.severity, [798], 'credential-exposure', 'secret', WHY, FIX, { confidence: 'high' }));
  const extra: Array<[string, string, string]> = [
    ['secret.high-entropy-string', 'Possible high-entropy secret', 'Long random-looking strings are often API keys or signing secrets. This check can be wrong for hashes and identifiers.'],
    ['secret.hardcoded-password', 'Hardcoded password', WHY],
    ['secret.hardcoded-api-key', 'Hardcoded API key', WHY],
    ['secret.hardcoded-token', 'Hardcoded token', WHY],
    ['secret.hardcoded-secret', 'Hardcoded secret', WHY],
    ['secret.sequelize-constructor-credentials', 'Hardcoded database credentials', WHY],
    ['secret.sequelize-connection-metadata', 'Hardcoded database connection metadata', 'Database names and users in code help attackers target the database and often sit next to its password.'],
  ];
  for (const [id, title, why] of extra) {
    rules.push(meta(id, title, 'HIGH', [798], 'credential-exposure', 'secret', why, FIX, { confidence: id === 'secret.high-entropy-string' ? 'medium' : 'high' }));
  }
  return rules;
}
