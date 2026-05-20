# Report Export + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist redacted report snapshots for authenticated scans, improve report UX with grouped/deduped/collapsible findings, and provide PDF export from stored markdown.

**Architecture:** Backend generates and stores redacted markdown snapshots per scan, exposes markdown/PDF endpoints. Frontend renders grouped findings and sanitized markdown, with UI-only raw-secret toggle. PDF export is generated on demand from stored markdown.

**Tech Stack:** Node.js, Express, Postgres, React, Vite, TypeScript, @athena/core

---

## File Structure

**Backend**
- Modify: `backend/src/db.ts` (create `scan_reports` table)
- Modify: `docs/supabase/schema.sql` (schema parity)
- Modify: `backend/src/data.ts` (CRUD for report snapshots)
- Create: `backend/src/report-markdown.ts` (group/dedupe + redaction + markdown)
- Create: `backend/src/report-pdf.ts` (markdown → HTML → PDF)
- Modify: `backend/src/scanner.ts` (store snapshot after scan)
- Modify: `backend/src/server.ts` (report endpoints)
- Test: `backend/test/scan-reports.test.ts`
- Test: `backend/test/report-markdown.test.ts`
- Test: `backend/test/report-endpoints.test.ts`

**Frontend**
- Modify: `frontend/src/types/index.ts` (expand `FindingSource`)
- Create: `frontend/src/utils/report.ts` (group/dedupe + redaction helpers)
- Modify: `frontend/src/components/ReportView.tsx` (grouped UI + collapses + toggle)
- Modify: `frontend/src/pages/ReportPage.tsx` (markdown section + export button)
- Modify: `frontend/src/services/api.ts` (report fetch + pdf download)
- Test: `frontend/test/report-utils.test.ts`
- Test: `frontend/test/report-page-md.test.ts`

---

### Task 1: Add report snapshot storage

**Files:**
- Modify: `docs/supabase/schema.sql`
- Modify: `backend/src/db.ts`
- Modify: `backend/src/data.ts`
- Test: `backend/test/scan-reports.test.ts`

- [ ] **Step 1: Write failing tests for report snapshot storage**

```ts
// backend/test/scan-reports.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.ts';
import { addScanReport, getScanReport } from '../src/data.ts';

async function withMockDb<T>(overrides: {
  query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}, fn: () => Promise<T>): Promise<T> {
  const dbHandle = db as unknown as { query: typeof db.query };
  const originalQuery = dbHandle.query;
  if (overrides.query) dbHandle.query = overrides.query as typeof db.query;
  try {
    return await fn();
  } finally {
    dbHandle.query = originalQuery;
  }
}

test('addScanReport upserts markdown snapshot for scan', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  await withMockDb({
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  }, async () => {
    await addScanReport(7, 'scan-1', '# Report\n');
  });

  assert.match(calls[0]?.text ?? '', /INSERT INTO scan_reports/);
  assert.equal(calls[0]?.params?.[0], 'scan-1');
  assert.equal(calls[0]?.params?.[1], 7);
});

test('getScanReport returns markdown for user scan', async () => {
  const row = { markdown: '# Report\n' };
  await withMockDb({
    query: async () => ({ rows: [row] }),
  }, async () => {
    const markdown = await getScanReport('scan-1', 7);
    assert.equal(markdown, '# Report\n');
  });
});
```

- [ ] **Step 2: Run tests to see failure**

Run: `npm test -w @athena/backend -- scan-reports.test.ts`
Expected: FAIL with missing exports `addScanReport`/`getScanReport`.

- [ ] **Step 3: Add `scan_reports` table to schema**

```sql
-- docs/supabase/schema.sql
create table if not exists public.scan_reports (
  scan_id text primary key references public.scans(scan_id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  markdown text not null,
  created_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists idx_scan_reports_user_created_at
  on public.scan_reports(user_id, created_at desc);
```

- [ ] **Step 4: Ensure table in local DB bootstrap**

