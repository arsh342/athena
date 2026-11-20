# Athena's laws: the rules its state machines must never break.
#
# Each machine is modelled in spec/<name>.bend, mirroring the TypeScript
# it is named after. PROOF.bend proves every law below; run
#   bend PROOF.bend
# before committing. Every law states what Athena NEEDS to do; when the
# model of the current code breaks one, the checker names the failing case,
# and that case is a bug in the TypeScript to fix (not a law to weaken).

import Base
import ./spec/kit.bend as K
import ./spec/scan_job.bend as Job
import ./spec/engine.bend as Eng
import ./spec/scanner_registry.bend as Reg
import ./spec/terminal_router.bend as Router
import ./spec/terminal_socket.bend as Sock
import ./spec/web_terminal.bend as Web
import ./spec/auth_store.bend as Store
import ./spec/auth_session.bend as Sess
import ./spec/oauth.bend as OAuth
import ./spec/gate.bend as Gate

# ---------------------------------------------------------------------------
# 1. Scan job lifecycle (backend/src/scanner.ts)
# ---------------------------------------------------------------------------

# LAW: the progress bar never moves backwards.
law scan_progress_monotone:
  for p: Job.Phase
  for e: Job.Ev
  {K.nat_le(Job.progress(p), Job.progress(Job.step(e, p))) == True{} : Bool}

# LAW: progress never passes 100%.
law scan_progress_bounded:
  for p: Job.Phase
  {K.nat_le(Job.progress(p), 100n) == True{} : Bool}

# LAW: a finished scan (COMPLETED, FAILED or aborted) never changes again.
law scan_terminal_absorbing:
  for +p: Job.Phase
  for +w: K.T(Job.is_terminal(p))
  for e: Job.Ev
  {Job.step(e, p) == p : Job.Phase}

# LAW: ... not even after any sequence of further events.
law scan_terminal_replay:
  for +p: Job.Phase
  for +w: K.T(Job.is_terminal(p))
  for es: List<Job.Ev>
  {Job.replay(p, es) == p : Job.Phase}

# LAW: a scan reports RUNNING exactly while it is unfinished.
law scan_running_iff_unfinished:
  for p: Job.Phase
  {Job.is_running(Job.status(p)) == Bool.not(Job.is_terminal(p)) : Bool}

# LAW: every COMPLETED scan has a persisted row, at 100%.
law scan_completed_is_persisted:
  for +p: Job.Phase
  for w: K.T(Job.is_completed(Job.status(p)))
  {Job.is_persisted(p) == True{} : Bool}

law scan_persisted_reaches_100:
  for +p: Job.Phase
  for w: K.T(Job.is_persisted(p))
  {Job.progress(p) == 100n : Nat}

# LAW: every scan that finishes, however it finishes, is recorded in the
# scan history.
law scan_every_finished_scan_recorded:
  for +p: Job.Phase
  for w: K.T(Job.is_terminal(p))
  {Job.is_persisted(p) == True{} : Bool}

# ---------------------------------------------------------------------------
# 2. Engine file pipeline (core/src/engine.ts)
# ---------------------------------------------------------------------------

# LAW: a path that cannot be stat'ed is missing, oversized or not.
law engine_missing_wins:
  for big: Bool
  {Eng.classify(Eng.FileIn{False{}, big}) == Eng.FileMissing{} : Eng.Outcome}

# LAW: every file lands in exactly one bucket, so processedFiles (the
# progress index) always equals missing + skipped + scanned.
law engine_counts_partition:
  for +fs: List<&2, Eng.FileIn>
  {Eng.processed(fs) == Nat.add(Eng.count_missing(fs), Nat.add(Eng.count_skipped(fs), Eng.count_scanned(fs))) : Nat}

# ---------------------------------------------------------------------------
# 3. External scanner registry (core/src/scanner-registry.ts)
# ---------------------------------------------------------------------------

# LAW: a disabled scanner emits nothing.
law registry_disabled_silent:
  for av: Bool
  for cr: Bool
  {Reg.events(Reg.ScannerIn{False{}, av, cr}) == [] : List<&2, Reg.REv>}

# LAW: every enabled scanner starts exactly once ...
law registry_one_start_per_enabled:
  for +ss: List<&2, Reg.ScannerIn>
  {Reg.count_starts(Reg.run_all(ss)) == Reg.count_enabled(ss) : Nat}

# LAW: ... and reports exactly one outcome, even when another one crashes.
law registry_one_outcome_per_enabled:
  for +ss: List<&2, Reg.ScannerIn>
  {Reg.count_outcomes(Reg.run_all(ss)) == Reg.count_enabled(ss) : Nat}

# ---------------------------------------------------------------------------
# 4. Terminal command protocol (backend/src/terminal-router.ts)
# ---------------------------------------------------------------------------

