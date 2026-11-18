export interface CommitMeta {
  sha: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  message: string;
}

/** Commit trailer keys that credit a tool (case-insensitive). */
export const AI_TRAILER_KEYS = ['co-authored-by', 'assisted-by', 'generated-by'];

/** Names or addresses of AI coding tools. Kept in one place so later phases reuse it. */
export const AI_IDENTITY_PATTERNS: RegExp[] = [
  /noreply@anthropic\.com/i,
  /\bclaude\b/i,
  /copilot/i,
  /@cursor\.com/i,
  /\bcursor agent\b/i,
  /\bcodex\b/i,
  /@openai\.com/i,
  /\bgemini\b/i,
  /\bdevin\b/i,
  /\baider\b/i,
  /\bwindsurf\b/i,
  /\bcodeium\b/i,
  /\bamazon q\b/i,
  /\bjules\b/i,
];

/** Agent bot accounts (exact, case-insensitive). */
export const AI_BOT_LOGINS = [
  'copilot-swe-agent[bot]',
  'devin-ai-integration[bot]',
  'claude[bot]',
  'cursor[bot]',
  'google-labs-jules[bot]',
  'codex[bot]',
];

function matchesIdentity(value: string): boolean {
  return AI_IDENTITY_PATTERNS.some((pattern) => pattern.test(value));
}

function trailerValues(message: string): string[] {
  const paragraphs = message.trim().split(/\r?\n\s*\r?\n/);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  const values: string[] = [];
  for (const line of last.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match && AI_TRAILER_KEYS.includes(match[1].toLowerCase())) values.push(match[2]);
  }
  return values;
}

export function isAiCommit(meta: CommitMeta): boolean {
  if (trailerValues(meta.message).some(matchesIdentity)) return true;
  const bots = new Set(AI_BOT_LOGINS);
  for (const name of [meta.authorName, meta.committerName]) {
    if (bots.has(name.toLowerCase())) return true;
  }
  return [meta.authorName, meta.authorEmail, meta.committerName, meta.committerEmail].some(matchesIdentity);
}