```ts
// backend/src/db.ts (inside ensureAuthSchema)
await db.query(`
  CREATE TABLE IF NOT EXISTS scan_reports (
    scan_id TEXT PRIMARY KEY REFERENCES scans(scan_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1
  );
`);

await db.query(`
  CREATE INDEX IF NOT EXISTS idx_scan_reports_user_created_at
  ON scan_reports(user_id, created_at DESC);
`);
```

- [ ] **Step 5: Add data accessors with doc comments**

```ts
// backend/src/data.ts
/** Store or update a redacted report snapshot for a scan. */
export async function addScanReport(userId: number, scanId: string, markdown: string): Promise<void> {
  await db.query(
    `
      INSERT INTO scan_reports (scan_id, user_id, markdown)
      VALUES ($1, $2, $3)
      ON CONFLICT (scan_id)
      DO UPDATE SET markdown = EXCLUDED.markdown, created_at = NOW(), version = scan_reports.version + 1
    `,
    [scanId, userId, markdown],
  );
}

/** Fetch the stored markdown snapshot for a scan. */
export async function getScanReport(scanId: string, userId: number): Promise<string | null> {
  const result = await db.query<{ markdown: string }>(
    `
      SELECT sr.markdown
      FROM scan_reports sr
      JOIN scans s ON s.scan_id = sr.scan_id
      WHERE sr.scan_id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanId, userId],
  );
  return result.rows[0]?.markdown ?? null;
}
```

- [ ] **Step 6: Re-run tests**

Run: `npm test -w @athena/backend -- scan-reports.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/supabase/schema.sql backend/src/db.ts backend/src/data.ts backend/test/scan-reports.test.ts
git commit -m "feat: add scan report snapshot storage"
```

---

### Task 2: Redacted markdown generation

**Files:**
- Create: `backend/src/report-markdown.ts`
- Modify: `backend/src/scanner.ts`
- Test: `backend/test/report-markdown.test.ts`

- [ ] **Step 1: Write failing tests for redaction + grouping**

```ts
// backend/test/report-markdown.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportMarkdown } from '../src/report-markdown.ts';
import type { Finding, ScanSummary } from '../src/data.ts';

const scan: ScanSummary = {
  scanId: 'scan-1',
  repoName: 'repo',
  repoUrl: 'local://repo',
  status: 'COMPLETED',
  createdAt: '2026-05-19T00:00:00.000Z',
  aiPercentage: 40,
  flaggedUnits: 2,
  filesScanned: 2,
  totalUnits: 2,
  findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 1, criticalPer1kLoc: 0, flaggedRatio: 0.5 },
  duration: 100,
};

const findings: Finding[] = [
  {
    id: 'f1',
    severity: 'HIGH',
    type: 'Hardcoded secret',
    category: 'secret',
    message: "secret = 'abc123'",
    file: 'src/a.ts',
    line: 1,
    column: 1,
    source: 'secret-detector',
    aiScore: 7,
    code: "const secret = 'abc123'",
    ruleId: 'secret.rule',
    topSignals: [],
  },
  {
    id: 'f2',
    severity: 'HIGH',
    type: 'Hardcoded secret',
    category: 'secret',
    message: "secret = 'abc123'",
    file: 'src/a.ts',
    line: 1,
    column: 1,
    source: 'secret-detector',
    aiScore: 7,
    code: "const secret = 'abc123'",
    ruleId: 'secret.rule',
    topSignals: [],
  },
];

test('generateReportMarkdown redacts secrets and dedupes', () => {
  const markdown = generateReportMarkdown(scan, findings);
  assert.ok(markdown.includes('### HIGH'));
  assert.ok(markdown.includes('#### src/a.ts'));
  assert.ok(markdown.includes('***REDACTED***'));
  assert.equal(markdown.match(/Hardcoded secret/g)?.length, 1);
});
```

- [ ] **Step 2: Run tests to see failure**

Run: `npm test -w @athena/backend -- report-markdown.test.ts`
Expected: FAIL missing `generateReportMarkdown`.

- [ ] **Step 3: Implement markdown generator with doc comments**

```ts
// backend/src/report-markdown.ts
import type { Finding, ScanSummary } from './data.ts';

type DedupeKey = string;

function isSecretFinding(finding: Finding): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector'
    || /secret|token|password|key|credential|jwt/.test(haystack);
}