# LAW: every command gets exactly one `done` ...
law router_one_done:
  for c: Router.Cmd
  for +em: List<&2, Router.Emit>
  {Router.count_done(Router.respond(c, em)) == 1n : Nat}

# LAW: ... and it is the last event the client receives.
law router_done_last:
  for c: Router.Cmd
  for +em: List<&2, Router.Emit>
  exs before: List<&2, Router.TEv>
  {Router.respond(c, em) == List.append(&2, Router.TEv, before, [Router.TDone{}]) : List<&2, Router.TEv>}

# LAW: an `error` event is sent exactly for the failing commands.
law router_error_iff_failure:
  for c: Router.Cmd
  for +em: List<&2, Router.Emit>
  {Router.has_error(Router.respond(c, em)) == Router.is_failure(c) : Bool}

# LAW: a `result` payload is sent exactly for the commands that have one.
law router_result_iff_payload:
  for c: Router.Cmd
  for +em: List<&2, Router.Emit>
  {Router.has_result(Router.respond(c, em)) == Router.yields_result(c) : Bool}

# ---------------------------------------------------------------------------
# 5. Terminal WebSocket session (backend/src/pty-handler.ts)
# ---------------------------------------------------------------------------

# LAW: client messages never change the connection state.
law socket_messages_inert:
  for s: Sock.Sock
  {Sock.step(Sock.ClientMessage{}, s) == s : Sock.Sock}

# LAW: a rejected (unauthenticated) socket never gets a session.
law socket_rejected_never_registers:
  for es: List<Sock.SEv>
  {Sock.has_session(Sock.replay(Sock.Rejected{}, es)) == False{} : Bool}

# LAW: once an open socket closes, its session is gone for good.
law socket_closed_stays_cleared:
  for es: List<Sock.SEv>
  {Sock.has_session(Sock.replay(Sock.step(Sock.ClientClose{}, Sock.Open{}), es)) == False{} : Bool}

# LAW: no terminal session outlives its socket: whatever the client does,
# a registered session always belongs to a connected client.
law socket_no_orphan_session:
  for es: List<Sock.SEv>
  s = Sock.replay(Sock.Pending{}, es)
  K.T(K.imp(Sock.has_session(s), Sock.is_connected(s)))

# ---------------------------------------------------------------------------
# 6. Web terminal connection (frontend/src/components/WebTerminal.tsx)
# ---------------------------------------------------------------------------

# LAW: reconnect attempts never exceed MAX_RECONNECT_ATTEMPTS (5).
law web_attempts_bounded:
  for es: List<Web.WEv>
  K.T(K.nat_le(Web.attempts(Web.replay(Web.init(), es)), Web.max_attempts()))

# LAW: a successful open resets the retry budget.
law web_open_resets_attempts:
  for t: Web.Term
  {Web.attempts(Web.step(Web.WOpened{}, t)) == 0n : Nat}

# LAW: a clean close never spends a retry.
law web_clean_close_no_retry:
  for +t: Web.Term
  {Web.attempts(Web.step(Web.WClosed{True{}}, t)) == Web.attempts(t) : Nat}

# LAW: the terminal gives up ('error') exactly when the budget is spent.
law web_gives_up_at_max:
  for c: Bool
  for +t: Web.Term
  {Web.is_link_error(Web.link(Web.step(Web.WClosed{c}, t))) == Bool.not(K.nat_lt(Web.attempts(t), Web.max_attempts())) : Bool}

# LAW: the terminal never prints "gate: pass" for a scan that FAILED.
law web_failed_scan_never_passes:
  for critical: Nat
  for high: Nat
  {Web.prints_gate_pass(True{}, critical, high) == False{} : Bool}

# LAW: done, error, result and close always clear the scanning indicator.
law web_scan_indicator_clears:
  for e: Web.WEv
  for t: Web.Term
  K.T(K.imp(Web.ends_scan(e), Bool.not(Web.scanning(Web.step(e, t)))))

# ---------------------------------------------------------------------------
# 7. Client auth store (frontend/src/auth/auth-store.ts)
# ---------------------------------------------------------------------------

# LAW: whatever happens, isAuthenticated is true exactly when a user is set.
law store_authed_iff_user:
  for acts: List<Store.Act>
  s = Store.replay(Store.init(), acts)
  {Store.authed(s) == Store.has_user(Store.user(s)) : Bool}

# LAW: isLoading is true exactly after BOOTSTRAP_START.
law store_loading_iff_bootstrapping:
  for a: Store.Act
  for s: Store.AuthS
  {Store.loading(Store.reduce(a, s)) == Store.is_boot_start(a) : Bool}

# LAW: signing out forgets the user.
law store_sign_out_forgets:
  for s: Store.AuthS
  {Store.has_user(Store.user(Store.reduce(Store.SignedOut{}, s))) == False{} : Bool}

