# SSE Terminal Streaming Design

## Goal

Add real-time backend-driven scan streaming to web app and persist terminal history so users can watch live execution and revisit exact scan transcript later.

## Scope

In scope:

- real server-to-browser terminal streaming for scan execution
- persistence of terminal lines in PostgreSQL
- scan lifecycle states for running, completed, and failed scans
- historical terminal transcript fetch by `scanId`
- frontend replacement of synthetic scan progress with live backend events

Out of scope:

- bidirectional terminal commands over persistent socket
- CLI streaming changes
- advanced replay controls, filtering, or search UI for terminal history
- background worker queue or multi-instance broker coordination

## Approach

Use `SSE` plus normalized terminal-line persistence.

Why:

- browser-native server-to-client stream fits terminal log output well
- lower complexity than WebSocket for one-way event flow
- keeps transport simple inside current Express app
- persisted lines allow accurate history after scan ends or backend restarts

## Schema

### Existing `scans` table changes

No new columns required beyond current persisted summary shape, but `status` becomes active lifecycle state:

- `RUNNING`
- `COMPLETED`
- `FAILED`

Rows are created at scan start, then updated on completion or failure.

### New `scan_terminal_lines` table

- `id BIGSERIAL PRIMARY KEY`
- `scan_id TEXT NOT NULL REFERENCES scans(scan_id) ON DELETE CASCADE`
- `seq INTEGER NOT NULL`
- `kind TEXT NOT NULL`
- `text TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:

- unique index on `(scan_id, seq)`
- index on `(scan_id, created_at)`

## Backend Changes

### `backend/src/db.ts`

- add `scan_terminal_lines` table and indexes

### `backend/src/data.ts`

Split persistence API into lifecycle operations:

- `createRunningScan(userId, scan)`
- `appendTerminalLine(scanId, line)`
- `appendTerminalLines(scanId, lines)`
- `completeScan(userId, scan, findings)`
- `failScan(userId, scanId, errorLine?)`
- `getTerminalLines(scanId, userId)`

Terminal line type:

- `kind: 'input' | 'output' | 'error' | 'hint'`
- `text: string`
- `seq: number`

### Stream broker

Add lightweight in-process broker module for active scan subscriptions.

Responsibilities:

- register listeners per `scanId`
- emit structured terminal events to all active listeners
- close listener set when scan completes or fails

Non-goal:

- cross-process fanout. Current design assumes single backend instance.

### `backend/src/scanner.ts`

Change `runScan` to accept callbacks:

- `onLine(line)`
- optional `onStatus(status)`

`runScan` emits real phases during:

- scan queued
- sandbox creation
- clone start / complete
- file discovery
- engine start
- report completion
- error path

`runScan` no longer owns persistence. It only produces scan result and emits lines through callback.

### `backend/src/server.ts`

Add:

- `GET /api/scans/:scanId/stream`
- `GET /api/scans/:scanId/terminal`

Change `POST /api/scans`:

1. validate user and repo URL
2. create `RUNNING` scan row immediately
3. kick off async scan task without blocking response
4. return accepted payload with `scanId`, initial status, and metadata

During task:

- each emitted line is both persisted and pushed to broker
- on success: persist findings, update scan summary, set `COMPLETED`, emit terminal completion event
- on failure: set `FAILED`, persist terminal error line, emit failure event

SSE response format:

- `event: line` with terminal line payload
- `event: status` with lifecycle payload
- `event: done` when scan completes
- `event: error` when scan fails

## Frontend Changes

### `frontend/src/services/api.ts`

Add:

- `startScan(repoUrl)` returning immediate accepted scan descriptor, not final transcript
- `fetchScanTerminalLinesByScanId(scanId)`
- `createScanStream(scanId)` returning `EventSource`

### `frontend/src/components/SandboxTerminal.tsx`

Replace synthetic timer behavior with real stream handling.

New flow:

1. submit scan
2. receive `scanId`
3. open `EventSource` on `/api/scans/:scanId/stream`
4. append incoming terminal lines directly
5. update progress/status labels from backend events
6. on completion, close stream and optionally refresh scan summary/findings

Historical mode:

- when revisiting a scan, load `/api/scans/:scanId/terminal` and render persisted transcript

### `frontend/src/pages/ScanPage.tsx`

- trigger immediate scan creation
- pass returned `scanId` into terminal component
- stop depending on local `scanNonce` as proxy for scan lifecycle

## Data Flow

1. User submits repo URL.
2. Backend creates `RUNNING` scan row.
3. Frontend receives `scanId`.
4. Frontend opens SSE stream for that `scanId`.
5. Backend scan task emits lines.
6. Each line is persisted to `scan_terminal_lines` and pushed over SSE.
7. Backend updates scan row and findings at finish.
8. Frontend closes stream on terminal event and can later replay transcript from DB.

## Error Handling

- if scan creation fails before row insert, `POST /api/scans` returns `500`
- if scan task fails after row insert, mark scan `FAILED`
- persist final error line before sending terminal failure event
- if SSE client disconnects, scan continues and persistence continues
- reconnecting client can fetch historical transcript from `/api/scans/:scanId/terminal`

## Compatibility

Preserved:

- `GET /api/scans`
- `GET /api/scans/:scanId`
- `GET /api/scans/:scanId/findings`

Added:

- `GET /api/scans/:scanId/terminal`
- `GET /api/scans/:scanId/stream`

Changed:

- `POST /api/scans` response becomes accepted/running payload, not finished findings payload
- legacy `GET /api/terminal/scan` should either be removed or reimplemented as compatibility wrapper around new lifecycle

## Testing

Backend:

- unit test scan lifecycle persistence helpers
- unit test broker subscribe/emit/cleanup behavior
- route-level test for SSE headers and ownership checks
- test `POST /api/scans` returns `RUNNING` scan descriptor
- test terminal lines persisted in sequence order
- test completion updates scan + findings
- test failure updates status to `FAILED`

Frontend:

- test `SandboxTerminal` appends streamed lines
- test synthetic timer removed
- test reconnect/history load path uses persisted transcript endpoint

Verification:

- backend tests pass
- frontend tests pass
- full monorepo build passes

## Risks

- SSE uses in-process listener registry, so horizontal scaling needs future shared broker
- `POST /api/scans` contract change touches frontend behavior and tests
- persistence per line may increase query count; batching may be needed if scan volume rises

## Acceptance Criteria

- user sees real backend scan lines during execution
- terminal transcript survives backend restart after persistence
- scan history includes summary, findings, and terminal lines
- failed scans remain visible with error transcript
- frontend no longer fakes progress with local timer
