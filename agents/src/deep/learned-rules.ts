import { readFileSync } from 'node:fs';
import { deriveVariantRule, detectLanguage, loadProjectFiles, MAX_VARIANT_MATCHES, previewVariant, saveVariant, type ClassifiedFinding } from '@athena/core';

import { analyseFiles } from '../tools/index.js';

/**
 * Turn findings the panel confirmed into learned rules (`.athena/learned-rules.json`) that the offline engine applies from then on.
 * Only call-shaped findings generalise, a rule that matches too many places is dropped, and saving is idempotent by rule id.
 */
export async function learnRules(root: string, findings: ClassifiedFinding[]): Promise<string[]> {
  const added: string[] = [];
  const confirmed = findings.filter((f) => f.aiVerdict?.verdict === 'confirmed');
  if (confirmed.length === 0) return added;
  const files = await analyseFiles(root);
  for (const f of confirmed) {
    const lang = detectLanguage(f.file, '');
    if (!lang) continue;
    let source: string;
    try {
      source = readFileSync(f.file, 'utf8');
    } catch {
      continue;
    }
    const rule = await deriveVariantRule({ ruleId: f.ruleId, file: f.file, line: f.line, code: f.code, severity: f.severity, category: f.category, title: f.type }, source, lang);
    if (!rule) continue;
    const preview = await previewVariant(rule, files, root, { ruleId: f.ruleId, file: f.file, line: f.line, code: f.code });
    if (preview.tooBroad || preview.matches.length > MAX_VARIANT_MATCHES) continue;
    const before = added.length;
    try {
      // saveVariant is idempotent: an existing id is left alone, so only report rules that are new.
      const { existsSync, readFileSync: read } = await import('node:fs');
      const path = `${root}/.athena/learned-rules.json`;
      const exists = existsSync(path) && (JSON.parse(read(path, 'utf8')) as { rules?: Array<{ id: string }> }).rules?.some((r) => r.id === rule.id);
      saveVariant(root, rule);
      if (!exists) added.push(rule.id);
    } catch {
      continue;
    }
    void before;
  }
  return added;
}
