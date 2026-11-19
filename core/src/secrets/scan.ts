import type { RawFinding } from '../rules/types.js';
import { isConfigTextFile } from '../util/text-files.js';
import { GENERIC_KEYWORD, isPlaceholder, PROVIDER_DETECTORS } from './detectors.js';
import { looksLikeRandomSecret } from './generic-score.js';

const REDACTED = '[REDACTED]';
const WINDOW = 4000;
const OVERLAP = 300;

function hardcodedRule(keyword: string): { id: string; label: string } {
  const k = keyword.toLowerCase();
  if (k.includes('pass') || k === 'pwd') return { id: 'secret.hardcoded-password', label: 'Hardcoded password' };
  if (k.includes('api') && k.includes('key')) return { id: 'secret.hardcoded-api-key', label: 'Hardcoded API key' };
  if (k.includes('token')) return { id: 'secret.hardcoded-token', label: 'Hardcoded token' };
  return { id: 'secret.hardcoded-secret', label: 'Hardcoded secret' };
}

const SEQUELIZE = /new\s+Sequelize\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*,\s*(['"`])([^'"`\r\n]+)\3\s*,\s*(['"`])([^'"`\r\n]+)\5/g;

/** Where secrets are expected to be placeholders (templates and examples). */
export function isTemplatePath(path: string): boolean {
  return /\.(?:example|sample|template|dist|tpl)$|(?:^|[\\/])\.env\.(?:example|sample|template|dist)$/i.test(path);
}

/** A sentence of ordinary words ("Credentials committed to source control...") is a message, not a credential. */
function looksLikeProse(value: string): boolean {
  const words = value.trim().split(/\s+/);
  return words.length >= 3 && words.filter((w) => /^[A-Za-z][a-z'-]*[.,;:!?]?$/.test(w)).length / words.length >= 0.6;
}

interface Hit {
  ruleId: string;
  label: string;
  start: number;
  end: number;
  note?: string;
}

/** Every secret span on one (window of a) line, from all detectors. */
function hitsOnLine(line: string, context: string, configFile: boolean, offset: number): Hit[] {
  const hits: Hit[] = [];
  const add = (ruleId: string, label: string, start: number, end: number, note?: string) => hits.push({ ruleId, label, start: start + offset, end: end + offset, ...(note ? { note } : {}) });
  const covered = (start: number, end: number) => hits.some((h) => h.start <= start + offset && h.end >= end + offset);

  for (const det of PROVIDER_DETECTORS) {
    if (det.keyword && !det.keyword.test(context)) continue;
    det.regex.lastIndex = 0;
    for (const m of line.matchAll(det.regex)) {
      const secret = (det.group ? m[det.group] : m[0]) ?? m[0];
      if (!secret || isPlaceholder(secret)) continue;
      if (det.keyword && !det.group && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(secret) && /^[A-Za-z0-9/+=_-]+$/.test(secret) && looksLikeRandomSecret(secret, true).secret === false) continue;
      const start = (m.index ?? 0) + (det.group ? m[0].indexOf(secret) : 0);
      // Key blocks and service-account JSON: everything after the marker on this line is key material.
      const end = /PRIVATE KEY/.test(det.id + det.label) || det.id === 'secret.private-key' || det.id === 'secret.gcp-service-account' ? line.length : start + secret.length;
      add(det.id, det.label, start, end);
    }
  }

  GENERIC_KEYWORD.lastIndex = 0;
  for (const m of line.matchAll(GENERIC_KEYWORD)) {
    const keyword = m[1]!;
    const quotedValue = m[3];
    const value = quotedValue ?? m[4]!;
    const quoted = quotedValue !== undefined;
    if (isPlaceholder(value) || looksLikeProse(value)) continue;
    // In code, only string literals count: `password = db.Column(...)` or `x.password = content[...]` are references.
    if (!quoted && !configFile) continue;
    if (!quoted && configFile && /^[A-Za-z_$][\w$.]*\(/.test(value)) continue;
    const base = m.index! + m[0].lastIndexOf(value);
    if (covered(base, base + value.length)) continue;
    const { id, label } = hardcodedRule(keyword);
    add(id, label, base, base + value.length);
  }

  for (const m of line.matchAll(/['"`]([A-Za-z0-9+/=_-]{24,120})['"`]/g)) {
    const value = m[1]!;
    const start = m.index! + 1;
    if (isPlaceholder(value) || covered(start, start + value.length)) continue;
    if (looksLikeRandomSecret(value).secret) add('secret.high-entropy-string', 'Possible high-entropy secret', start, start + value.length, 'looks random');
  }

  SEQUELIZE.lastIndex = 0;
  for (const m of line.matchAll(SEQUELIZE)) {
    const password = m[6]!;
    const start = m.index! + m[0].lastIndexOf(password);
    add('secret.sequelize-constructor-credentials', 'Hardcoded database credentials', start, start + password.length);
  }
  return hits;
}

function mergeSpans(hits: Hit[]): Array<[number, number]> {
  const spans = hits.map((h) => [h.start, h.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

function redactSpans(line: string, spans: Array<[number, number]>): string {
  let out = '';
  let pos = 0;
  for (const [a, b] of spans) {
    out += line.slice(pos, a) + REDACTED;
    pos = b;
  }
  return out + line.slice(pos);
}

/** Scan any text: source, `.env`, YAML, JSON, TOML, Dockerfiles, CI files. Never returns a secret in any field. */
export function scanTextForSecrets(path: string, text: string): RawFinding[] {
  if (text.length > 1_000_000 || isTemplatePath(path)) return [];
  const configFile = isConfigTextFile(path) || /\.(?:env|ini|properties|conf|cfg|toml|ya?ml|json)$/i.test(path);
  const lines = text.split(/\r?\n/);
  const findings: RawFinding[] = [];

  lines.forEach((line, index) => {
    const previous = lines[index - 1] ?? '';
    const hits: Hit[] = [];
    if (line.length <= WINDOW) {
      hits.push(...hitsOnLine(line, `${previous}\n${line}`, configFile, 0));
    } else {
      // Minified or machine-written lines: scan overlapping windows instead of skipping the line.
      for (let start = 0; start < line.length; start += WINDOW - OVERLAP) {
        const chunk = line.slice(start, start + WINDOW);
        hits.push(...hitsOnLine(chunk, chunk, configFile, start));
        if (start + WINDOW >= line.length) break;
      }
    }
    if (hits.length === 0) return;
    const redacted = redactSpans(line, mergeSpans(hits)).trim();
    const code = redacted.length > 200 ? `${redacted.slice(0, 197)}...` : redacted;
    const seen = new Set<string>();
    for (const h of hits) {
      const key = `${h.ruleId}:${h.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ruleId: h.ruleId, line: index + 1, source: 'athena-secrets', confidence: 'high', code,
        message: `${h.label} found in ${path.split(/[\\/]/).pop()}${h.note ? ` (${h.note})` : ''}.`,
      });
    }
  });
  return findings;
}
