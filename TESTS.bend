# Scenario tests for the Athena state machines.
#
# LAWS.bend states what must hold for every input; this file replays the
# concrete flows the app actually goes through (a full repo scan, a reconnect
# storm, an OAuth replay, ...) and checks each one does what Athena needs.
# A FAIL is a bug in the TypeScript the model mirrors. The suites
# run as a balanced fork/join tree of parallel calls.
#
#   bend TESTS.bend                 run on the interpreter
#   bend TESTS.bend -o tests && ./tests   native, on every core
#
# Exits with status 1 when any scenario fails.

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
# Comparison helpers: each enum gets a numeric code.
# ---------------------------------------------------------------------------

def nat_list_eq(xs: List<&2, Nat>, ys: List<&2, Nat>) -> Bool:
  match xs:
    case Nil{}:
      match ys:
        case Nil{}:
          True{}
        case Con{y, yt}:
          False{}
    case Con{x, xt}:
      match ys:
        case Nil{}:
          False{}
        case Con{y, yt}:
          K.nat_eq(x, y) && nat_list_eq(xt, yt)

def job_code(p: Job.Phase) -> Nat:
  match p:
    case Job.Queued{}:
      0n
    case Job.Cloning{}:
      1n
    case Job.Collecting{}:
      2n
    case Job.Analyzing{}:
      3n
    case Job.Succeeded{}:
      4n
    case Job.SucceededEmpty{}:
      5n
    case Job.Errored{}:
      6n
    case Job.Aborted{}:
      7n

def reg_code(e: Reg.REv) -> Nat:
  match e:
    case Reg.RScanning{}:
      0n
    case Reg.RSkipped{}:
      1n
    case Reg.RFailed{}:
      2n
    case Reg.RScanned{}:
      3n

def reg_codes(es: List<&2, Reg.REv>) -> List<&2, Nat>:
  match es:
    case Nil{}:
      []
    case Con{e, rest}:
      reg_code(e) <> reg_codes(rest)

def tev_code(e: Router.TEv) -> Nat:
  match e:
    case Router.TLine{}:
      0n
    case Router.TErrorLine{}:
      1n
    case Router.TStatus{}:
      2n
    case Router.TResult{}:
      3n
    case Router.TError{}:
      4n
    case Router.TDone{}:
      5n

def tev_codes(es: List<&2, Router.TEv>) -> List<&2, Nat>:
  match es:
    case Nil{}:
      []
    case Con{e, rest}:
      tev_code(e) <> tev_codes(rest)

def sock_code(s: Sock.Sock) -> Nat:
  match s:
    case Sock.Pending{}:
      0n
    case Sock.PendingClosed{}:
      1n
    case Sock.Rejected{}:
      2n
    case Sock.Open{}:
      3n
    case Sock.Closed{}:
      4n

def link_code(l: Web.Link) -> Nat:
  match l:
    case Web.Connecting{}:
      0n
    case Web.Connected{}:
      1n
    case Web.Disconnected{}:
      2n
    case Web.LinkError{}:
      3n

# 0 = dashboard, 1 = callback_failed, 2 = oauth_failed, 3 = email_required,
# 4 = oauth_disabled
def oauth_code(o: OAuth.Outcome) -> Nat:
  match o:
    case OAuth.ToDashboard{}:
      0n
    case OAuth.ToLogin{e}:
      match e:
        case OAuth.ErrCallbackFailed{}:
          1n
        case OAuth.ErrOAuthFailed{}:
          2n
        case OAuth.ErrEmailRequired{}:
          3n
        case OAuth.ErrOAuthDisabled{}:
          4n

def band_code(b: Gate.Band) -> Nat:
  Gate.rank(b)

# ---------------------------------------------------------------------------
# 1. Scan job
# ---------------------------------------------------------------------------

def t_scan_happy() -> Bool:
  +p = Job.replay(Job.start(), [Job.StartScan{}, Job.CloneOk{}, Job.SourceFilesFound{}, Job.AnalysisOk{}])
  K.nat_eq(job_code(p), 4n) && Job.is_persisted(p) && K.nat_eq(Job.progress(p), 100n) && Job.is_completed(Job.status(p))

def t_scan_empty_repo() -> Bool:
  +p = Job.replay(Job.start(), [Job.StartScan{}, Job.CloneOk{}, Job.NoSourceFiles{}])
  K.nat_eq(job_code(p), 5n) && Job.is_persisted(p) && Job.is_completed(Job.status(p))

def t_scan_analysis_crash() -> Bool:
  +p = Job.replay(Job.start(), [Job.StartScan{}, Job.CloneOk{}, Job.SourceFilesFound{}, Job.AnalysisCrash{}])
  K.nat_eq(job_code(p), 6n) && Job.is_persisted(p) && Bool.not(Job.is_running(Job.status(p))) && Bool.not(Job.is_completed(Job.status(p)))

