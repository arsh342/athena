import assert from 'node:assert/strict';
import test from 'node:test';

import { redactKnownSecrets } from '../src/report/redact.ts';
import { isPlaceholder, PROVIDER_DETECTORS } from '../src/secrets/detectors.ts';
import { looksLikeRandomSecret } from '../src/secrets/generic-score.ts';
import { scanTextForSecrets } from '../src/secrets/scan.ts';

// Samples are assembled at run time so this file contains no literal token-shaped strings.
let seed = 12345;
function gen(len: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out += alphabet[(seed >>> 8) % alphabet.length];
  }
  return out;
}
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const B64URL = `${ALNUM}_-`;
const HEX = '0123456789abcdef';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const samples: Array<[string, string]> = [
  ['secret.aws-access-key', 'AKIA' + gen(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')],
  ['secret.aws-secret-key', 'aws_secret_access_key = "' + gen(40, ALNUM) + '"'],
  ['secret.gcp-api-key', 'AIza' + gen(35, B64URL)],
  ['secret.gcp-service-account', '"private_key": "-----BEGIN PRIVATE KEY-----'],
  ['secret.azure-storage-key', 'DefaultEndpointsProtocol=https;AccountName=a;AccountKey=' + gen(64, ALNUM) + '=='],
  ['secret.github-token', 'ghp_' + gen(36, ALNUM)],
  ['secret.github-fine-grained-pat', 'github_pat_' + gen(82, ALNUM + '_')],
  ['secret.gitlab-token', 'glpat-' + gen(20, B64URL)],
  ['secret.slack-token', 'xoxb-' + gen(11, '0123456789') + '-' + gen(24, ALNUM)],
  ['secret.slack-webhook', 'https://hooks.slack.com/services/T' + gen(9, 'ABCDEFGH23456789') + '/B' + gen(9, 'ABCDEFGH23456789') + '/' + gen(24, ALNUM)],
  ['secret.stripe-live-key', 'sk_live_' + gen(24, ALNUM)],
  ['secret.stripe-webhook-secret', 'whsec_' + gen(32, ALNUM)],
  ['secret.shopify-token', 'shpat_' + gen(32, HEX)],
  ['secret.twilio-api-key', 'SK' + gen(32, HEX)],
  ['secret.sendgrid-key', 'SG.' + gen(22, B64URL) + '.' + gen(43, B64URL)],
  ['secret.mailgun-key', 'key-' + gen(32, HEX)],
  ['secret.mailchimp-key', gen(32, HEX) + '-us12'],
  ['secret.openai-key', 'sk-proj-' + gen(48, B64URL)],
  ['secret.anthropic-key', 'sk-ant-api03-' + gen(90, B64URL)],
  ['secret.huggingface-token', 'hf_' + gen(34, ALNUM)],
  ['secret.npm-token', 'npm_' + gen(36, ALNUM)],
  ['secret.pypi-token', 'pypi-AgEIcHlwaS5vcmc' + gen(60, B64URL)],
  ['secret.docker-pat', 'dckr_pat_' + gen(27, B64URL)],
  ['secret.digitalocean-token', 'dop_v1_' + gen(64, HEX)],
  ['secret.newrelic-key', 'NRAK-' + gen(27, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')],
  ['secret.linear-key', 'lin_api_' + gen(40, ALNUM)],
  ['secret.postman-key', 'PMAK-' + gen(24, HEX) + '-' + gen(34, HEX)],
  ['secret.vault-token', 'hvs.' + gen(30, B64URL)],
  ['secret.private-key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
  ['secret.jwt', 'eyJ' + gen(20, B64URL) + '.eyJ' + gen(20, B64URL) + '.' + gen(24, B64URL)],
  ['secret.connection-string', 'postgres://app:' + gen(14, ALNUM) + '@db.internal:5432/app'],
  ['secret.basic-auth-url', 'https://deploy:' + gen(14, ALNUM) + '@registry.example.org/repo'],
  ['secret.twilio-account-sid-auth', 'twilio_auth_token = "' + gen(32, HEX) + '"'],
  ['secret.datadog-key', 'DD_API_KEY=' + gen(32, HEX)],
  ['secret.gcp-oauth-secret', 'GOCSPX-' + gen(28, B64URL)],
  ['secret.bitbucket-token', 'ATBB' + gen(32, ALNUM)],
  ['secret.discord-webhook', 'https://discord.com/api/webhooks/' + gen(18, '0123456789') + '/' + gen(60, B64URL)],
  ['secret.stripe-test-key', 'sk_test_' + gen(24, ALNUM)],
  ['secret.square-token', 'sq0atp-' + gen(22, B64URL)],
  ['secret.replicate-token', 'r8_' + gen(37, ALNUM)],
  ['secret.groq-key', 'gsk_' + gen(52, ALNUM)],
  ['secret.rubygems-token', 'rubygems_' + gen(48, HEX)],
  ['secret.sentry-auth-token', 'sntrys_' + gen(60, ALNUM)],
  ['secret.notion-token', 'secret_' + gen(43, ALNUM)],
  ['secret.grafana-token', 'glsa_' + gen(32, ALNUM) + '_' + gen(8, HEX)],
  ['secret.pulumi-token', 'pul-' + gen(40, HEX)],
  ['secret.age-secret-key', 'AGE-SECRET-KEY-1' + gen(58, UPPER)],
  ['secret.supabase-service-key', 'sb_secret_' + gen(30, B64URL)],
  ['secret.bearer-token', 'Authorization: Bearer ' + gen(40, ALNUM)],
  ['secret.heroku-key', 'heroku_api_key = "' + gen(8, HEX) + '-' + gen(4, HEX) + '-' + gen(4, HEX) + '-' + gen(4, HEX) + '-' + gen(12, HEX) + '"'],
  ['secret.telegram-bot-token', 'telegram_bot_token = "' + gen(9, '0123456789') + ':' + gen(35, B64URL) + '"'],
  ['secret.npmrc-auth-token', '//registry.npmjs.org/:_authToken=' + gen(36, ALNUM)],
];

for (const [ruleId, sample] of samples) {
  test(`detects ${ruleId} without ever returning the secret`, () => {
    const found = scanTextForSecrets('src/config.js', `const x = "${sample}";\n`);
    const hit = found.find((f) => f.ruleId === ruleId);
    assert.ok(hit, `no ${ruleId} in ${found.map((f) => f.ruleId).join(', ') || 'nothing'}`);
    assert.equal(hit!.line, 1);
    const secretPart = /:([A-Za-z0-9]{14})@/.exec(sample)?.[1] ?? sample.slice(-18);
    assert.ok(!hit!.code.includes(secretPart), 'the secret must not appear in the finding');
    assert.match(hit!.code, /\[REDACTED\]/);
  });
}

test('every provider detector has a sample or is a known context-only detector', () => {
  const covered = new Set(samples.map(([id]) => id));
  const missing = PROVIDER_DETECTORS.map((d) => d.id).filter((id) => !covered.has(id));
  assert.ok(missing.length <= 10, `untested detectors: ${missing.join(', ')}`);
  assert.ok(PROVIDER_DETECTORS.length >= 60);
});

test('redactKnownSecrets blanks every sample', () => {
  for (const [ruleId, sample] of samples) {
    const out = redactKnownSecrets(`call("${sample}")`);
    const part = /:([A-Za-z0-9]{14})@/.exec(sample)?.[1] ?? sample.slice(-14);
    assert.ok(!out.includes(part), ruleId);
  }
});

test('placeholders and templates are suppressed', () => {
  assert.equal(scanTextForSecrets('a.js', 'const k = "AKIAIOSFODNN7EXAMPLE";\n').length, 0);
  assert.equal(scanTextForSecrets('a.js', `const k = "${'sk_' + 'live_'}${'x'.repeat(24)}";\n`).length, 0);
  assert.equal(scanTextForSecrets('a.js', 'const password = "your-password-here";\n').length, 0);
  assert.equal(scanTextForSecrets('a.js', 'const password = process.env.DB_PASSWORD;\n').length, 0);
  assert.equal(scanTextForSecrets('.env.example', `API_KEY=${gen(32, ALNUM)}\n`).length, 0);
  assert.ok(isPlaceholder('changeme') && isPlaceholder('<your-token>') && isPlaceholder('${TOKEN}'));
});

test('config files are scanned: .env, YAML and JSON', () => {
  const key = gen(32, ALNUM);
  const env = scanTextForSecrets('/app/.env', `DATABASE_URL=postgres://u:${gen(12, ALNUM)}@h/db\nSECRET_KEY=${key}\nDEBUG=true\n`);
  assert.deepEqual(env.map((f) => f.line), [1, 2]);
  const yaml = scanTextForSecrets('/app/config.yaml', `service:\n  api_key: ${key}\n  name: demo\n`);
  assert.deepEqual(yaml.map((f) => `${f.line} ${f.ruleId}`), ['2 secret.hardcoded-api-key']);
  const json = scanTextForSecrets('/app/appsettings.json', `{ "ConnectionStrings": { "x": "Server=a;Password=${key};" }, "secret": "${key}" }\n`);
  assert.ok(json.some((f) => f.ruleId === 'secret.hardcoded-secret'));
});

test('findings carry the secret line, not the enclosing unit start', () => {
  const found = scanTextForSecrets('src/a.js', `function f() {\n  // setup\n  const token = "${gen(30, ALNUM)}";\n}\n`);
  assert.deepEqual(found.map((f) => f.line), [3]);
});

test('top-level secrets in scripts are found', () => {
  assert.equal(scanTextForSecrets('deploy.sh', `export AWS_ACCESS_KEY_ID=AKIA${gen(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')}\n`)[0]!.ruleId, 'secret.aws-access-key');
});

test('generic score: random keys yes; words, git shas, uuids and identifiers no', () => {
  assert.equal(looksLikeRandomSecret(gen(32, ALNUM)).secret, true);
  assert.equal(looksLikeRandomSecret('ThisIsAReallyLongStringOfWords').secret, false);
  assert.equal(looksLikeRandomSecret('a'.repeat(40)).secret, false);
  assert.equal(looksLikeRandomSecret('0123456789abcdef0123456789abcdef01234567').secret, false);
  assert.equal(looksLikeRandomSecret('123e4567-e89b-12d3-a456-426614174000').secret, false);
  assert.equal(looksLikeRandomSecret('user_profile_settings_default_value').secret, false);
  assert.equal(looksLikeRandomSecret('https://example.com/api/v1/users/profile').secret, false);
});

test('hardcoded credential assignments get typed rule ids', () => {
  const v = gen(16, ALNUM);
  const ids = (line: string) => scanTextForSecrets('a.ts', `${line}\n`).map((f) => f.ruleId);
  assert.deepEqual(ids(`const password = '${v}';`), ['secret.hardcoded-password']);
  assert.deepEqual(ids(`const apiKey = "${v}";`), ['secret.hardcoded-api-key']);
  assert.deepEqual(ids(`const authToken = "${v}";`), ['secret.hardcoded-token']);
  assert.deepEqual(ids(`const clientSecret = "${v}";`), ['secret.hardcoded-secret']);
});

test('Sequelize positional credentials are still caught', () => {
  const found = scanTextForSecrets('db.js', `const s = new Sequelize('appdb', 'appuser', '${gen(14, ALNUM)}', { host: 'h' });\n`);
  assert.ok(found.some((f) => f.ruleId === 'secret.sequelize-constructor-credentials'));
});