function redactText(value: string, shouldRedact: boolean): string {
  if (!shouldRedact) return value;
  return value.replace(/(['"][^'"]{4,}['"]|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,})/g, '***REDACTED***');
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<DedupeKey>();
  const output: Finding[] = [];
  for (const finding of findings) {
    const ruleKey = finding.ruleId?.trim()
      ? `${finding.ruleId}:${finding.file}:${finding.line}`
      : `${finding.type}:${finding.message}:${finding.file}:${finding.line}`;
    if (seen.has(ruleKey)) continue;
    seen.add(ruleKey);
    output.push(finding);
  }
  return output;
}

/** Generate redacted markdown snapshot for a scan report. */
export function generateReportMarkdown(scan: ScanSummary, findings: Finding[]): string {
  const deduped = dedupeFindings(findings);
  const grouped = deduped.reduce<Record<string, Record<string, Finding[]>>>((acc, finding) => {
    acc[finding.severity] = acc[finding.severity] ?? {};
    acc[finding.severity][finding.file] = acc[finding.severity][finding.file] ?? [];
    acc[finding.severity][finding.file].push(finding);
    return acc;
  }, {});

  const header = `# Scan Report: ${scan.repoName}\n`
    + `- Scan ID: ${scan.scanId}\n`
    + `- Repo URL: ${scan.repoUrl}\n`
    + `- Created: ${scan.createdAt}\n\n`
    + `## Summary\n`
    + `- AI involvement: ${scan.aiPercentage}%\n`
    + `- Findings: ${findings.length}\n`
    + `- Risk density: ${scan.riskDensity.findingsPer1kLoc}\n`
    + `- Flagged ratio: ${Math.round(scan.riskDensity.flaggedRatio * 100)}%\n\n`
    + `## Findings\n`;

  const sections = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    .map((severity) => {
      const files = grouped[severity];
      if (!files) return '';
      const fileBlocks = Object.keys(files).sort().map((file) => {
        const items = files[file] ?? [];
        const lines = items.map((finding) => {
          const redact = isSecretFinding(finding);
          const message = redactText(finding.message, redact);
          const code = redactText(finding.code, redact);
          return `- ${finding.type}: ${message}\n  - Source: ${finding.source}\n  - AI score: ${finding.aiScore}\n  - Location: ${finding.file}:${finding.line}\n  - Code:\n\n    \`\`\`\n${code}\n    \`\`\`\n`;
        }).join('\n');
        return `#### ${file}\n${lines}`;
      }).join('\n');
      return `### ${severity}\n${fileBlocks}`;
    })
    .filter(Boolean)
    .join('\n');

  return `${header}${sections}\n`;
}
```

- [ ] **Step 4: Store snapshot after scan completion**

```ts
// backend/src/scanner.ts (inside scanFromPath, after persistScan)
if (typeof userId === 'number') {
  const { generateReportMarkdown } = await import('./report-markdown.ts');
  const { addScanReport } = await import('./data.ts');
  const markdown = generateReportMarkdown(scanSummary, allFindings);
  await addScanReport(userId, scanSummary.scanId, markdown);
}
```

- [ ] **Step 5: Re-run tests**

Run: `npm test -w @athena/backend -- report-markdown.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/report-markdown.ts backend/src/scanner.ts backend/test/report-markdown.test.ts
git commit -m "feat: generate redacted markdown snapshots"
```

---

### Task 3: Report endpoints + PDF export

**Files:**
- Modify: `backend/src/server.ts`
- Create: `backend/src/report-pdf.ts`
- Test: `backend/test/report-endpoints.test.ts`

**Dependency decision (required):**
- PDF: **playwright** (chosen) vs `puppeteer`, `md-to-pdf`.
  - Reason: stable Chromium rendering, good CSS control.
- Markdown render (backend): **marked** (chosen) vs `markdown-it`, `remark`.
  - Reason: small, fast, simple server-side HTML conversion.

- [ ] **Step 1: Add failing endpoint tests**

```ts
// backend/test/report-endpoints.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.ts';

const authUser = { id: 7, email: 'test@example.com' };

