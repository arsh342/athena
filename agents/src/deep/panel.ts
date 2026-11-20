import { tally, type Vote } from './tally.js';
import { verifyCandidates, type AiVerdict, type VerifyInput, type VerifyResult } from '../verify.js';

/** Three voters that each start from a different lens. They never see each other's answers; the prefix they read is identical (cached once). */
export const VOTERS = [
  { id: 'reachability-first', framing: 'Voter focus (reachability-first): begin with REACHABILITY. Trace exactly how an attacker-controlled value arrives; if it cannot, refute.' },
  { id: 'defenses-first', framing: 'Voter focus (defenses-first): begin with DEFENSES. Look for any validation, sanitising, authorisation or framework default on the path; if one holds on every path, refute.' },
  { id: 'impact-first', framing: 'Voter focus (impact-first): begin with IMPACT. Decide what an attacker would gain; if nothing of value or privilege is at stake, say so, then check the other lenses.' },
] as const;

/** Independent verification by three voters, tallied 2-of-3 in code. Fewer than two usable votes means "not checked". */
export async function runPanel(input: Omit<VerifyInput, 'voter'>): Promise<VerifyResult> {
  const results: VerifyResult[] = [];
  for (const voter of VOTERS) results.push(await verifyCandidates({ ...input, voter: { id: voter.id, framing: voter.framing } }));

  const verdicts = new Map<string, AiVerdict>();
  const notChecked: VerifyResult['notChecked'] = [];
  for (const c of input.candidates) {
    const cast = VOTERS.flatMap((voter, i) => {
      const v = results[i]!.verdicts.get(c.id);
      return v ? [{ voter: voter.id, v }] : [];
    });
    if (cast.length < 2) {
      const why = results.flatMap((r) => r.notChecked.filter((n) => n.id === c.id).map((n) => n.reason))[0];
      notChecked.push({ id: c.id, reason: `the panel did not reach a quorum (${cast.length} of 3 usable votes${why ? `: ${why}` : ''})` });
      continue;
    }
    const decision: Vote = tally(cast.map((x) => x.v.verdict));
    const lead = cast.find((x) => x.v.verdict === decision) ?? cast[0]!;
    verdicts.set(c.id, {
      ...lead.v,
      verdict: decision,
      reason: `panel ${cast.filter((x) => x.v.verdict === decision).length}-${cast.length}: ${lead.v.reason}`,
      cached: cast.every((x) => x.v.cached),
      votes: cast.map((x) => ({ voter: x.voter, verdict: x.v.verdict })),
    });
  }
  const sum = (pick: (u: VerifyResult['usage']) => number) => results.reduce((n, r) => n + pick(r.usage), 0);
  return {
    verdicts, notChecked,
    usage: { inputTokens: sum((u) => u.inputTokens), outputTokens: sum((u) => u.outputTokens), cacheReadTokens: sum((u) => u.cacheReadTokens ?? 0), cacheWriteTokens: sum((u) => u.cacheWriteTokens ?? 0) },
    requests: results.reduce((n, r) => n + r.requests, 0),
    cachedHits: results.reduce((n, r) => n + r.cachedHits, 0),
  };
}
