# Report Export + History Design

## Goal
Improve report UX with grouped/deduped/collapsible findings, persistent report snapshots for authenticated users, and PDF export for sharing. Dashboard should surface scan history reliably for authenticated users.

## Non-Goals
- Public share links
- Anonymous report persistence
- Large-scale pagination or archival policy

## Summary of Decisions
- Group findings by severity then file; collapse all severity sections by default.
- Dedupe using `ruleId + file + line`; fallback to `type + message + file + line`.
- Store **redacted markdown** snapshot per scan in DB.
- Render markdown to HTML in the report page.
- PDF export generated on demand from stored markdown; export always redacted.
- UI toggle to show raw secrets (UI only, never in export).

## Data Model
Add new table `scan_reports`:
- `scan_id TEXT PRIMARY KEY REFERENCES scans(scan_id) ON DELETE CASCADE`
- `markdown TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `version INTEGER NOT NULL DEFAULT 1`

Update both schema sources:
- `docs/supabase/schema.sql`
- `backend/src/db.ts` in `ensureAuthSchema()`

## Backend Flow
1. Scan completes (repo scan or upload scan) for authenticated user.
2. Generate **redacted markdown snapshot** from scan + findings (grouped/deduped).
3. Insert into `scan_reports` (upsert by `scan_id` if needed).
4. Expose API endpoints (auth-only):
   - `GET /api/scans/:scanId/report` -> `{ markdown }`
   - `GET /api/scans/:scanId/report.pdf` -> `application/pdf`

### Redaction Rules
Redaction applies before storing markdown and before PDF export:
- If finding is likely secret-related (by source or classification), mask secret literals in `message` and `code`.
- Default heuristic:
  - `finding.source === 'secret-detector'` OR
  - `finding.type` or `finding.message` contains `secret|token|password|key|credential|jwt` (case-insensitive)
- Mask string literals and common token patterns to `***REDACTED***`.
- Non-secret findings remain unchanged.
- Raw findings remain stored in `scan_findings` for UI toggle.

## Frontend UX
### Report Page
- Findings view grouped by severity, then file.
- All severities collapsed by default. Expand on click.
- Each file group shows counts (unique + duplicates).
- Each finding row shows: type, message, source, AI score, code snippet (redacted default), signals hidden by default.
- Toggle: “Show raw secrets” (UI only). Never affects export.

### Markdown Rendering
- Fetch markdown snapshot via `/api/scans/:scanId/report`.
- Render to HTML inside report page (sanitized).
- Provide “Download PDF” button that hits `/api/scans/:scanId/report.pdf`.

### Dashboard History
- Use existing `/api/scans` list (auth-only).
- Add empty state if no scans.

## Markdown Snapshot Format
```
# Scan Report: <repoName>
- Scan ID: <scanId>
- Repo URL: <repoUrl>
- Created: <createdAt>

## Summary
- AI involvement: <aiPercentage>%
- Findings: <totalFindings>
- Risk density: <findingsPer1kLoc>
- Flagged ratio: <flaggedRatio>%

## Findings
### <SEVERITY>
#### <file path>
- <Finding type>: <redacted message>
  - Source: <source>
  - AI score: <aiScore>
  - Location: <file>:<line>
  - Code:
    ```
    <redacted code>
    ```
```

## Dependencies (New)
### Markdown Render (frontend)
- Preferred: `marked` + `dompurify`
- Alternatives: `markdown-it`, `react-markdown` + `rehype-sanitize`
- Reason: small/fast render + explicit sanitization

### PDF Export (backend)
- Preferred: `playwright`
- Alternatives: `puppeteer`, `md-to-pdf`
- Reason: stable headless rendering + CSS control

## Testing
- Backend:
  - Snapshot generation and redaction for secret vs non-secret findings
  - Auth-only access to report endpoints
  - PDF endpoint returns non-empty PDF bytes
- Frontend:
  - Grouping/dedupe logic
  - Collapse behavior
  - Raw secrets toggle (UI only)
  - Markdown render present

## Open Questions
None.
