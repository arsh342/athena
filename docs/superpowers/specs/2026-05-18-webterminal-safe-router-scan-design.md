# WebTerminal Real-Time Scan Router Design

## Goal

Replace `SandboxTerminal` scan UX with `WebTerminal` and stream real scan events over one WebSocket channel using a safe command router.
f
Immediate functional target:
- one terminal surface in Scan page
- real backend scan progress/events (no synthetic playback)
- command allowlist only (`help`, `scan`, `scans`, `findings`, `clear`)

## Scope

In scope:
- remove `SandboxTerminal` from Scan page flow
- route repo scan + upload scan through WebTerminal command channel
- backend WS safe command router on `/ws/terminal`
- real-time line/status/result events for scan lifecycle
- retain existing auth + user-scoping rules on scan/list/findings calls

Out of scope:
- raw shell passthrough / PTY command execution
- arbitrary command execution
- replacing existing REST routes for non-terminal consumers

## Chosen Strategy

Selected by product decision:

- **Terminal surface:** WebTerminal only
- **Execution mode:** full real-time backend stream over WS
- **Command mode:** safe router only

Reason:
- best UX fidelity (real progress, single terminal)
- removes duplicated terminal concepts
- preserves security boundary (allowlist parser, no shell)

## Design §1 — Target Architecture

- ScanPage mounts only `WebTerminal` for execution output/control.
- Backend `/ws/terminal` becomes command/event protocol endpoint:
  - receives command messages
  - validates auth/session
  - dispatches only allowlisted commands
  - streams progress/output/result events
- Existing backend scan functions remain execution core:
  - `runScan()`
  - `runUploadScan()`
  - `getScans(userId)`
  - `getFindings(userId)`
- Existing HTTP endpoints can remain for compatibility, but ScanPage terminal flow uses WS path as primary.

## Design §2 — Data Flow

1. Frontend opens WS connection to `/ws/terminal`.
2. Frontend sends command event:
   - `help`
   - `scan <repo-url>`
   - `scan --upload <upload-ref>`
   - `scans`
   - `findings`
   - `clear`
3. Backend router parses and validates:
   - command is allowlisted
   - user is authenticated
   - command args are valid
4. Backend executes mapped function:
   - repo scan via `runScan`
   - upload scan via `runUploadScan`
   - listing via `getScans` / `getFindings`
5. Backend streams events in-order over same WS:
   - line events (`output`, `hint`, `error`)
   - phase/status progress
   - result payload
   - done marker
6. Frontend WebTerminal renders stream directly and updates scan state without synthetic timer logic.

## Design §3 — Error Handling, Security, Testing

### Error handling
- Unsupported command → terminal error line: unsupported command.
- Invalid repo URL → existing validator error surfaced as terminal error.
- Upload validation failures (mode/size/path) → existing upload errors surfaced in terminal.
- Backend execution failure → `error` event then `done` event.
- WS disconnect mid-scan → mark command failed in terminal and show reconnect guidance.

### Security model
- strict command allowlist parser, no fallback execution
- no PTY passthrough, no shell spawn from terminal input
- auth required for all data/scan commands
- per-user scoping preserved for scans/findings responses
- upload limits and zip path sanitization unchanged

### Testing plan
- backend WS router tests:
  - allowlist accepts valid commands
  - rejects unsupported commands
  - emits expected event sequence for each command
- backend integration tests:
  - repo scan command streams status/lines/result/done
  - upload scan command streams status/lines/result/done
  - unauthorized command attempt rejected
- frontend tests:
  - ScanPage uses WebTerminal as only scan terminal surface
  - streamed events render correctly (line/status/result/error)
  - remove synthetic SandboxTerminal-only progress behavior

## Migration Notes

- Remove ScanPage dependency on `SandboxTerminal`.
- Remove `SandboxTerminal` component and related synthetic phase logic from active Scan flow.
- Keep REST endpoints for compatibility with existing scripts/tests until terminal-router rollout complete.

## Risks

- WS protocol mismatch between FE/BE can break terminal rendering.
- long-running scans need robust reconnect/error handling to avoid stuck UI.
- upload command orchestration over WS requires careful payload/reference handling.

Mitigation:
- define explicit WS message schema and validate both sides
- add deterministic router tests for event ordering
- keep compatibility REST scan path during rollout window

## Acceptance Criteria

- Scan page uses WebTerminal only for scan execution.
- Repo and upload scans run via WS safe command router and stream real backend events.
- No synthetic phase playback remains in active Scan execution path.
- Unsupported commands never execute and always return safe error output.
- Existing auth and per-user data scoping remain intact.
