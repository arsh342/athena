import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { isSecretFinding, loadSkills, selectSkillSection, recomputeGate, type AthenaConfig, type ChangeSet, type ClassifiedFinding, type ScanReport } from '@athena/core';

import { BudgetTracker } from './budget.js';
import { fileVerdictCache } from './cache.js';
import { consentNotice, needsConsent, recordConsent } from './consent.js';
import { buildContextPack } from './context-pack.js';
import { defaultModel, type Quality } from './models.js';
import { capsFor, priceFor, type CapsInput } from './pricing.js';
import { createProvider, type ProviderChoice } from './providers/index.js';
import type { ModelProvider } from './providers/types.js';
import type { ProviderId } from './types.js';
import { runHunt, type HuntResult } from './hunt.js';
import { learnRules } from './deep/learned-rules.js';
import { runPanel } from './deep/panel.js';
import { suggestPatches } from './deep/patches.js';
import { buildThreatModel, threatModelText } from './deep/threat-model.js';
import { analyseDirectory } from './tools/index.js';
import { verifyCandidates, type VerifyResult } from './verify.js';

const MAX_CANDIDATES = 20;
const DEEP_CATEGORIES = ['missing authorization and access control (IDOR)', 'injection and unsafe sinks reached from untrusted input', 'state, logic and race-condition flaws'] as const;
const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export interface Candidate { finding: ClassifiedFinding }

/** The offline engine settled `high` confidence findings; secrets and dependency findings are deterministic. What is left is what AI is for. */
export function selectCandidates(report: ScanReport, max = MAX_CANDIDATES): Candidate[] {
  const all = report.files.flatMap((f) => f.findings).filter((f) => (f.confidence === 'medium' || f.confidence === 'low')
    && !isSecretFinding(f) && f.source !== 'athena-secrets' && f.source !== 'athena-deps' && f.source !== 'secret-detector');
  all.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  return all.slice(0, max).map((finding) => ({ finding }));
}

export interface AiVerifyOptions {
  root: string;
  /** `verify` (default) settles uncertain findings; `hunt` first lets the AI explore the riskiest components, then verifies. */
  mode?: 'verify' | 'hunt' | 'deep';
  /** Deep mode only: the user set a spend cap on purpose (required), and agreed to the estimate. */
  budgetExplicit?: boolean;
  confirmDeep?: (estimate: string) => Promise<boolean>;
  suggestFixes?: boolean;
  /** Send the panel through the provider's batch API (cheaper, slower): for non-interactive runs. */
  useBatch?: boolean;
  config: Pick<AthenaConfig, 'blockOn' | 'updates'>;
  /** `athena review`: the change under review. The AI also says which flaws it did not introduce; those move to "existing issues". */
  changes?: ChangeSet;
  provider: ProviderId;
  preset?: string;
  baseUrl?: string;
  /** Declare tool support for an openai-compatible endpoint. */
  tools?: boolean;
  model?: string;
  quality?: Quality;
  budget?: CapsInput['budget'];
  pricing?: CapsInput['pricing'];
  maxCandidates?: number;
  home?: string;
  /** Where keys are looked up instead of the process environment (the hosted backend passes the user's own key here, in memory only). */
  env?: NodeJS.ProcessEnv;
  /** Shown the consent notice on the first AI run for a repository and provider; false declines. */
  confirm: (notice: string) => Promise<boolean>;
  /** Tests (and the offline fake): use this instead of building a real provider. */
  providerOverride?: ModelProvider;
  now?: () => Date;
}

function skipped(report: ScanReport, o: { mode: 'verify' | 'hunt' | 'deep'; provider: ProviderId; model: string; reason: string; ids: string[] }): void {
  report.summary.ai = { mode: o.mode, provider: o.provider, model: o.model, costUsd: 0, tokens: 0, requests: 0, cachedHits: 0, checked: 0, notChecked: o.ids.map((id) => ({ id, reason: o.reason })) };
}

/** Apply verdicts to the report: confirmed -> high confidence, refuted -> needs review with the reason; then redo the counts and the gate. */
export function applyVerdicts(report: ScanReport, result: VerifyResult, config: Pick<AthenaConfig, 'blockOn' | 'updates'>): void {
  for (const file of report.files) {
    for (const f of file.findings) {
      const v = result.verdicts.get(f.id);
      if (!v) continue;
      f.aiVerdict = { verdict: v.verdict, reason: v.reason, lenses: { reachability: v.reachability, defenses: v.defenses, impact: v.impact }, citations: v.citations, ...(v.predatesChange !== undefined ? { predatesChange: v.predatesChange } : {}), provider: v.provider, model: v.model, cached: v.cached, ...(v.votes ? { votes: v.votes } : {}) };
      if (v.verdict === 'confirmed') {
        f.confidence = 'high';
        f.evidence = [`AI confirmed (${v.model}): ${v.reason}`, ...(f.evidence ?? [])];
      } else if (v.verdict === 'refuted') {
        f.confidence = 'low';
        f.evidence = [`AI refuted (${v.model}): ${v.reason}`, ...(f.evidence ?? [])];
      } else {
        f.evidence = [`AI could not decide (${v.model}): ${v.reason}`, ...(f.evidence ?? [])];
      }
    }
  }
  recomputeGate(report, config);
}

