import type { RawFinding } from '../rules/types.js';
import type { FileFacts } from './types.js';

const MIN_CLUSTER = 4;
const MIN_SHARE = 0.75;

function finding(ruleId: string, file: string, line: number, code: string, message: string, evidence: string[]): RawFinding & { file: string } {
  return { file, ruleId, line, code, message, evidence, source: 'athena-investigate' };
}

export type FileFinding = RawFinding & { file: string };

/** "How do the siblings do it?" — infer a convention from the codebase and report the member that breaks it. */
export function mineConventions(facts: FileFacts[]): FileFinding[] {
  const out: FileFinding[] = [];
  const live = facts.filter((f) => !f.isTest);

  // Routes grouped by router/controller.
  const groups = new Map<string, FileFacts['routes']>();
  for (const f of live) for (const r of f.routes) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  for (const routes of groups.values()) {
    const conventions: Array<{ rule: string; members: typeof routes; has: (r: (typeof routes)[number]) => boolean; name: string }> = [
      { rule: 'conv.missing-auth', members: routes, has: (r) => r.hasAuth, name: 'require authentication' },
      { rule: 'conv.missing-validation', members: routes.filter((r) => r.usesInput), has: (r) => r.hasValidation, name: 'validate request input' },
    ];
    for (const c of conventions) {
      if (c.members.length < MIN_CLUSTER) continue;
      const conforming = c.members.filter(c.has);
      if (conforming.length / c.members.length < MIN_SHARE) continue;
      for (const deviant of c.members.filter((m) => !c.has(m) && !m.declaredPublic)) {
        const cites = conforming.slice(0, 2).map((s) => `${s.label} (${s.file}:${s.line})`);
        out.push(finding(c.rule, deviant.file, deviant.line, deviant.label,
          `${conforming.length} of ${c.members.length} routes in this router ${c.name}; ${deviant.label} does not.`,
          [`Convention: ${conforming.length}/${c.members.length} siblings ${c.name}`, ...cites.map((s) => `Follows it: ${s}`)]));
      }
    }
  }

  // Queries grouped by table: how many restrict rows to the current user?
  const tables = new Map<string, FileFacts['queries']>();
  for (const f of live) for (const q of f.queries) tables.set(q.table, [...(tables.get(q.table) ?? []), q]);
  for (const [table, queries] of tables) {
    if (queries.length < MIN_CLUSTER) continue;
    const conforming = queries.filter((q) => q.hasOwnerFilter);
    if (conforming.length / queries.length < MIN_SHARE) continue;
    for (const q of queries.filter((x) => !x.hasOwnerFilter)) {
      const cites = conforming.slice(0, 2).map((s) => `${s.snippet} (${s.file}:${s.line})`);
      out.push(finding('conv.missing-ownership-filter', q.file, q.line, q.snippet,
        `${conforming.length} of ${queries.length} queries on \`${table}\` restrict rows to the current user; this ${q.verb} does not.`,
        [`Convention: ${conforming.length}/${queries.length} queries on ${table} filter by owner`, ...cites.map((s) => `Follows it: ${s}`)]));
    }
  }

  // State types: members that nothing ever sets.
  const assigned = new Set(live.flatMap((f) => f.assignedStates.map((s) => s.toLowerCase())));
  for (const f of live) {
    for (const u of f.unions) {
      if (u.members.length < 3 || f.path.endsWith('.d.ts')) continue;
      for (const m of u.members) {
        if (!assigned.has(m.toLowerCase())) {
          out.push(finding('state.unreachable-state', f.path, u.line, `${u.name}: '${m}'`, `State '${m}' of ${u.name} is declared but never assigned anywhere.`, [`Assigned states seen: ${[...assigned].slice(0, 8).join(', ')}`]));
        }
      }
    }
  }
  return out;
}
