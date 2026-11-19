/** Entry point used by .github/workflows/advisory-watch.yml: node --import tsx scripts/advisory-watch/run.ts <since-iso> */
import { deriveProposal } from './derive-rule.ts';
import { findNew } from './find-new.ts';
import { fetchFix } from './fix-diff.ts';
import { openPr } from './open-pr.ts';

const since = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString();
const ecosystems = ['npm', 'PyPI'];
const items = [];
const skipped = [];
for (const ecosystem of ecosystems) {
  const found = await findNew({ since, ecosystem });
  skipped.push(...found.skipped);
  for (const candidate of found.candidates) {
    try {
      const fix = await fetchFix(candidate.fix.owner, candidate.fix.repo, candidate.fix.sha, process.env.GH_TOKEN ? { token: process.env.GH_TOKEN } : {});
      const proposal = await deriveProposal(candidate, fix);
      if ('reason' in proposal) skipped.push({ id: candidate.id, reason: proposal.reason });
      else items.push({ candidate, proposal });
    } catch (error) {
      skipped.push({ id: candidate.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
}
console.log(`${items.length} proposals, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
const url = openPr(process.cwd(), items, skipped, new Date().toISOString().slice(0, 10));
if (url) console.log(url);
