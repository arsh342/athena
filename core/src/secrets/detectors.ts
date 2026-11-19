import type { Severity } from '../types.js';

export interface SecretDetector {
  id: string;
  label: string;
  /** Global regex; if `group` is set, that capture group is the secret itself. */
  regex: RegExp;
  group?: number;
  severity: Severity;
  /** The detector only counts when this keyword appears within the same line or the line before (composite rule). */
  keyword?: RegExp;
}

const hex = (n: number) => `[a-f0-9]{${n}}`;
const b64url = (n: number | string) => `[A-Za-z0-9_-]{${n}}`;

function d(id: string, label: string, regex: RegExp, severity: Severity = 'HIGH', extra: Partial<SecretDetector> = {}): SecretDetector {
  return { id, label, regex, severity, ...extra };
}

/**
 * Provider-specific detectors. Formats are the publicly documented token shapes; detectors with `keyword`
 * need a related word nearby (Gitleaks-style composite rules) because the shape alone is too generic.
 * No live verification: a candidate is never sent to its provider.
 */
export const PROVIDER_DETECTORS: SecretDetector[] = [
  d('secret.aws-access-key', 'AWS access key ID', /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, 'CRITICAL'),
  d('secret.aws-secret-key', 'AWS secret access key', /\b[A-Za-z0-9/+=]{40}\b/g, 'CRITICAL', { keyword: /aws.{0,30}(?:secret|sk)|secret.?access.?key/i }),
  d('secret.gcp-api-key', 'Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g),
  d('secret.gcp-service-account', 'Google service account private key', /"private_key"\s*:\s*"-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'CRITICAL'),
  d('secret.gcp-oauth-secret', 'Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g),
  d('secret.azure-storage-key', 'Azure storage account key', /AccountKey=[A-Za-z0-9+/=]{60,}/g, 'CRITICAL'),
  d('secret.azure-sas-token', 'Azure SAS token', /[?&]sig=[A-Za-z0-9%]{40,}(?:&|$)/g, 'HIGH', { keyword: /sv=\d{4}-\d{2}-\d{2}|blob\.core\.windows|sas/i }),
  d('secret.azure-ad-secret', 'Azure AD client secret', /\b[A-Za-z0-9_~.-]{3}8Q~[A-Za-z0-9_~.-]{34}\b/g),
  d('secret.github-token', 'GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, 'CRITICAL'),
  d('secret.github-fine-grained-pat', 'GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{70,}\b/g, 'CRITICAL'),
  d('secret.gitlab-token', 'GitLab token', /\bgl(?:pat|dt|ptt|rt|soat|imt|agent|cbt)-[A-Za-z0-9_-]{20,}\b/g, 'CRITICAL'),
  d('secret.bitbucket-token', 'Bitbucket app password', /\bATBB[A-Za-z0-9_=.-]{30,}\b/g),
  d('secret.slack-token', 'Slack token', /\bxox[abeoprs]-[0-9A-Za-z-]{10,72}\b/g),
  d('secret.slack-webhook', 'Slack webhook URL', /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9/]{20,}/g),
  d('secret.discord-webhook', 'Discord webhook URL', /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d{15,}\/[A-Za-z0-9_-]{50,}/g),
  d('secret.discord-bot-token', 'Discord bot token', /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/g),
  d('secret.telegram-bot-token', 'Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, 'HIGH', { keyword: /telegram|bot_?token|tg_/i }),
  d('secret.stripe-live-key', 'Stripe live secret key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g, 'CRITICAL'),
  d('secret.stripe-test-key', 'Stripe test secret key', /\b(?:sk|rk)_test_[0-9A-Za-z]{20,}\b/g, 'LOW'),
  d('secret.stripe-webhook-secret', 'Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{32,}\b/g),
  d('secret.square-token', 'Square access token', /\b(?:sq0atp-[0-9A-Za-z_-]{22}|sq0csp-[0-9A-Za-z_-]{43}|EAAA[A-Za-z0-9_-]{60})\b/g),
  d('secret.paypal-braintree', 'Braintree access token', /\baccess_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}\b/g, 'CRITICAL'),
  d('secret.shopify-token', 'Shopify token', /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g),
  d('secret.twilio-api-key', 'Twilio API key', /\bSK[0-9a-fA-F]{32}\b/g),
  d('secret.twilio-account-sid-auth', 'Twilio auth token', /\b[0-9a-f]{32}\b/g, 'HIGH', { keyword: /twilio.{0,30}(?:auth|token)|auth_?token.{0,20}twilio/i }),
  d('secret.sendgrid-key', 'SendGrid API key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g),
  d('secret.mailgun-key', 'Mailgun API key', /\bkey-[0-9a-f]{32}\b/g),
  d('secret.mailchimp-key', 'Mailchimp API key', /\b[0-9a-f]{32}-us\d{1,2}\b/g),
  d('secret.postmark-token', 'Postmark server token', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, 'HIGH', { keyword: /postmark/i }),
  d('secret.openai-key', 'OpenAI API key', /\bsk-(?:proj-|svcacct-|admin-)[A-Za-z0-9_-]{40,}\b|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g, 'CRITICAL'),
  d('secret.anthropic-key', 'Anthropic API key', /\bsk-ant-[a-z0-9]{2,8}-[A-Za-z0-9_-]{60,}\b/g, 'CRITICAL'),
  d('secret.huggingface-token', 'Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/g),
  d('secret.replicate-token', 'Replicate API token', /\br8_[A-Za-z0-9]{37}\b/g),
  d('secret.groq-key', 'Groq API key', /\bgsk_[A-Za-z0-9]{52}\b/g),
  d('secret.npm-token', 'npm access token', /\bnpm_[A-Za-z0-9]{36}\b/g, 'CRITICAL'),
  d('secret.pypi-token', 'PyPI upload token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g, 'CRITICAL'),
  d('secret.rubygems-token', 'RubyGems API key', /\brubygems_[a-f0-9]{48}\b/g),
  d('secret.docker-pat', 'Docker Hub access token', /\bdckr_pat_[A-Za-z0-9_-]{27,}\b/g),
  d('secret.digitalocean-token', 'DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/g),
  d('secret.cloudflare-token', 'Cloudflare API token', /\b[A-Za-z0-9_-]{40}\b/g, 'HIGH', { keyword: /cloudflare|cf_api|CF_API_TOKEN/i }),
  d('secret.heroku-key', 'Heroku API key', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, 'HIGH', { keyword: /heroku/i }),
  d('secret.datadog-key', 'Datadog API key', /\b[a-f0-9]{32}\b/g, 'HIGH', { keyword: /datadog|DD_API_KEY|dd_app_key/i }),
  d('secret.newrelic-key', 'New Relic key', /\bNRAK-[A-Z0-9]{27}\b|\bNRJS-[a-f0-9]{19}\b/g),
  d('secret.sentry-dsn', 'Sentry DSN with secret key', /https:\/\/[a-f0-9]{32}@(?:o\d+\.)?(?:ingest\.)?sentry\.io\/\d+/g, 'MEDIUM'),
  d('secret.sentry-auth-token', 'Sentry auth token', /\bsntry[su]_[A-Za-z0-9+/=]{40,}\b/g),
  d('secret.linear-key', 'Linear API key', /\blin_api_[A-Za-z0-9]{40}\b/g),
  d('secret.notion-token', 'Notion integration token', /\b(?:secret_|ntn_)[A-Za-z0-9]{36,50}\b/g),
  d('secret.atlassian-token', 'Atlassian API token', /\bATATT3[A-Za-z0-9_=-]{100,}\b/g),
  d('secret.postman-key', 'Postman API key', /\bPMAK-[0-9a-f]{24}-[0-9a-f]{34}\b/g),
  d('secret.grafana-token', 'Grafana service account token', /\bglsa_[A-Za-z0-9]{32}_[a-f0-9]{8}\b/g),
  d('secret.terraform-token', 'Terraform Cloud token', /\b[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}\b/g),
  d('secret.vault-token', 'HashiCorp Vault token', /\bhv[sb]\.[A-Za-z0-9_-]{24,}\b/g, 'CRITICAL'),
  d('secret.okta-token', 'Okta API token', /\b00[A-Za-z0-9_-]{40}\b/g, 'HIGH', { keyword: /okta/i }),
  d('secret.pulumi-token', 'Pulumi access token', /\bpul-[a-f0-9]{40}\b/g),
  d('secret.age-secret-key', 'age secret key', /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/g, 'CRITICAL'),
  d('secret.private-key', 'Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, 'CRITICAL'),
  d('secret.jwt', 'JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g),
  d('secret.supabase-service-key', 'Supabase service-role key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g, 'CRITICAL'),
  d('secret.connection-string', 'Connection string with embedded password', /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver|cockroachdb|clickhouse):\/\/[^:\s/'"`@]+:([^@\s'"`]{3,})@[^\s'"`]+/g, 'HIGH', { group: 1 }),
  d('secret.basic-auth-url', 'URL with embedded credentials', /\bhttps?:\/\/[^:\s/@'"`]+:([^@\s/'"`]{3,})@[A-Za-z0-9.-]+/g, 'HIGH', { group: 1 }),
  d('secret.bearer-token', 'Hardcoded bearer token', /\b[Bb]earer\s+([A-Za-z0-9._~+/-]{24,}=*)/g, 'HIGH', { group: 1 }),
  d('secret.npmrc-auth-token', 'npm registry auth token', /_authToken\s*=\s*([^\s'"]{8,})/g, 'CRITICAL', { group: 1 }),
];

const placeholderWords = /(?:example|sample|dummy|placeholder|changeme|change[_-]?me|your[_-]|<[^>\n]{1,40}>|\$\{|\{\{|%\{|process\.env|os\.environ|getenv|env\(|redacted|\*{3,}|xxxx|todo|fake|lorem|insert[_-]|replace[_-]|my[_-]?(?:secret|key|token|password)|not[_-]?a[_-]?real)/i;

/** True for values that are clearly documentation placeholders or references rather than real credentials. */
export function isPlaceholder(value: string): boolean {
  if (placeholderWords.test(value)) return true;
  if (/^(.)\1{5,}$/.test(value)) return true; // repeated character
  const distinct = new Set(value).size;
  if (value.length >= 8 && distinct <= 3) return true;
  if (/^(?:abc|123|qwerty|password|secret|token|admin|test)[a-z0-9]{0,6}$/i.test(value)) return true;
  if (/^(?:postgres|root|admin|password|passwd|secret|test|user|guest|pass|mysql|redis|example|dev|demo|local|1234\d*)$/i.test(value)) return true; // stock development defaults
  return false;
}

/**
 * keyword [= or :] value. Groups: 1 keyword, 2 opening quote, 3 quoted value (may contain spaces), 4 bare value.
 * A bare value stops at whitespace or delimiters; a quoted value runs to the closing quote.
 */
export const GENERIC_KEYWORD = /(?:^|[^A-Za-z])(passw(?:or)?d|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key|token|credentials?)[A-Za-z0-9_-]*['"]?\s*(?:=|:|=>|:=)\s*(?:(['"`])((?:(?!\2)[^\n]){8,}?)\2|([^\s'"`,;)}\]]{8,}))/gi;

/** All provider shapes as one pattern (for redacting code frames of findings that are not secrets). */
export const STRONG_SECRET_PATTERNS: RegExp[] = PROVIDER_DETECTORS.filter((p) => !p.keyword).map((p) => new RegExp(p.regex.source, p.regex.flags));
void hex;
void b64url;