def t_scan_clone_timeout_recorded() -> Bool:
  +p = Job.replay(Job.start(), [Job.StartScan{}, Job.CloneFail{}])
  Bool.not(Job.is_running(Job.status(p))) && Job.is_persisted(p)

def t_scan_late_events_ignored() -> Bool:
  +p = Job.replay(Job.start(), [Job.StartScan{}, Job.CloneOk{}, Job.NoSourceFiles{}, Job.AnalysisCrash{}, Job.StartScan{}])
  K.nat_eq(job_code(p), 5n)

# ---------------------------------------------------------------------------
# 2-3. Engine and scanner registry
# ---------------------------------------------------------------------------

def t_engine_buckets() -> Bool:
  +fs = {[Eng.FileIn{False{}, False{}}, Eng.FileIn{True{}, True{}}, Eng.FileIn{True{}, False{}}, Eng.FileIn{True{}, False{}}] : List<&2, Eng.FileIn>}
  K.nat_eq(Eng.processed(fs), 4n) && K.nat_eq(Eng.count_missing(fs), 1n) && K.nat_eq(Eng.count_skipped(fs), 1n) && K.nat_eq(Eng.count_scanned(fs), 2n)

def t_registry_mixed() -> Bool:
  ss = {[Reg.ScannerIn{False{}, True{}, False{}}, Reg.ScannerIn{True{}, False{}, False{}}, Reg.ScannerIn{True{}, True{}, True{}}, Reg.ScannerIn{True{}, True{}, False{}}] : List<&2, Reg.ScannerIn>}
  nat_list_eq(reg_codes(Reg.run_all(ss)), [0n, 1n, 0n, 2n, 0n, 3n])

# ---------------------------------------------------------------------------
# 4-5. Terminal protocol and WebSocket session
# ---------------------------------------------------------------------------

def t_router_unknown() -> Bool:
  nat_list_eq(tev_codes(Router.respond(Router.CmdUnknown{}, [])), [1n, 4n, 5n])

def t_router_scan_resolved() -> Bool:
  em = {[Router.EmStatus{}, Router.EmLine{}, Router.EmStatus{}] : List<&2, Router.Emit>}
  nat_list_eq(tev_codes(Router.respond(Router.CmdScanResolved{}, em)), [2n, 0n, 2n, 3n, 5n])

def t_router_scan_rejected() -> Bool:
  em = {[Router.EmStatus{}, Router.EmStatus{}] : List<&2, Router.Emit>}
  nat_list_eq(tev_codes(Router.respond(Router.CmdScanRejected{}, em)), [2n, 2n, 4n, 5n])

def t_socket_lifecycle() -> Bool:
  +s = Sock.replay(Sock.Pending{}, [Sock.AuthOk{}, Sock.ClientMessage{}, Sock.ClientClose{}])
  K.nat_eq(sock_code(s), 4n) && Bool.not(Sock.has_session(s))

def t_socket_rejected() -> Bool:
  +s = Sock.replay(Sock.Pending{}, [Sock.AuthFail{}, Sock.AuthOk{}])
  K.nat_eq(sock_code(s), 2n) && Bool.not(Sock.has_session(s))

def t_socket_close_during_auth() -> Bool:
  +s = Sock.replay(Sock.Pending{}, [Sock.ClientClose{}, Sock.AuthOk{}])
  Bool.not(Sock.has_session(s))

# ---------------------------------------------------------------------------
# 6. Web terminal
# ---------------------------------------------------------------------------

def drop() -> Web.WEv:
  Web.WClosed{False{}}

def t_web_gives_up() -> Bool:
  +t = Web.replay(Web.init(), [drop(), Web.WRetry{}, drop(), Web.WRetry{}, drop(), Web.WRetry{}, drop(), Web.WRetry{}, drop(), Web.WRetry{}, drop()])
  K.nat_eq(Web.attempts(t), 5n) && K.nat_eq(link_code(Web.link(t)), 3n)

def t_web_reconnect_resets() -> Bool:
  +t = Web.replay(Web.init(), [Web.WOpened{}, drop(), Web.WRetry{}, Web.WOpened{}])
  K.nat_eq(Web.attempts(t), 0n) && K.nat_eq(link_code(Web.link(t)), 1n)

def t_web_clean_close() -> Bool:
  +t = Web.replay(Web.init(), [Web.WOpened{}, Web.WClosed{True{}}])
  K.nat_eq(Web.attempts(t), 0n) && K.nat_eq(link_code(Web.link(t)), 2n)

