# Local Upload Scan Design

Supersedes: `docs/superpowers/specs/2026-05-13-local-upload-scan-design.md`

## Goal

Add local project upload scanning to web app so authenticated users can scan either:

- local folder upload
- local `.zip` upload

while keeping existing repo URL scan flow intact and preserving current terminal-style results UX.

## Current Code Reality

This design is grounded in current repo behavior, not prior assumptions:

- `frontend/src/pages/ScanPage.tsx` only supports repo URL submission today.
- `frontend/src/components/SandboxTerminal.tsx` does request/response scan execution and renders returned lines. It does not use live SSE scan streaming.
- `frontend/src/services/api.ts` has no local upload helper.
- `backend/src/server.ts` has no multipart upload route.
- `backend/src/scanner.ts` only exposes repo URL scan flow.
- Backend currently does not have multipart or zip extraction dependencies installed.

Because of that, this feature will ship against the current synchronous request/response scan contract first, while keeping the UI compatible with a later live-stream upgrade.

## Scope

In scope:

- single Scan page with source tabs: `Repo URL` and `Local Upload`
- local folder upload via browser directory picker
- local zip upload via browser file picker
- upload mode switch: `Folder` / `ZIP`
- shared backend upload endpoint with auth and size enforcement
- shared scan engine path for cloned repos and uploaded workspaces
- compact upload status panel above existing terminal
- cleanup of temporary upload workspaces after scan completion/failure

Out of scope:

- drag-and-drop uploader
- resumable/chunked uploads
- password-protected archives
- true live SSE upload streaming
- non-zip archive formats such as `.tar` or `.7z`
- retaining uploaded workspaces after scan completion

## Validated Product Decisions

- Upload mode support: both folder and zip
- Size policy: max `200MB`, delete temp data after scan
- UX placement: single Scan page with tabs
- Filtering policy: skip heavy dirs `.git`, `node_modules`, `dist`, `build`, `.next`, `.venv`
- Status UX: keep current terminal, add upload status above it

## Approaches Considered

1. Single multipart endpoint `POST /api/scans/upload` with `mode=folder|zip` and one scan page flow (**recommended**)
2. Two backend endpoints split by upload type (`/upload-folder`, `/upload-zip`)
3. Browser-normalized zip-only backend, where frontend zips folders before upload

Chosen approach: **(1)** because it adds the least API surface, fits the current Scan page best, and lets repo URL scans and upload scans converge into one backend scan-by-path execution model.

## Architecture

### Frontend

`frontend/src/pages/ScanPage.tsx` becomes a dual-source page:

- `Repo URL` tab keeps current URL form and submit behavior
- `Local Upload` tab adds:
  - upload mode switch: `Folder` / `ZIP`
  - folder input: `<input type="file" webkitdirectory multiple>`
  - zip input: `<input type="file" accept=".zip,application/zip">`
  - selected payload summary
  - validation and error state
  - submit button

`frontend/src/services/api.ts` adds:

- `startUploadScan(formData: FormData): Promise<StartScanResponse>`

`frontend/src/components/SandboxTerminal.tsx` stays structurally the same, but accepts a more general scan target model instead of assuming repo URL only.

Terminal behavior for this feature:

- upload request completes
- backend returns `{ scan, findings, lines }`
- terminal renders returned lines in the same style used today for repo scans

### Backend

`backend/src/server.ts` adds:

- `POST /api/scans/upload` (auth required)

Multipart parser responsibilities:

- enforce payload size limit `200MB`
- read `mode=folder|zip`
- collect `files[]`
- optionally accept `rootName`

`backend/src/scanner.ts` refactors into:

- repo URL scan entrypoint
- local workspace scan entrypoint
- shared internal `scanFromPath(...)` execution

The shared path-based scan flow will:

1. collect source files using existing extension allowlist
2. run `@athena/core`
3. map findings and scan summary
4. persist scan results under current user
5. return terminal lines plus final summary

## API Contract

### `POST /api/scans/upload`

Content type: `multipart/form-data`

Fields:

- `mode`: `folder | zip` (required)
- `files[]`: uploaded file parts (required)
- `rootName`: optional display name for folder mode

