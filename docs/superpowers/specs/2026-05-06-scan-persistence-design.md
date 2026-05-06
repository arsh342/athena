# Scan Persistence Design

## Goal

Persist web `scan summaries + full findings` in PostgreSQL so scan history survives backend restarts and existing API routes continue to work with per-user isolation.

## Scope

In scope:

- persist completed scan summaries
- persist all findings for each completed scan
- scope reads by authenticated user
- preserve current backend route contracts
- replace in-memory scan store for scan history endpoints

Out of scope:

- live progress streaming
- changing frontend route structure
- retrofitting historical in-memory scans into DB
- advanced search, filtering, or analytics UI

## Approach

Use normalized storage:

- `scans` table stores one summary row per completed scan
- `scan_findings` table stores one row per finding
- `scan_id` remains stable app-visible identifier
- `user_id` ties each scan to owner

Reason:

- matches current API shape
- keeps ownership explicit
- avoids storing large opaque blobs as only source of truth
- supports future per-scan queries without redesign

## Schema

### `scans`

- `id BIGSERIAL PRIMARY KEY`
- `scan_id TEXT UNIQUE NOT NULL`
- `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `repo_name TEXT NOT NULL`
- `repo_url TEXT NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `ai_percentage INTEGER NOT NULL`
- `flagged_units INTEGER NOT NULL`
- `files_scanned INTEGER NOT NULL`
- `total_units INTEGER NOT NULL`
- `findings JSONB NOT NULL`
- `risk_density JSONB NOT NULL`
- `duration INTEGER NOT NULL`

Indexes:

- unique index on `scan_id`
- index on `(user_id, created_at DESC)`

### `scan_findings`

- `id BIGSERIAL PRIMARY KEY`
- `scan_id TEXT NOT NULL REFERENCES scans(scan_id) ON DELETE CASCADE`
- `severity TEXT NOT NULL`
- `type TEXT NOT NULL`
- `category TEXT NOT NULL`
- `message TEXT NOT NULL`
- `file TEXT NOT NULL`
- `line INTEGER NOT NULL`
- `column INTEGER NOT NULL`
- `source TEXT NOT NULL`
- `ai_score INTEGER NOT NULL`
- `code TEXT NOT NULL`
- `rule_id TEXT NOT NULL`
- `top_signals JSONB NOT NULL`

Indexes:

- index on `(scan_id)`
- index on `(scan_id, severity)`

## Backend Changes

### `backend/src/db.ts`

- extend schema bootstrap to create `scans` and `scan_findings`
- keep current auth table bootstrap intact

### `backend/src/data.ts`

- convert scan store helpers from sync in-memory accessors to async DB-backed functions
- landing content and pipeline content stay static in module
- expose:
  - `getScans(userId)`
  - `getScan(scanId, userId)`
  - `getFindings(userId)`
  - `getFindingsByScanId(scanId, userId)`
  - `addScan(userId, scan, findings)`

### `backend/src/scanner.ts`

- `runScan` continues to build `scan`, `findings`, and terminal lines
- persistence happens after scan completes successfully
- scan generation logic stays separate from storage logic

### `backend/src/server.ts`

- route handlers await async scan store helpers
- authenticated user id passed into persistence/read helpers
- route response shapes remain unchanged

## Data Flow

1. Authenticated user submits repository URL.
2. Backend validates URL and runs scan.
3. Core returns report.
4. Backend maps report to `ScanSummary` and `Finding[]`.
5. Backend inserts summary into `scans`.
6. Backend inserts findings into `scan_findings`.
7. Read endpoints load persisted records by `user_id`.

## Error Handling

- if scan execution fails, return `500` as today and persist nothing
- if summary or findings insert fails, request fails and logs backend error
- finding insert runs in transaction with scan insert so partial persistence cannot occur
- missing scan for given `scanId` and `userId` still returns `404`

## Compatibility

- frontend API contract unchanged
- `GET /api/findings` still returns findings from latest scan for authenticated user
- existing auth schema remains valid

## Testing

- replace in-memory store tests with DB-backed persistence tests
- verify:
  - insert summary and findings
  - fetch latest findings for user
  - fetch findings by `scanId`
  - user isolation across two users
  - deleting parent scan cascades findings indirectly through fixture cleanup or direct delete path
- rerun backend tests and full repo build

## Risks

- local backend tests may depend on reachable PostgreSQL unless mocked or scoped carefully
- JSONB fields must preserve current TS shapes for `findings` summary counts and `riskDensity`
- route conversion from sync to async touches multiple handlers, so type drift risk exists

## Acceptance Criteria

- backend restart no longer loses scan history
- authenticated user only sees own scans and findings
- existing frontend scan and report routes keep working without payload changes
- backend tests pass
- full monorepo build passes
