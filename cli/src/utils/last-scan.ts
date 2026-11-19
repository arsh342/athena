import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { athenaHome, isSecretFinding, redactKnownSecrets, redactSecrets, repoKey, type ScanReport } from '@athena/core';

function lastScanPath(root: string): string {
  return join(athenaHome(), 'last-scan', `${repoKey(root)}.json`);
}

/** A copy of the report that is safe to keep on disk: secret-bearing text is redacted. */
function redactedCopy(report: ScanReport): ScanReport {
  return {
    ...report,
    files: report.files.map((file) => ({
      ...file,
      findings: file.findings.map((f) => ({
        ...f,
        code: isSecretFinding(f) ? redactSecrets(f.code) : redactKnownSecrets(f.code),
        message: redactKnownSecrets(f.message),
        ...(f.evidence ? { evidence: f.evidence.map(redactKnownSecrets) } : {}),
      })),
    })),
  };
}

/** Saves the report `athena explain` reads. Keyed by the scanned root. Private to the user (0600). */
export async function saveLastScan(root: string, report: ScanReport): Promise<void> {
  const file = lastScanPath(root);
  await mkdir(join(athenaHome(), 'last-scan'), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ root: resolve(root), savedAt: new Date().toISOString(), report: redactedCopy(report) }), { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function loadLastScan(root: string): Promise<ScanReport | null> {
  try {
    const parsed = JSON.parse(await readFile(lastScanPath(root), 'utf8')) as { report?: ScanReport };
    return parsed.report ?? null;
  } catch {
    return null;
  }
}