def t_web_failed_scan_verdict() -> Bool:
  Bool.not(Web.prints_gate_pass(True{}, 0n, 0n))

def t_web_scan_indicator() -> Bool:
  +t = Web.replay(Web.init(), [Web.WOpened{}, Web.WQueueScan{}, Web.WStatus{}, Web.WStatus{}])
  Web.scanning(t) && Bool.not(Web.scanning(Web.step(Web.WDone{}, t)))

# ---------------------------------------------------------------------------
# 7-8. Auth store and login sessions
# ---------------------------------------------------------------------------

def t_store_session_flow() -> Bool:
  +s = Store.replay(Store.init(), [Store.BootStart{}, Store.BootDone{Store.NoUser{}}, Store.SignedIn{7n}, Store.BootStart{}, Store.BootDone{Store.User{7n}}, Store.SignedOut{}])
  Bool.not(Store.authed(s)) && Bool.not(Store.loading(s)) && Bool.not(Store.has_user(Store.user(s)))

def t_store_refresh_keeps_user() -> Bool:
  +s = Store.replay(Store.init(), [Store.SignedIn{7n}, Store.BootStart{}])
  Store.authed(s) && Store.loading(s)

def t_session_rotation() -> Bool:
  +r = Sess.rotate(Sess.fresh())
  Sess.granted(r) && Sess.is_rejected(Sess.rotate(Sess.old_of(r)))

def t_session_double_refresh() -> Bool:
  Bool.not(Sess.both_granted(Sess.redeem_twice(Sess.BothReadFirst{}, Sess.fresh())))

def t_session_logout() -> Bool:
  Sess.access_ok(Sess.fresh()) && Bool.not(Sess.access_ok(Sess.step(Sess.Logout{}, Sess.fresh()))) && Sess.is_rejected(Sess.rotate(Sess.step(Sess.Logout{}, Sess.fresh())))

def t_session_access_expiry() -> Bool:
  +s = Sess.step(Sess.AccessExpires{}, Sess.fresh())
  Bool.not(Sess.access_ok(s)) && Sess.refresh_ok(s) && Sess.granted(Sess.rotate(s))

# ---------------------------------------------------------------------------
# 9. OAuth
# ---------------------------------------------------------------------------

def good_callback() -> OAuth.Callback:
  OAuth.Callback{False{}, True{}, OAuth.ExOk{}}

def t_oauth_happy() -> Bool:
  K.nat_eq(oauth_code(OAuth.outcome(OAuth.step(OAuth.OStart{}, OAuth.FlowIdle{}), good_callback())), 0n)

def t_oauth_replay() -> Bool:
  +f = OAuth.step(OAuth.OCallback{good_callback()}, OAuth.step(OAuth.OStart{}, OAuth.FlowIdle{}))
  K.nat_eq(oauth_code(OAuth.outcome(f, good_callback())), 1n)

def t_oauth_provider_error() -> Bool:
  K.nat_eq(oauth_code(OAuth.outcome(OAuth.FlowStarted{}, OAuth.Callback{True{}, True{}, OAuth.ExOk{}})), 2n)

def t_oauth_no_email() -> Bool:
  K.nat_eq(oauth_code(OAuth.outcome(OAuth.FlowStarted{}, OAuth.Callback{False{}, True{}, OAuth.ExNoEmail{}})), 3n)

# ---------------------------------------------------------------------------
# 10. Gate and bands
# ---------------------------------------------------------------------------

def t_gate() -> Bool:
  +minor = {[Gate.Low{}, Gate.Medium{}, Gate.Low{}] : List<&2, Gate.Sev>}
  +major = {[Gate.Low{}, Gate.High{}] : List<&2, Gate.Sev>}
  ok_minor = Bool.not(Gate.blocked_cli(minor)) && Bool.not(Gate.blocked_web(Gate.count_critical(minor), Gate.count_high(minor)))
  ok_major = Gate.blocked_cli(major) && Gate.blocked_web(Gate.count_critical(major), Gate.count_high(major))
  ok_minor && ok_major

def t_bands() -> Bool:
  bands = {[band_code(Gate.band(39n)), band_code(Gate.band(40n)), band_code(Gate.band(69n)), band_code(Gate.band(70n))] : List<&2, Nat>}
  nat_list_eq(bands, [0n, 1n, 1n, 2n]) && Gate.flagged(9n, 9n) && Bool.not(Gate.flagged(8n, 9n))

type Res is Data:
  Res{name: String, ok: Bool}

# ---------------------------------------------------------------------------
# Runner: suites fork in pairs, results join back into one list.
# ---------------------------------------------------------------------------