test('GET /api/scans/:scanId/report returns markdown', async () => {
  const app = createApp({
    auth: { getAuthenticatedUser: async () => authUser } as any,
    data: { getScanReport: async () => '# Report\n' } as any,
  });

  const res = await request(app).get('/api/scans/scan-1/report');
  assert.equal(res.status, 200);
  assert.equal(res.body.markdown, '# Report\n');
});

test('GET /api/scans/:scanId/report.pdf returns pdf bytes', async () => {
  const app = createApp({
    auth: { getAuthenticatedUser: async () => authUser } as any,
    data: { getScanReport: async () => '# Report\n' } as any,
    report: { renderPdfFromMarkdown: async () => Buffer.from('%PDF-1.4') } as any,
  });

  const res = await request(app).get('/api/scans/scan-1/report.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.ok(res.body.length > 0);
});
```

- [ ] **Step 2: Run tests to see failure**

Run: `npm test -w @athena/backend -- report-endpoints.test.ts`
Expected: FAIL missing `report` deps + endpoints.

- [ ] **Step 3: Add PDF renderer module**

```ts
// backend/src/report-pdf.ts
import { marked } from 'marked';
import { chromium } from 'playwright';

/** Render markdown into a PDF buffer. */
export async function renderPdfFromMarkdown(markdown: string): Promise<Buffer> {
  const html = marked.parse(markdown, { mangle: false, headerIds: false }) as string;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8" />
    <style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#111}</style>
  </head><body>${html}</body></html>`);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdf;
}
```

- [ ] **Step 4: Wire endpoints with auth + snapshot**

```ts
// backend/src/server.ts (ServerDeps.data add getScanReport; add report dep)
import { renderPdfFromMarkdown } from './report-pdf.ts';
import { getScanReport } from './data.ts';

// ServerDeps
report: {
  renderPdfFromMarkdown: typeof renderPdfFromMarkdown;
};

// deps init
report: { renderPdfFromMarkdown, ...(overrides.report ?? {}) },

// GET /api/scans/:scanId/report
app.get('/api/scans/:scanId/report', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
  const markdown = await deps.data.getScanReport(scanId, user.id);
  if (!markdown) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json({ markdown });
});

// GET /api/scans/:scanId/report.pdf
app.get('/api/scans/:scanId/report.pdf', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
  const markdown = await deps.data.getScanReport(scanId, user.id);
  if (!markdown) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  const pdf = await deps.report.renderPdfFromMarkdown(markdown);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${scanId}.pdf"`);
  res.send(pdf);
});
```

- [ ] **Step 5: Add backend dependencies**

```bash
npm install -w @athena/backend marked playwright
npm install -w @athena/backend -D supertest @types/supertest
npx playwright install chromium
```

- [ ] **Step 6: Re-run tests**

Run: `npm test -w @athena/backend -- report-endpoints.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/report-pdf.ts backend/src/server.ts backend/test/report-endpoints.test.ts backend/package.json package-lock.json
git commit -m "feat: add report markdown and pdf endpoints"
```

---

### Task 4: Frontend report grouping + redaction toggle + markdown render

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/utils/report.ts`
- Modify: `frontend/src/components/ReportView.tsx`
- Modify: `frontend/src/pages/ReportPage.tsx`
- Modify: `frontend/src/services/api.ts`
- Test: `frontend/test/report-utils.test.ts`
- Test: `frontend/test/report-page-md.test.ts`

**Dependency decision (required):**
- Markdown render: **marked** + **dompurify** (chosen) vs `markdown-it`, `react-markdown` + `rehype-sanitize`.
  - Reason: small render function, explicit sanitization, no React plugin chain.

- [ ] **Step 1: Add failing tests for grouping/dedupe**

```ts
// frontend/test/report-utils.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFindings, redactFindingText } from '../src/utils/report.ts';
import type { Finding } from '../src/types';

const finding: Finding = {
  id: 'f1',
  severity: 'HIGH',
  type: 'Hardcoded secret',
  category: 'secret',
  message: "secret = 'abc123'",
  file: 'src/a.ts',
  line: 1,
  column: 1,
  source: 'secret-detector',
  aiScore: 7,
  code: "const secret = 'abc123'",
  ruleId: 'secret.rule',
  topSignals: [],
};

test('groupFindings dedupes by ruleId + file + line', () => {
  const grouped = groupFindings([finding, { ...finding, id: 'f2' }]);
  const highFiles = grouped.HIGH;
  assert.equal(Object.keys(highFiles).length, 1);
  assert.equal(highFiles['src/a.ts']?.length, 1);
});

test('redactFindingText masks secrets by default', () => {
  const redacted = redactFindingText(finding.message, finding);
  assert.ok(redacted.includes('***REDACTED***'));
});
```

