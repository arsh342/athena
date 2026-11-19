import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { deriveVariantRule, detectLanguage, getRuleInfo, MAX_VARIANT_MATCHES, previewVariant, saveVariant, type ClassifiedFinding, type ProjectFile } from '@athena/core';
import { findSourceFilesWithExclusions } from '../utils/file-filter.js';
import { loadLastScan } from '../utils/last-scan.js';
import { writeInfo, writeResult } from '../utils/output.js';

/** Turn one confirmed finding from the last scan into a rule, preview its cousins, and optionally save it. */
export async function variantsCommand(id: string, opts: { path?: string; save?: boolean; force?: boolean } = {}): Promise<number> {
  const fail = (message: string): number => {
    writeInfo(`error: ${message}`);
    return 2;
  };
  const given = resolve(process.cwd(), opts.path ?? '.');
  const root = (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
  if (id.length < 4) return fail('finding id must have at least 4 characters');
  const report = await loadLastScan(root);
  if (!report) return fail(`no saved scan for ${root}; run athena scan first`);
  const found: ClassifiedFinding[] = report.files.flatMap((f) => f.findings).filter((f) => f.id.startsWith(id));
  if (found.length === 0) return fail(`no finding matching ${id} in the last scan`);
  if (found.length > 1) return fail(`${id} is ambiguous`);
  const finding = found[0]!;
  const lang = detectLanguage(finding.file, '');
  if (!lang) return fail('unsupported language');

  const source = await readFile(finding.file, 'utf8');
  const rule = await deriveVariantRule({ ruleId: finding.ruleId, file: finding.file, line: finding.line, code: finding.code, severity: finding.severity, category: finding.category, title: finding.type }, source, lang);
  if (!rule) return fail('this finding is not a call to a function, so it cannot be generalised into a rule');

  const { files } = await findSourceFilesWithExclusions(root, ['node_modules', 'dist', 'build']);
  const project: ProjectFile[] = [];
  for (const path of files) {
    const l = detectLanguage(path, '');
    if (l) project.push({ path, source: await readFile(path, 'utf8').catch(() => ''), lang: l });
  }
  const preview = await previewVariant(rule, project, root, { ruleId: finding.ruleId, file: finding.file, line: finding.line, code: finding.code });

  const info = getRuleInfo(finding.ruleId);
  const out = [`Derived from ${finding.ruleId}${info ? ` (${info.title})` : ''} at ${relative(root, finding.file)}:${finding.line}`, `Rule: ${rule.id}  matches ${(rule.match as { callee: string }).callee} when argument ${((rule.match as { where?: Array<{ index?: number }> }).where?.[0]?.index ?? 0) + 1} is ${rule.why.includes('concatenated') ? 'concatenated or interpolated' : 'not a literal'}`, ''];
  out.push(`${preview.matches.length} similar call${preview.matches.length === 1 ? '' : 's'}:`);
  for (const m of preview.matches.slice(0, 15)) out.push(`  ${relative(root, m.file)}:${m.line}  ${m.code.slice(0, 80)}`);
  if (preview.matches.length > 15) out.push(`  … ${preview.matches.length - 15} more`);
  writeResult(out.join('\n'));

  if (preview.tooBroad && !opts.force) {
    writeInfo(`error: more than ${MAX_VARIANT_MATCHES} matches; the rule is probably too broad. Re-run with --force to save it anyway.`);
    return 2;
  }
  if (!opts.save) {
    writeInfo('preview only: add --save to keep this rule in .athena/learned-rules.json (every later scan then finds these for free)');
    return 0;
  }
  writeInfo(`saved to ${saveVariant(root, rule)}`);
  return 0;
}
