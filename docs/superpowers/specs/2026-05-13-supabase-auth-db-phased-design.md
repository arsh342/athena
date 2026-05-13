# Supabase Auth + Database Phased Migration Design

## Goal

Migrate project to Supabase for both authentication and database while preserving current frontend/backend API contracts in first phase.

Immediate functional target:
- fix navbar stale auth state (no refresh needed)
- keep scan workflows stable during migration

## Scope

In scope:
- phased migration strategy (backend-first)
- Supabase Auth integration via backend adapter routes
- Supabase Postgres integration for scan persistence
- RLS ownership model
- frontend reactive auth state provider to remove stale navbar state

Out of scope:
- one-shot big-bang migration
- role/permission redesign
- non-auth/non-scan feature expansion

## Chosen Migration Strategy

Selected by product decision:

- **Phase style:** B (phased)
- **Implementation option:** backend-only Supabase integration first

Reason:
- lowest break risk
- preserve existing frontend contracts
- isolate migration complexity in backend

## Design §1 — Target Architecture

- Keep frontend API contract unchanged (`/api/auth/*`, `/api/scans*`).
- Backend becomes Supabase adapter:
  - Auth source: Supabase Auth
  - Data source: Supabase Postgres
- Backend verifies Supabase JWT on protected routes.
- Enable RLS on scan tables with ownership bound to `auth.uid()`.
- Use service-role backend client for privileged scan writes, keep ownership constraints on read paths.

## Design §2 — Phased Flow

### Phase 1 (now)
1. Provision Supabase project, schema, and RLS.
2. Map backend auth endpoints to Supabase Auth operations.
3. Replace backend DB internals with Supabase-backed persistence while preserving response shapes.
4. Keep frontend API calls unchanged.
5. Implement reactive frontend auth provider so navbar updates immediately on login/register/logout.

### Phase 2 (later)
1. Move frontend auth calls to Supabase client directly.
2. Retire or reduce backend auth proxy endpoints.
3. Keep scan orchestration backend-owned with service-role writes.

## Design §3 — Errors, Testing, Rollout Gates

### Error behavior
- Supabase auth failures map to existing backend error shapes (`400/401`) for compatibility.
- Refresh failure clears session cookies and resolves to unauthenticated state.
- Scan write failures set scan status `FAILED` and persist terminal error line.

### Testing
- backend contract tests for auth endpoint payload/status parity
- backend persistence tests for user isolation with Supabase tables/RLS
- frontend auth state tests: navbar updates immediately after login/register/logout (no reload)

### Rollout gates
- gate via environment switch: `AUTH_PROVIDER=supabase`
- keep fallback legacy path during validation window
- cut over after parity pass for auth + scan endpoints

## Supabase Schema Targets

- `scans`
- `scan_findings`
- `scan_terminal_lines`

Each table keyed for user ownership semantics and compatible with existing API payloads.

## Risks

- mixed-mode complexity during transition
- JWT/cookie interoperability bugs if session mapping is inconsistent
- RLS misconfiguration can over-restrict or over-expose data

Mitigation:
- strict contract tests
- staged rollout with env flag
- explicit RLS policy tests for ownership isolation

## Acceptance Criteria

- Supabase can serve as auth + database source in phase-1 backend path
- navbar updates immediately after auth transitions without manual refresh
- scan APIs keep existing response contracts
- feature flag allows rollback to legacy path during rollout