- [ ] **Step 2: Run tests to see failure**

Run: `npm test -w @athena/frontend -- report-utils.test.ts`
Expected: FAIL missing utils.

- [ ] **Step 3: Implement report utilities**

```ts
// frontend/src/utils/report.ts
import type { Finding, Severity } from '../types';

type Grouped = Record<Severity, Record<string, Finding[]>>;

export function isSecretFinding(finding: Finding): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector'
    || /secret|token|password|key|credential|jwt/.test(haystack);
}

export function redactFindingText(value: string, finding: Finding): string {
  if (!isSecretFinding(finding)) return value;
  return value.replace(/(['"][^'"]{4,}['"]|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,})/g, '***REDACTED***');
}

export function groupFindings(findings: Finding[]): Grouped {
  const seen = new Set<string>();
  return findings.reduce<Grouped>((acc, finding) => {
    const key = finding.ruleId?.trim()
      ? `${finding.ruleId}:${finding.file}:${finding.line}`
      : `${finding.type}:${finding.message}:${finding.file}:${finding.line}`;
    if (seen.has(key)) return acc;
    seen.add(key);
    acc[finding.severity] = acc[finding.severity] ?? {};
    acc[finding.severity][finding.file] = acc[finding.severity][finding.file] ?? [];
    acc[finding.severity][finding.file].push(finding);
    return acc;
  }, { CRITICAL: {}, HIGH: {}, MEDIUM: {}, LOW: {} });
}
```

- [ ] **Step 4: Expand frontend FindingSource union**

```ts
// frontend/src/types/index.ts
export type FindingSource =
  | 'secret-detector'
  | 'hallucination-detector'
  | 'security-analyzer'
  | 'semgrep'
  | 'eslint'
  | 'npm-audit'
  | 'nodejsscan'
  | 'bearer'
  | 'trivy'
  | 'horusec';
```

- [ ] **Step 5: Update ReportView UI (grouped + collapsed + toggle)**

```tsx
// frontend/src/components/ReportView.tsx
import { useMemo, useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { SeverityBadge } from './SeverityBadge';
import type { Finding, Severity } from '../types';
import { groupFindings, redactFindingText } from '../utils/report';

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function ReportView({ findings }: { findings: Finding[] }) {
  const [showRawSecrets, setShowRawSecrets] = useState(false);
  const [openSeverities, setOpenSeverities] = useState<Record<Severity, boolean>>({
    CRITICAL: false, HIGH: false, MEDIUM: false, LOW: false,
  });

  const grouped = useMemo(() => groupFindings(findings), [findings]);

  return (
    <section className="report-list" aria-label="Security findings">
      <div className="report-toolbar">
        <label>
          <input type="checkbox" checked={showRawSecrets} onChange={(e) => setShowRawSecrets(e.target.checked)} />
          Show raw secrets (UI only)
        </label>
      </div>

      {SEVERITIES.map((severity) => {
        const files = grouped[severity];
        const fileKeys = Object.keys(files);
        return (
          <div key={severity} className="report-severity">
            <button
              type="button"
              className="report-severity-toggle"
              onClick={() => setOpenSeverities((prev) => ({ ...prev, [severity]: !prev[severity] }))}
            >
              <SeverityBadge severity={severity} />
              <span>{fileKeys.length} files</span>
            </button>

            {openSeverities[severity] && fileKeys.map((file) => (
              <div key={file} className="report-file">
                <div className="report-file-head">
                  <strong>{file}</strong>
                  <span>{files[file]?.length ?? 0} findings</span>
                </div>
                {files[file]?.map((finding) => (
                  <article className="finding-card" key={finding.id}>
                    <div className="finding-head">
                      <div>
                        <SeverityBadge severity={finding.severity} />
                        <h3>{finding.type}</h3>
                      </div>
                      <span className="finding-id">{finding.id}</span>
                    </div>
                    <p>{showRawSecrets ? finding.message : redactFindingText(finding.message, finding)}</p>
                    <div className="finding-meta">
                      <span>{finding.file}:{finding.line}</span>
                      <span>{finding.source}</span>
                      <span>AI score {finding.aiScore}</span>
                    </div>
                    <CodeBlock code={showRawSecrets ? finding.code : redactFindingText(finding.code, finding)} />
                  </article>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 6: Add markdown fetch + render + PDF download**

```ts
// frontend/src/services/api.ts
export async function fetchReportMarkdown(scanId: string): Promise<string> {
  const data = await fetchJson<{ markdown: string }>(`/api/scans/${scanId}/report`);
  return data.markdown;
}

