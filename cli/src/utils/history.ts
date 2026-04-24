import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ScanHistoryEntry {
  timestamp: string;
  mode: 'scan' | 'check';
  target: string;
  blocked: boolean;
  filesScanned: number;
  aiScore: number;
}

const ATHENA_DIR = join(homedir(), '.athena');
const HISTORY_PATH = join(ATHENA_DIR, 'scan-history.jsonl');
const MAX_HISTORY_LINES = 300;

function logHistoryWarning(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[athena-cli] ${context}: ${message}`);
}

export async function appendScanHistory(entry: ScanHistoryEntry): Promise<void> {
  try {
    await mkdir(ATHENA_DIR, { recursive: true });

    let lines: string[] = [];
    try {
      const existing = await readFile(HISTORY_PATH, 'utf8');
      lines = existing
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      // No history file yet; create on first write.
      logHistoryWarning('History file not readable, starting new history', error);
    }

    lines.push(JSON.stringify(entry));

    const trimmed = lines.slice(-MAX_HISTORY_LINES);
    await writeFile(HISTORY_PATH, `${trimmed.join('\n')}\n`, 'utf8');
  } catch (error) {
    // Never fail a scan/check flow because local history persistence failed.
    logHistoryWarning('Failed to persist scan history', error);
  }
}

export async function getRecentScanHistory(limit = 3): Promise<ScanHistoryEntry[]> {
  try {
    const content = await readFile(HISTORY_PATH, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(1, limit));

    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as ScanHistoryEntry;
        } catch (error) {
          logHistoryWarning('Skipping malformed history entry', error);
          return null;
        }
      })
      .filter((entry): entry is ScanHistoryEntry => entry !== null)
      .reverse();
  } catch (error) {
    logHistoryWarning('Failed to read scan history', error);
    return [];
  }
}

export function formatRecentHistory(entries: ScanHistoryEntry[]): string {
  if (entries.length === 0) {
    return 'history: none';
  }

  const parts = entries.map((entry) => {
    const stamp = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const status = entry.blocked ? 'blocked' : 'pass';
    const score = Number.isFinite(entry.aiScore) ? Math.round(entry.aiScore) : 0;
    return `${entry.mode} ${stamp} ${status} ${score}`;
  });

  return `history: ${parts.join(' | ')}`;
}
