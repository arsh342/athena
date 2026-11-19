import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Candidate, Skipped } from './find-new.ts';
import type { Proposal } from './derive-rule.ts';

/** Pull request body: what was added, where it came from, how the rule was derived and checked, what was skipped. */
export function prBody(items: Array<{ candidate: Candidate; proposal: Proposal }>, skipped: Array<Skipped | { id: string; reason: string }>): string {
  const lines = ['Automated proposal from the daily advisory watch. **A human must review every rule before merging.**', ''];
  for (const { candidate: c, proposal: p } of items) {
    lines.push(`### ${c.id} — ${c.pkg} (${c.severity})`, '',
      `- Advisory: https://github.com/advisories/${c.id}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''}`,
      `- Summary: ${c.summary}`,
      `- Source fix: https://github.com/${c.fix.owner}/${c.fix.repo}/commit/${c.fix.sha}`,
      `- Derived from \`${p.derivedFrom.file}:${p.derivedFrom.line}\`: \`${p.derivedFrom.code.slice(0, 120)}\``,
      '- How: the removed line of the fix was generalised into a call rule (same method as `athena variants`); the vulnerable file before the fix is the `vuln` fixture, the fixed file is the `safe` fixture; both pass `athena skills test`.',
      `- Skill folder: \`core/skills/${p.name}\``, '');
  }
  if (skipped.length > 0) {
    lines.push('### Skipped', '');
    for (const s of skipped.slice(0, 50)) lines.push(`- ${s.id}: ${s.reason}`);
  }
  return lines.join('\n');
}

/** Write each proposal under core/skills and open one PR with the GitHub CLI (needs GH_TOKEN). */
export function openPr(repoRoot: string, items: Array<{ candidate: Candidate; proposal: Proposal }>, skipped: Skipped[], date: string): string | null {
  if (items.length === 0) return null;
  const branch = `advisory-watch/${date}`;
  const run = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
  run(['checkout', '-b', branch]);
  for (const { proposal } of items) {
    for (const [path, text] of Object.entries(proposal.files)) {
      const target = join(repoRoot, 'core', 'skills', proposal.name, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, text);
    }
    run(['add', join('core', 'skills', proposal.name)]);
  }
  run(['commit', '-m', `feat(skills): advisory watch ${date} — ${items.length} proposed rule(s)`]);
  run(['push', '-u', 'origin', branch]);
  return execFileSync('gh', ['pr', 'create', '--title', `Advisory watch ${date}: ${items.length} proposed rule(s)`, '--body', prBody(items, skipped), '--label', 'advisory-watch'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}