/** Review: a confirmed flaw the AI says the change did not introduce is an existing issue, not part of this change's verdict. */
export function movePredating(report: ScanReport, config: Pick<AthenaConfig, 'blockOn' | 'updates'>): void {
  if (!report.review) return;
  for (const file of report.files) {
    const keep: ClassifiedFinding[] = [];
    for (const f of file.findings) {
      if (f.aiVerdict?.verdict === 'confirmed' && f.aiVerdict.predatesChange === true) report.review.existing.push(f);
      else keep.push(f);
    }
    file.findings = keep;
  }
  recomputeGate(report, config);
}

export async function runAiVerify(report: ScanReport, o: AiVerifyOptions): Promise<void> {
  const mode = o.mode ?? 'verify';
  if (mode === 'deep' && !o.budgetExplicit) throw new Error('deep mode needs an explicit spend cap: pass --budget (or --budget-tokens)');
  const model = o.model ?? defaultModel(o.provider, o.quality ?? 'balanced');
  if (!model) throw new Error(`no default model for ${o.provider}: pass --model (defaults are only set once the verification benchmark has chosen one)`);
  const initial = selectCandidates(report, o.maxCandidates ?? MAX_CANDIDATES);
  if (mode === 'verify' && initial.length === 0) {
    skipped(report, { mode, provider: o.provider, model, reason: 'no medium or low confidence findings to check', ids: [] });
    return;
  }

  const choice: ProviderChoice = { provider: o.provider, ...(o.preset ? { preset: o.preset } : {}), ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}), ...(o.tools !== undefined ? { tools: o.tools } : {}) };
  const built = o.providerOverride
    ? { provider: o.providerOverride, endpoint: o.providerOverride.endpoint, local: false, key: undefined }
    : createProvider(choice, { ...(o.home ? { home: o.home } : {}), ...(o.env ? { env: o.env } : {}) });
  const caps = capsFor({ provider: o.provider, model, ...(o.baseUrl ?? built.endpoint ? { baseUrl: o.baseUrl ?? built.endpoint } : {}), ...(o.budget ? { budget: o.budget } : {}), ...(o.pricing ? { pricing: o.pricing } : {}) });
  const tracker = new BudgetTracker({
    provider: built.provider, providerId: o.provider, model, caps,
    ...(o.home ? { home: o.home } : {}), ...(o.now ? { now: o.now } : {}),
    ...(o.provider === 'anthropic' ? { fallbackPrice: priceFor('anthropic', 'claude-opus-5-5')! } : {}),
  });
  const today = () => ({ spent: tracker.summary().today.spent, cap: caps.day, unit: caps.unit });

  if (tracker.dayExhausted()) {
    skipped(report, { mode, provider: o.provider, model, reason: `daily cap ${caps.unit === 'usd' ? `$${caps.day.toFixed(2)}` : `${caps.day.toLocaleString('en-US')} tokens`} reached: not checked by AI (budget)`, ids: initial.map((c) => c.finding.id) });
    report.summary.ai!.today = today();
    return;
  }

  const consentKey = { root: o.root, provider: o.provider, endpoint: built.endpoint, ...(o.home ? { home: o.home } : {}) };
  if (needsConsent(consentKey)) {
    const accepted = await o.confirm(consentNotice({ provider: o.provider, model, endpoint: built.endpoint, local: built.local || caps.local, caps }));
    if (!accepted) {
      skipped(report, { mode, provider: o.provider, model, reason: 'AI use was declined for this repository', ids: initial.map((c) => c.finding.id) });
      return;
    }
    recordConsent(consentKey);
  }

  let hunt: HuntResult | undefined;
  let deep: NonNullable<NonNullable<ScanReport['summary']['ai']>['deep']> | undefined;
  if (mode === 'hunt') hunt = await runHunt(report, { root: o.root, provider: built.provider, providerId: o.provider, model, config: o.config, tracker });
  if (mode === 'deep') {
    const estimate = `Deep mode runs a threat model, ${DEEP_CATEGORIES.length} research passes over the riskiest components, a three-voter verification panel${o.suggestFixes ? ' and patch suggestions' : ''}. It can spend up to ${caps.unit === 'usd' ? `$${caps.run.toFixed(2)}` : `${caps.run.toLocaleString('en-US')} tokens`} this run (your cap) and stops there.`;
    if (!(await (o.confirmDeep ?? (async () => false))(estimate))) {
      skipped(report, { mode, provider: o.provider, model, reason: 'deep mode was not confirmed', ids: initial.map((c) => c.finding.id) });
      return;
    }
    const analysis = await analyseDirectory(o.root);
    const entry = analysis.map.entrypoints.slice(0, 30).map((e) => `${e.method ?? ''} ${e.route ?? e.kind} ${e.exposure}`.trim()).join('\n');
    const comps = analysis.map.components.slice(0, 10).map((c) => `${c.path.split('/').slice(-2).join('/')} (${c.files} files)`).join(', ');
    const threat = await buildThreatModel({ provider: built.provider, model, codebaseSummary: `Entry points:\n${entry || '(none found)'}\nComponents: ${comps}`, guard: tracker });
    const merged: HuntResult = { explored: [], notExplored: [], added: 0 };
    for (const category of DEEP_CATEGORIES) {
      const r = await runHunt(report, { root: o.root, provider: built.provider, providerId: o.provider, model, config: o.config, tracker, analysis, focus: category, ...(threat ? { context: threatModelText(threat) } : {}) });
      merged.explored.push(...r.explored.filter((e) => !merged.explored.includes(e)));
      merged.notExplored.push(...r.notExplored);
      merged.added += r.added;
      if (r.notExplored.some((n) => /budget/.test(n.reason))) break;
    }
    hunt = merged;
    deep = { threatModel: threat?.summary ?? '(not built)', learnedRules: [], patches: [], batched: Boolean(o.useBatch && built.provider.chatBatch), categories: [...DEEP_CATEGORIES] };
  }

  // Hunt may have added findings (as "needs review"): verify them too, within what is left of the budget.
  const candidates = mode === 'verify' ? initial : selectCandidates(report, o.maxCandidates ?? MAX_CANDIDATES);
  const skills = loadSkills(o.root).skills;
  const sources = new Map<string, string>();
  const read = (path: string): string => {
    if (!sources.has(path)) {
      try { sources.set(path, readFileSync(path, 'utf8')); } catch { sources.set(path, ''); }
    }
    return sources.get(path)!;
  };
  const changeFor = (file: string) => {
    const changed = o.changes?.files.find((f) => f.path === relative(o.root, file).split('\\').join('/'));
    return changed ? { changedLines: changed.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b === Number.MAX_SAFE_INTEGER ? 'end' : b}`)).join(', ') || 'none', removed: changed.removed ?? [] } : undefined;
  };
  const packs = candidates.map((c) => {
    const change = o.changes ? changeFor(c.finding.file) : undefined;
    return {
      id: c.finding.id,
      pack: buildContextPack({ finding: c.finding, source: read(c.finding.file), siblings: [], checklist: selectSkillSection(skills, c.finding.category)?.text ?? '', ...(change ? { change } : {}) }),
    };
  });

  const verifyInput = { ...(o.changes ? { review: true } : {}), provider: built.provider, providerId: o.provider, model, candidates: packs, guard: tracker, cache: fileVerdictCache(o.home), ...(o.useBatch ? { useBatch: true } : {}) };
  const result = candidates.length > 0
    ? await (mode === 'deep' ? runPanel(verifyInput) : verifyCandidates(verifyInput))
    : { verdicts: new Map(), notChecked: [], usage: { inputTokens: 0, outputTokens: 0 }, requests: 0, cachedHits: 0 } as VerifyResult;
  applyVerdicts(report, result, o.config);
  if (o.changes) movePredating(report, o.config);
  if (deep) {
    const confirmed = report.files.flatMap((f) => f.findings).filter((f) => f.aiVerdict?.verdict === 'confirmed');
    deep.learnedRules = await learnRules(o.root, confirmed);
    if (o.suggestFixes) deep.patches = (await suggestPatches({ root: o.root, findings: confirmed, provider: built.provider, model, guard: tracker })).written;
  }
  const s = tracker.summary();
  report.summary.ai = {
    mode, provider: o.provider, model,
    costUsd: s.costUsd, tokens: s.tokens, requests: s.requests, cachedHits: result.cachedHits,
    checked: result.verdicts.size, notChecked: result.notChecked, today: today(),
    ...(hunt ? { hunt: { explored: hunt.explored, notExplored: hunt.notExplored, added: hunt.added } } : {}),
    ...(deep ? { deep } : {}),
  };
}
