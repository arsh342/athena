# Local Upload Scan Design

## Goal

Add local project upload scanning to web app so authenticated users can scan either:

- local folder upload
- local `.zip` upload

while keeping existing repo URL scan flow and live SSE terminal behavior intact.

## Scope

In scope:

- Scan page tabbed UX: `Repo URL` and `Local Upload`
- Folder upload via browser directory picker
- ZIP upload via browser file picker
- Shared backend upload endpoint with auth and size enforcement
- Reuse existing scan lifecycle persistence and SSE streaming
- Temporary workspace cleanup after scan completion/failure

Out of scope:

- drag-and-drop uploader
- resumable/chunked uploads
- password-protected archives
- scan artifact retention after completion
- non-zip archive formats (`.tar`, `.7z`)

## Validated Product Decisions

- Upload mode support: both folder and zip
- Size policy: max `200MB`, delete temp data after scan
- UX placement: single Scan page with tabs

## Approaches Considered

1. Single multipart endpoint (`POST /api/scans/upload`) with `mode=folder|zip` (**recommended**)
2. Two endpoints (`/api/scans/upload-folder`, `/api/scans/upload-zip`) with shared service
3. Browser-normalized upload (frontend zips folder, backend accepts zip only)

Chosen approach: **(1)** because it minimizes API surface growth, preserves one frontend submit path, and reuses current scan lifecycle + stream model with least churn.

## Architecture

### Frontend

`frontend/src/pages/ScanPage.tsx` becomes tabbed:

- `Repo URL` tab keeps current form and behavior
- `Local Upload` tab adds:
  - folder input: `<input type="file" webkitdirectory multiple>`
  - zip input: `<input type="file" accept=".zip,application/zip">`
  - mode toggle (`Folder` / `ZIP`)
  - validation/error state
  - submit button

`frontend/src/services/api.ts` adds:

- `startUploadScan(formData: FormData): Promise<StartScanResponse>`

`SandboxTerminal` flow stays same:

- gets `scanId`
- subscribes to `/api/scans/:scanId/stream`
- renders line/status/done/failure events

### Backend

`backend/src/server.ts` adds:

- `POST /api/scans/upload` (auth required)
- multipart parsing with `multer` (already present dependency)
- payload enforcement:
  - `mode` required and must be `folder|zip`
  - uploaded payload required
  - total payload size <= `200MB` (respond `413` on exceed)

`backend/src/scanner.ts` refactor:

- keep `runScan(repoUrl)` behavior for URL scans
- extract shared internal scan-by-path execution logic
- add workspace scan entrypoint for local uploads

Upload route lifecycle mirrors existing URL scan route:

1. create `RUNNING` scan row
2. return `202 { scan }`
3. async process upload workspace
4. emit/persist terminal lines and statuses
5. complete or fail scan
6. cleanup workspace

## API Contract

### `POST /api/scans/upload`

Content type: `multipart/form-data`

Fields:

- `mode`: `folder | zip` (required)
- `files[]`: uploaded file parts (required)
- `rootName`: optional display name for folder mode

Response:

- `202` with running scan descriptor `{ scan }` on accept
- same shape as current `POST /api/scans` accepted payload

Errors:

- `400` invalid mode or missing files
- `401` unauthorized
- `413` payload too large
- `500` server failure during acceptance

## Data Flow

1. User picks tab `Local Upload`.
2. User chooses mode + file(s).
3. Frontend validates mode, presence, and estimated size <= 200MB.
4. Frontend sends multipart to `POST /api/scans/upload`.
5. Backend creates `RUNNING` scan record and returns `scanId`.
6. Backend prepares temp workspace:
   - folder mode: reconstruct paths under workspace root
   - zip mode: extract archive into workspace root
7. Backend collects source files and runs core engine on workspace path.
8. Terminal lines/status events persist and stream through existing scan SSE.
9. Backend marks scan `COMPLETED` or `FAILED`.
10. Backend deletes temp workspace in `finally`.

## Security and Validation

- Reject zip path traversal (`../`), absolute paths, and extraction escapes
- Reject symlink extraction targets that resolve outside workspace
- Reject unsupported mode values
- Enforce upload byte limit at parser layer and validation layer
- Keep auth ownership checks identical to existing scan endpoints

## Dependency Strategy

No new dependency required for planned implementation.

Existing deps already cover feature:

- `multer` for multipart parsing
- `adm-zip` for zip extraction

Alternatives considered (not chosen):

- `busboy` (stream-first, but more wiring than needed)
- `yauzl` (safer low-level zip processing, but higher implementation complexity)

## Backend Change List

- `backend/src/server.ts`
  - add upload route
  - add multer middleware config with size cap
  - integrate upload lifecycle with current scan persistence/stream system
- `backend/src/scanner.ts`
  - extract shared scan-from-path engine
  - keep repo clone path
  - add upload workspace path
- `backend/src/data.ts` and stream modules
  - no API shape change expected; reuse existing lifecycle helpers

## Frontend Change List

- `frontend/src/pages/ScanPage.tsx`
  - add tabs and upload form UX
- `frontend/src/services/api.ts`
  - add upload start API helper
- `frontend/src/components/SandboxTerminal.tsx`
  - no behavior change required beyond receiving `scanId` from either start path

## Error Handling

- Upload acceptance errors return explicit HTTP code and message
- Async scan failures:
  - persist scan as `FAILED`
  - emit failure SSE event
  - record terminal error line
- Cleanup errors do not mask primary scan result, but are logged with scan context

## Testing Plan

Backend:

- folder upload happy path
- zip upload happy path
- invalid mode/missing file -> `400`
- oversize payload -> `413`
- traversal/escape zip payload rejected
- scan failure path sets `FAILED` and emits failure event

Frontend:

- tab switch renders correct form
- upload validation blocks invalid submit
- multipart request sent with expected fields
- scan start returns `scanId` and terminal stream attaches as today

Regression:

- existing repo URL scan flow unchanged
- existing scan history/findings/terminal routes unchanged

## Risks

- Browser folder upload path metadata differences across environments may require normalization
- Large uploads near 200MB may stress memory if not streamed carefully
- Zip safety checks must be strict to avoid filesystem escape vulnerabilities

## Acceptance Criteria

- user can start scan from either local folder or zip upload in Scan page tabbed UI
- upload payload above 200MB is rejected with `413`
- local upload scans stream live terminal output using existing SSE route
- completed/failed upload scans persist in same history model as URL scans
- temp upload workspace is deleted after scan terminal state
- repo URL scan behavior remains unchanged