Response:

- same shape as current `POST /api/scans`
- `{ scan, findings, lines }`

Errors:

- `400` invalid mode, missing files, invalid zip selection, empty effective upload
- `401` unauthorized
- `413` payload too large
- `500` upload materialization, extraction, or scan failure

## Data Flow

### Repo URL Flow

1. User stays on `Repo URL`.
2. Submit sends current `POST /api/scans`.
3. Existing scan behavior remains unchanged.

### Local Upload Flow

1. User switches to `Local Upload`.
2. User chooses upload mode:
   - `Folder`
   - `ZIP`
3. User selects files.
4. Frontend filters folder-mode files under ignored heavy directories.
5. Frontend validates:
   - selection exists
   - total effective size `<= 200MB`
   - zip mode has exactly one `.zip` file
   - effective upload not empty after filtering
6. Frontend builds `FormData` with `mode`, `rootName`, and `files[]`.
7. Frontend calls `POST /api/scans/upload`.
8. Backend auth-checks request and validates payload.
9. Backend creates temporary workspace:
   - folder mode: reconstruct relative paths under workspace root
   - zip mode: save archive and extract safely into workspace root
10. Backend runs shared scan-by-path execution.
11. Backend returns final `{ scan, findings, lines }`.
12. Existing terminal panel renders returned lines and final state.
13. Backend deletes temp workspace in `finally`.

## Security and Validation

- Reject unsupported `mode` values
- Reject empty file set
- Reject upload payloads above `200MB`
- Reject zip entries with:
  - absolute paths
  - `../` traversal
  - extraction targets escaping workspace
- Skip common heavy directories in folder mode before upload submission
- Keep existing auth ownership checks identical to current scan endpoints

## Dependency Strategy

New backend dependencies required:

- `multer` for multipart parsing
- `adm-zip` for zip extraction

Alternatives considered:

- `busboy` for lower-level streaming control
- `yauzl` for stricter zip processing

Not chosen for initial implementation because feature value here is speed of delivery inside the existing Express app.

## File Change Plan

Backend:

- `backend/package.json`
  - add multipart + zip dependencies
- `backend/src/server.ts`
  - add upload route and payload validation
- `backend/src/scanner.ts`
  - extract shared scan-from-path flow
  - add local workspace scan entrypoint
- backend tests
  - upload route validation and happy paths

Frontend:

- `frontend/src/pages/ScanPage.tsx`
  - add tabs, mode switch, file inputs, upload validation UI
- `frontend/src/services/api.ts`
  - add upload submit helper
- `frontend/src/components/SandboxTerminal.tsx`
  - accept upload-triggered scan execution path without changing visual style
- frontend tests
  - tab/mode/form validation and helper coverage

## Error Handling

- Validation errors show inline on Scan page upload panel
- Scan execution failures still append terminal error output
- Cleanup failures are logged server-side but do not replace primary scan result
- Repo URL scan path remains unaffected by upload validation state

## Testing Plan

Backend:

- folder upload happy path
- zip upload happy path
- invalid mode -> `400`
- missing file -> `400`
- oversize upload -> `413`
- traversal zip payload rejected
- empty effective folder upload after filtering rejected

Frontend:

- source tab switch renders correct panel
- upload mode switch toggles correct input
- folder validation filters ignored directories
- zip validation requires single `.zip`
- `FormData` contains expected fields
- repo URL scan form still behaves as before

## Risks

- browser directory upload path metadata can vary slightly by environment
- folder uploads near size cap may stress request size/memory
- zip extraction checks must be strict enough to avoid workspace escape
- terminal remains request/response, so very large uploads may feel less live until streaming work is done later

## Acceptance Criteria

- user can choose `Repo URL` or `Local Upload` on Scan page
- local upload supports both folder and zip modes
- ignored heavy directories are skipped in folder mode
- upload payload above `200MB` is rejected with `413`
- local upload scan results appear in existing terminal-style panel
- completed upload scans persist in same scan history model as repo URL scans
- temporary upload workspace is deleted after completion/failure
- repo URL scan behavior remains unchanged
