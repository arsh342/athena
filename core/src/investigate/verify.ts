import type { Confidence, RawFinding } from '../rules/types.js';
import { ruleMeta } from '../rules/registry.js';
import { entryAt, isReachable, type MapIndex } from './map.js';
import { type Exposure, type FileFacts } from './types.js';

const ARGV_OR_ENV = /source: (?:sys\.argv|process\.argv|os\.Args|argv\[|std::env::args|env::args|\$\d|positional argument|read from stdin|os\.Getenv|System\.getenv|getenv)/;
const SENSITIVE = /\b(?:users?|accounts?|payments?|orders?|tokens?|sessions?|credentials?|secrets?|passwords?|invoices?|customers?|patients?)\b/i;

export interface VerifiedFields {
  confidence: Confidence;
  evidence: string[];
  exposure?: Exposure;
  priority: number;
}

const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 8, HIGH: 4, MEDIUM: 2, LOW: 1 };
const EXPOSURE_WEIGHT: Record<Exposure, number> = { public: 3, authenticated: 2, internal: 1 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** severity x exposure x confidence, with a bump when sensitive data is involved. */
export function priorityOf(severity: string, exposure: Exposure | undefined, confidence: Confidence, sensitive = false): number {
  return (SEVERITY_WEIGHT[severity] ?? 1) * EXPOSURE_WEIGHT[exposure ?? 'authenticated'] * CONFIDENCE_WEIGHT[confidence] + (sensitive ? 2 : 0);
}

/**
 * "Try to disprove it": three deterministic lenses. Reachability (can an entry point get here?),
 * defenses (sanitizers are already honoured by taint; guards on the route), impact (exposure, sink class, data).
 * Low confidence findings are shown as "needs review" and never block.
 */
export function verifyFinding(file: string, raw: RawFinding, map: MapIndex, facts: FileFacts | undefined): VerifiedFields {
  const meta = ruleMeta(raw.ruleId);
  let confidence: Confidence = raw.confidence ?? meta?.confidence ?? 'medium';
  const evidence: string[] = [...(raw.evidence ?? [])];
  const isSecret = raw.source === 'athena-secrets';

  if (facts?.isTest) {
    if (!isSecret) {
      confidence = 'low';
      evidence.push('Reachability: the code is in test or fixture code, which is not deployed.');
    }
  } else if (!isSecret && raw.source !== 'athena-investigate') {
    // Request-sourced taint is itself proof that an entry point reaches the code: never demote it for reachability.
    const requestSourced = raw.source === 'athena-taint' && /^source: /.test(raw.trace?.[0]?.note ?? '') && !ARGV_OR_ENV.test(raw.trace?.[0]?.note ?? '');
    if (!requestSourced && !isReachable(map, file, raw.line)) {
      confidence = 'low';
      evidence.push('Reachability: no route, CLI command or consumer in the codebase can reach this code.');
    } else {
      const entry = entryAt(map, file, raw.line);
      if (entry) {
        evidence.push(`Reachability: handler of ${entry.method ?? entry.kind} ${entry.route ?? ''} (${entry.exposure}).`.replace(/\s+\)/, ')'));
      } else if (map.entrypoints.length > 0) {
        evidence.push('Reachability: called from an entry point.');
      }
    }
  }

  const entry = entryAt(map, file, raw.line);
  const exposure: Exposure | undefined = entry?.exposure;
  if (exposure === 'internal' && confidence === 'high') {
    confidence = 'medium';
    evidence.push('Impact: the entry point is internal (CLI, queue), so attacker reach is smaller.');
  }
  if (entry && entry.guards.length > 0 && raw.source === 'athena-taint') evidence.push(`Defenses: the route requires ${entry.guards[0]}; an authenticated user is still an attacker model for injection.`);
  if (raw.source === 'athena-taint') evidence.push(...(raw.trace && raw.trace.length > 0 ? ['Defenses: no sanitizer, validator or prepared statement on the traced path.'] : []));

  if (raw.source === 'athena-taint' && ARGV_OR_ENV.test(raw.trace?.[0]?.note ?? '')) {
    confidence = 'low';
    evidence.push('Impact: the input is a command-line argument or environment value chosen by the person running the program.');
  }
  const sensitive = SENSITIVE.test(raw.code) || SENSITIVE.test(raw.message ?? '');
  if (sensitive) evidence.push('Impact: touches data about users, accounts, payments or credentials.');
  if (exposure === 'public') evidence.push('Impact: exposed to unauthenticated callers.');
  return { confidence, evidence, ...(exposure ? { exposure } : {}), priority: priorityOf(meta?.severity ?? 'MEDIUM', exposure, confidence, sensitive) };
}
