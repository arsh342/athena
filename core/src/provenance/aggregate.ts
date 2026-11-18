import type { AiProvenance, FileReport, ScoredUnit } from '../types.js';
import type { RecordedRepo } from './git-recorded.js';

const RECORDED_UNIT_RATIO = 0.8;

/** 1-based line numbers of a unit's code lines: not blank, not comment. */
function codeLineNumbers(scored: ScoredUnit): number[] {
  const numbers: number[] = [];
  let inBlock = false;
  scored.unit.code.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.trim();
    if (inBlock) {
      if (text.includes('*/')) inBlock = false;
      return;
    }
    if (text === '' || text.startsWith('//') || text.startsWith('*')) return;
    if (text.startsWith('/*')) {
      if (!text.includes('*/')) inBlock = true;
      return;
    }
    numbers.push(scored.unit.startLine + index);
  });
  return numbers;
}

/** A unit is "recorded" when at least 80% of its code lines were written by AI-assisted commits. */
export function markRecordedUnits(files: FileReport[], recorded: RecordedRepo): void {
  for (const file of files) {
    const aiLines = recorded.files.get(file.path)?.aiLines;
    for (const scored of file.units) {
      const lines = codeLineNumbers(scored);
      const hits = aiLines ? lines.filter((line) => aiLines.has(line)).length : 0;
      scored.recorded = lines.length > 0 && hits / lines.length >= RECORDED_UNIT_RATIO;
      scored.flagged = scored.provenance === 'ai' || scored.provenance === 'mixed' || scored.recorded;
    }
  }
}

/** Line-based AI provenance. Each line is owned by its innermost unit, so totals never exceed the code. */
export function buildAiProvenance(files: FileReport[], recorded: RecordedRepo): AiProvenance {
  const totals = { aiLines: 0, mixedLines: 0, uncertainLines: 0, humanLines: 0 };
  let totalLines = 0;
  let recordedLines = 0;
  const perFile: AiProvenance['files'] = [];

  for (const file of files) {
    const aiRecorded = recorded.files.get(file.path)?.aiLines;
    const spans = [...file.units].sort((a, b) => (a.unit.endLine - a.unit.startLine) - (b.unit.endLine - b.unit.startLine));
    const counted = new Map<ScoredUnit, Set<number>>(spans.map((u) => [u, new Set(codeLineNumbers(u))]));
    const owner = new Map<number, ScoredUnit>();
    for (const u of spans) {
      for (let line = u.unit.startLine; line <= u.unit.endLine; line += 1) {
        if (!owner.has(line)) owner.set(line, u);
      }
    }

    const entry = { path: file.path, lines: 0, recordedLines: 0, aiLines: 0, mixedLines: 0, uncertainLines: 0 };
    for (const [line, u] of owner) {
      if (!counted.get(u)!.has(line)) continue;
      entry.lines += 1;
      const isRecorded = aiRecorded?.has(line) ?? false;
      if (isRecorded) entry.recordedLines += 1;
      if (isRecorded || u.provenance === 'ai') {
        entry.aiLines += 1;
        totals.aiLines += 1;
      } else if (u.provenance === 'mixed') {
        entry.mixedLines += 1;
        totals.mixedLines += 1;
      } else if (u.provenance === 'uncertain') {
        entry.uncertainLines += 1;
        totals.uncertainLines += 1;
      } else {
        totals.humanLines += 1;
      }
    }
    totalLines += entry.lines;
    recordedLines += entry.recordedLines;
    perFile.push(entry);
  }

  perFile.sort((a, b) => (b.aiLines / Math.max(1, b.lines)) - (a.aiLines / Math.max(1, a.lines)) || a.path.localeCompare(b.path));

  return {
    unit: 'lines',
    totalLines,
    recorded: recorded.available
      ? { lines: recordedLines, available: true }
      : { lines: 0, available: false, ...(recorded.reason ? { reason: recorded.reason } : {}) },
    estimated: { method: 'heuristic', ...totals },
    files: perFile,
  };
}