def suite_scan() -> List<&2, Res>:
  a b = t_scan_happy() t_scan_empty_repo()
  c d = t_scan_analysis_crash() t_scan_clone_timeout_recorded()
  e f = t_scan_late_events_ignored() t_engine_buckets()
  [Res{"scan: repo with sources completes at 100%", a},
   Res{"scan: empty repo completes with an empty report", b},
   Res{"scan: analysis crash is recorded as FAILED", c},
   Res{"scan: a clone timeout is recorded as FAILED", d},
   Res{"scan: events after completion are ignored", e},
   Res{"engine: 4 files -> 1 missing, 1 skipped, 2 scanned", f}]

def suite_protocol() -> List<&2, Res>:
  a b = t_registry_mixed() t_router_unknown()
  c d = t_router_scan_resolved() t_router_scan_rejected()
  e f = t_socket_lifecycle() t_socket_rejected()
  g = t_socket_close_during_auth()
  [Res{"registry: disabled, unavailable, crashing and healthy scanners", a},
   Res{"router: unknown command -> error line, error, done", b},
   Res{"router: resolved scan relays progress then result, done", c},
   Res{"router: rejected scan relays progress then error, done", d},
   Res{"socket: auth, message, close -> session cleared", e},
   Res{"socket: failed auth never registers a session", f},
   Res{"socket: leaving during auth leaves no session behind", g}]

def suite_client() -> List<&2, Res>:
  a b = t_web_gives_up() t_web_reconnect_resets()
  c d = t_web_clean_close() t_web_scan_indicator()
  e f = t_store_session_flow() t_store_refresh_keeps_user()
  g = t_web_failed_scan_verdict()
  [Res{"web: six dropped connections -> gives up after 5 retries", a},
   Res{"web: a successful reconnect resets the retry budget", b},
   Res{"web: a clean close does not retry", c},
   Res{"web: status turns the scan indicator on, done turns it off", d},
   Res{"store: bootstrap, sign in, refresh, sign out", e},
   Res{"store: refresh keeps the signed-in user while loading", f},
   Res{"web: a FAILED scan never prints gate: pass", g}]

def suite_auth() -> List<&2, Res>:
  a b = t_session_rotation() t_session_logout()
  c d = t_session_access_expiry() t_oauth_happy()
  e f = t_oauth_replay() t_oauth_provider_error()
  g h = t_oauth_no_email() t_gate()
  i j = t_bands() t_session_double_refresh()
  [Res{"session: rotation grants, the old refresh token is then rejected", a},
   Res{"session: logout kills access and refresh at once", b},
   Res{"session: expired access token, refresh still rotates", c},
   Res{"oauth: start then callback -> dashboard", d},
   Res{"oauth: replayed callback -> callback_failed", e},
   Res{"oauth: provider error -> oauth_failed", f},
   Res{"oauth: no email -> email_required", g},
   Res{"gate: LOW/MEDIUM pass, HIGH blocks, CLI and web agree", h},
   Res{"bands: 39 LOW, 40 UNCERTAIN, 70 HIGH; flagged at threshold", i},
   Res{"session: two tabs refreshing at once get one session, not two", j}]

def all_tests() -> List<&2, Res>:
  a b = suite_scan() suite_protocol()
  c d = suite_client() suite_auth()
  List.append(&2, Res, List.append(&2, Res, a, b), List.append(&2, Res, c, d))

def count_ok(rs: List<&2, Res>) -> Nat:
  match rs:
    case Nil{}:
      0n
    case Con{r, rest}:
      match r:
        case Res{name, ok}:
          Nat.add(K.one_if(ok), count_ok(rest))

def total(rs: List<&2, Res>) -> Nat:
  match rs:
    case Nil{}:
      0n
    case Con{r, rest}:
      1n+total(rest)

def line(ok: Bool, name: String) -> String:
  match ok:
    case True{}:
      "  PASS  " ++ name
    case False{}:
      "  FAIL  " ++ name

def print_all(rs: List<&2, Res>) -> IO(Unit):
  match rs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case Con{r, rest}:
      match r:
        case Res{name, ok}:
          do IO<Unit>:
            IO.print(line(ok, name))
            print_all(rest)

def finish(ok: Bool) -> IO(Unit):
  match ok:
    case True{}:
      IO.pure(Unit, Unit{})
    case False{}:
      IO.exit(1)

def main() -> IO(Unit):
  +rs = all_tests()
  +passed = count_ok(rs)
  +n = total(rs)
  do IO<Unit>:
    IO.print("Athena state machine scenarios")
    print_all(rs)
    IO.print(Nat.show(passed) ++ "/" ++ Nat.show(n) ++ " scenarios passed")
    finish(K.nat_eq(passed, n))
