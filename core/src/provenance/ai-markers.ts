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

/**
 * Addresses used by AI coding tools. Matched against author, committer and trailer emails only:
 * a human who is merely named Claude or Devin must not count as AI.
 */
export const AI_EMAIL_PATTERNS: RegExp[] = [
  /noreply@anthropic\.com/i,
  /@cursor\.com/i,
  /copilot@users\.noreply\.github\.com/i,
  /^(codex|noreply)@openai\.com$/i,
  /noreply@google\.com/i,
  /@devin\.ai/i,
  /@aider\.chat/i,
];

/** A trailer value that is just a tool name (no email), e.g. "Assisted-by: Claude". */
export const AI_TOOL_NAME = /^(claude( code)?|github copilot|copilot|cursor( agent)?|codex|openai codex|gemini( code assist)?|devin|aider|windsurf|codeium|amazon q( developer)?|jules)(\s*\(.*\))?$/i;

/** Agent bot accounts (exact, case-insensitive). */
export const AI_BOT_LOGINS = [
  'copilot-swe-agent[bot]',
  'devin-ai-integration[bot]',
  'claude[bot]',
  'cursor[bot]',
  'google-labs-jules[bot]',
  'codex[bot]',
];

function emailOf(value: string): string | null {
  return value.match(/<([^>]+)>/)?.[1] ?? (value.includes('@') ? value.trim() : null);
}

function isAiTrailerValue(value: string): boolean {
  const email = emailOf(value);
  if (email) return AI_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
  return AI_TOOL_NAME.test(value.trim());
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
  if (trailerValues(meta.message).some(isAiTrailerValue)) return true;
  const bots = new Set(AI_BOT_LOGINS);
  for (const name of [meta.authorName, meta.committerName]) {
    if (bots.has(name.toLowerCase()) || /\(aider\)$/i.test(name)) return true;
  }
  return [meta.authorEmail, meta.committerEmail].some((email) => AI_EMAIL_PATTERNS.some((pattern) => pattern.test(email)));
}