# LAW: re-bootstrapping keeps the current user visible until it resolves.
law store_bootstrap_keeps_user:
  for +s: Store.AuthS
  {Store.user(Store.reduce(Store.BootStart{}, s)) == Store.user(s) : Store.Slot}

# ---------------------------------------------------------------------------
# 8. Server login sessions (backend/src/auth.ts)
# ---------------------------------------------------------------------------

# LAW: revocation is permanent.
law session_revocation_permanent:
  for +s: Sess.Sess
  for +w: K.T(Sess.revoked(s))
  for es: List<Sess.AEv>
  K.T(Sess.revoked(Sess.replay(s, es)))

# LAW: an expired access token never comes back to life.
law session_expiry_permanent:
  for +s: Sess.Sess
  for +w: K.T(Bool.not(Sess.access_live(s)))
  for es: List<Sess.AEv>
  K.T(Bool.not(Sess.access_live(Sess.replay(s, es))))

# LAW: after logout, no access token of that session works, ever.
law session_logout_is_final:
  for s: Sess.Sess
  for es: List<Sess.AEv>
  {Sess.access_ok(Sess.replay(Sess.step(Sess.Logout{}, s), es)) == False{} : Bool}

# LAW: /refresh hands out working tokens exactly when the refresh is valid.
law session_refresh_grants_iff_valid:
  for +s: Sess.Sess
  {Sess.granted(Sess.rotate(s)) == Sess.refresh_ok(s) : Bool}

# LAW: a refresh token is single-use: presenting it again is rejected.
law session_refresh_single_use:
  for s: Sess.Sess
  {Sess.is_rejected(Sess.rotate(Sess.old_of(Sess.rotate(s)))) == True{} : Bool}

# LAW: ... even when two requests present it at the same time: at most one
# of them is granted fresh tokens, however they interleave.
law session_refresh_redeemed_once:
  for i: Sess.Interleaving
  for +s: Sess.Sess
  {Sess.both_granted(Sess.redeem_twice(i, s)) == False{} : Bool}

# ---------------------------------------------------------------------------
# 9. OAuth callback (backend/src/auth-supabase.ts)
# ---------------------------------------------------------------------------

# LAW: no dashboard without a started flow (the PKCE verifier cookie).
law oauth_needs_started_flow:
  for c: OAuth.Callback
  {OAuth.is_dashboard(OAuth.outcome(OAuth.FlowIdle{}, c)) == False{} : Bool}

# LAW: any callback consumes the verifier.
law oauth_callback_consumes_verifier:
  for c: OAuth.Callback
  for f: OAuth.Flow
  {OAuth.step(OAuth.OCallback{c}, f) == OAuth.FlowIdle{} : OAuth.Flow}

# LAW: so a replayed callback can never sign anyone in.
law oauth_replay_rejected:
  for c1: OAuth.Callback
  for f: OAuth.Flow
  for c2: OAuth.Callback
  {OAuth.is_dashboard(OAuth.outcome(OAuth.step(OAuth.OCallback{c1}, f), c2)) == False{} : Bool}

# LAW: the dashboard is reached exactly when every check passes.
law oauth_dashboard_iff_all_clear:
  for +f: OAuth.Flow
  for +c: OAuth.Callback
  {OAuth.is_dashboard(OAuth.outcome(f, c)) == OAuth.all_clear(f, c) : Bool}

# LAW: every error code the backend sends has a message on the login page.
law oauth_errors_have_messages:
  for e: OAuth.OErr
  {OAuth.has_message(e) == True{} : Bool}

# ---------------------------------------------------------------------------
# 10. Commit gate and confidence bands (core/src)
# ---------------------------------------------------------------------------

# LAW: the CLI gate and the web terminal's gate always agree.
law gate_cli_matches_web:
  for +fs: List<&2, Gate.Sev>
  {Gate.blocked_cli(fs) == Gate.blocked_web(Gate.count_critical(fs), Gate.count_high(fs)) : Bool}

# LAW: MEDIUM and LOW findings alone never block a commit.
law gate_minor_never_blocks:
  for +fs: List<&2, Gate.Sev>
  for w: K.T(Gate.all_minor(fs))
  {Gate.blocked_cli(fs) == False{} : Bool}

# LAW: a higher AI score never lands in a lower confidence band.
law band_monotone:
  for +a: Nat
  for +b: Nat
  for +w: K.T(K.nat_le(a, b))
  K.T(K.nat_le(Gate.rank(Gate.band(a)), Gate.rank(Gate.band(b))))

# LAW: the band boundaries sit exactly at 40 and 70.
law band_boundaries:
  {[Gate.band(0n), Gate.band(39n), Gate.band(40n), Gate.band(69n), Gate.band(70n), Gate.band(100n)] == [Gate.BandLow{}, Gate.BandLow{}, Gate.BandUncertain{}, Gate.BandUncertain{}, Gate.BandHigh{}, Gate.BandHigh{}] : List<Gate.Band>}
