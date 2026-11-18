export interface RuleInfo {
  id: string;
  title: string;
  why: string;
  fix: string;
  references: string[];
}

const CWE_798 = 'https://cwe.mitre.org/data/definitions/798.html';
const secretWhy = 'Credentials committed to source control are readable by anyone with repository access and stay in git history after deletion.';
const secretFix = 'Revoke and rotate the credential, remove it from the code, and load it from an environment variable or a secrets manager.';

function secretRule(id: string, title: string, why = secretWhy): RuleInfo {
  return { id, title, why, fix: secretFix, references: [CWE_798] };
}

const rules: RuleInfo[] = [
  secretRule('secret.aws-access-key', 'AWS access key'),
  secretRule('secret.github-token', 'GitHub token'),
  secretRule('secret.jwt', 'JWT token', 'A committed JWT can be replayed until it expires, and may reveal user data in its payload.'),
  secretRule('secret.private-key', 'Private key', 'A committed private key lets anyone impersonate the owner or decrypt their traffic.'),
  secretRule('secret.high-entropy-string', 'Possible high-entropy secret', 'Long random-looking strings are often API keys or signing secrets. This check can be wrong for hashes and identifiers.'),
  secretRule('secret.hardcoded-password', 'Hardcoded password'),
  secretRule('secret.hardcoded-api-key', 'Hardcoded API key'),
  secretRule('secret.hardcoded-token', 'Hardcoded token'),
  secretRule('secret.hardcoded-secret', 'Hardcoded secret'),
  secretRule('secret.sequelize-connection-metadata', 'Hardcoded database connection metadata', 'Database names and users in code help attackers target the database and often sit next to its password.'),
  {
    id: 'hallucination.invalid-api-call',
    title: 'Call to an API that does not exist',
    why: 'AI assistants sometimes invent functions. The call fails at runtime, or an attacker can publish a package with the invented name.',
    fix: 'Check the library documentation for the real function name, or remove the call. Verify any package you do not recognise before installing it.',
    references: ['https://cwe.mitre.org/data/definitions/1104.html', 'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/'],
  },
];

const byId = new Map(rules.map((rule) => [rule.id, rule]));

/** Explanatory copy for rules Athena emits itself; null for external scanners' rules. */
export function getRuleInfo(ruleId: string): RuleInfo | null {
  return byId.get(ruleId) ?? null;
}
