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
      ...(p.alsoAdvisories?.length ? [`- Same rule also covers: ${p.alsoAdvisories.join(', ')}`] : []),
      `- Fix advice in the rule: ${p.rule.fix}`,
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

export function prCreateArgs(title: string, body: string, withLabel: boolean): string[] {
  return ['pr', 'create', '--title', title, '--body', body, ...(withLabel ? ['--label', 'advisory-watch'] : [])];
}

/** One branch per run, so a re-run (or a second run the same day) never collides with an earlier branch. */
export function branchName(date: string, runId?: string): string {
  return `advisory-watch/${date}${runId ? `-${runId.replace(/[^\w.-]/g, '')}` : ''}`;
}

/** Write each proposal under core/skills and open one PR with the GitHub CLI (needs GH_TOKEN). */
export function openPr(repoRoot: string, items: Array<{ candidate: Candidate; proposal: Proposal }>, skipped: Skipped[], date: string): string | null {
  if (items.length === 0) return null;
  const branch = branchName(date, process.env.GITHUB_RUN_ID);
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
  const title = `Advisory watch ${date}: ${items.length} proposed rule(s)`;
  const body = prBody(items, skipped);
  const attempt = (withLabel: boolean): string => execFileSync('gh', prCreateArgs(title, body, withLabel), { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    try {
      return attempt(true);
    } catch (error) {
      // The label may not exist in the repository (creating labels needs more permission than opening a PR): retry without it.
      if (!/label/i.test(String((error as { stderr?: unknown }).stderr ?? error))) throw error;
      return attempt(false);
    }
  } catch (error) {
    console.log(`gh pr create failed: ${String((error as { stderr?: unknown }).stderr ?? error).trim().slice(0, 300)}`);
    // Opening a PR needs "Allow GitHub Actions to create pull requests" in the repository settings. The branch is pushed either way.
    const repo = process.env.GITHUB_REPOSITORY ?? '';
    console.log(`Branch ${branch} was pushed but the pull request could not be opened (check Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests").`);
    return repo ? `https://github.com/${repo}/compare/${branch}?expand=1` : branch;
  }
}