export async function downloadReportPdf(scanId: string): Promise<Blob> {
  const response = await fetch(`/api/scans/${scanId}/report.pdf`, { credentials: 'include' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.blob();
}
```

```tsx
// frontend/src/pages/ReportPage.tsx (add markdown panel)
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { downloadReportPdf, fetchReportMarkdown } from '../services/api';

const html = useMemo(() => {
  const raw = markdown ?? '';
  const rendered = marked.parse(raw, { mangle: false, headerIds: false }) as string;
  return DOMPurify.sanitize(rendered);
}, [markdown]);

<button
  type="button"
  className="button button-primary"
  onClick={async () => {
    const blob = await downloadReportPdf(resolvedScanId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${resolvedScanId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }}
>
  Download PDF
</button>

<section className="panel report-markdown">
  <h2>Report (Markdown)</h2>
  <div className="report-markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
</section>
```

- [ ] **Step 7: Add frontend dependencies**

```bash
npm install -w @athena/frontend marked dompurify
```

- [ ] **Step 8: Re-run tests**

Run: `npm test -w @athena/frontend -- report-utils.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/report.ts frontend/src/components/ReportView.tsx frontend/src/pages/ReportPage.tsx frontend/src/services/api.ts frontend/src/types/index.ts frontend/package.json package-lock.json frontend/test/report-utils.test.ts
git commit -m "feat: group findings and render markdown report"
```

---

### Task 5: Dashboard empty state

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Test: `frontend/test/dashboard-utils.test.ts`

- [ ] **Step 1: Add failing test for empty state helper**

```ts
// frontend/test/dashboard-utils.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardEmptyState } from '../src/utils/dashboard';

test('getDashboardEmptyState returns empty flag when no scans', () => {
  const result = getDashboardEmptyState([]);
  assert.equal(result.isEmpty, true);
});
```

- [ ] **Step 2: Run tests to see failure**

Run: `npm test -w @athena/frontend -- dashboard-utils.test.ts`
Expected: FAIL missing helper.

- [ ] **Step 3: Implement helper and UI empty state**

```ts
// frontend/src/utils/dashboard.ts
import type { ScanSummary } from '../types';

export function getDashboardEmptyState(scans: ScanSummary[]) {
  return { isEmpty: scans.length === 0 };
}
```

```tsx
// frontend/src/pages/Dashboard.tsx
import { getDashboardEmptyState } from '../utils/dashboard';

const { isEmpty } = getDashboardEmptyState(scans);

{isEmpty ? (
  <div className="empty-state">No scans yet. Run your first scan.</div>
) : (
  <div className="scan-table">...</div>
)}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -w @athena/frontend -- dashboard-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/utils/dashboard.ts frontend/test/dashboard-utils.test.ts
git commit -m "feat: show dashboard empty state"
```

---

## Plan Self-Review
- **Spec coverage:** storage, grouping/dedupe, export, dashboard history, redaction handled by Tasks 1–5.
- **Placeholder scan:** no TBD/TODO.
- **Type consistency:** matches `ScanSummary`, `Finding` shapes used elsewhere.

---

## Execution Handoff
Plan complete and saved to `docs/superpowers/plans/2026-05-19-report-export-history.md`.

Two execution options:

1. Subagent-Driven (recommended) — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
