# Proofs of LAWS.bend. Run `bend PROOF.bend`: it prints ALL PROOFS CHECK
# only when every law in LAWS.bend holds for the models in spec/.
#
# Style: laws over finite states are proven by case analysis, where each
# case computes to {==} (or Unit{} for a K.T(..) claim) and impossible
# cases are closed by matching their Empty witness. Laws over event traces
# are proven by induction on the trace with a "one step keeps it" lemma.

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
import ./LAWS.bend as Laws

# ===========================================================================
# Kit: arithmetic and logic lemmas
# ===========================================================================

def add_succ_r(a: Nat, -b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_succ_r(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

def or_true_r(b: Bool) -> {Bool.or(b, True{}) == True{} : Bool}:
  match b:
    case True{}:
      {==}
    case False{}:
      {==}

def imp_refl(b: Bool) -> K.T(K.imp(b, b)):
  match b:
    case True{}:
      Unit{}
    case False{}:
      Unit{}

def imp_intro(p: Bool, -q: Bool, f: K.T(p) -> K.T(q)) -> K.T(K.imp(p, q)):
  match p:
    case True{}:
      f(Unit{})
    case False{}:
      Unit{}

def le_trans(x: Nat, y: Nat, z: Nat, wxy: K.T(K.nat_le(x, y)), wyz: K.T(K.nat_le(y, z))) -> K.T(K.nat_le(x, z)):
  match x:
    case 0n:
      Unit{}
    case 1n+p:
      match y:
        case 0n:
          match wxy:
        case 1n+q:
          match z:
            case 0n:
              match wyz:
            case 1n+r:
              le_trans(p, q, r, wxy, wyz)

# a <= b, so b < c implies a < c.
def lt_mono(+a: Nat, +b: Nat, +c: Nat, w: K.T(K.nat_le(a, b))) -> K.T(K.imp(K.nat_lt(b, c), K.nat_lt(a, c))):
  imp_intro(K.nat_lt(b, c), K.nat_lt(a, c), h => le_trans(1n+a, 1n+b, c, w, h))

# ===========================================================================
# 1. Scan job lifecycle
# ===========================================================================

def Laws.scan_progress_monotone(p, e):
  match p e:
    case Job.Queued{} _:
      {==}
    case Job.Cloning{} Job.StartScan{}:
      {==}
    case Job.Cloning{} Job.CloneOk{}:
      {==}
    case Job.Cloning{} Job.CloneFail{}:
      {==}
    case Job.Cloning{} Job.NoSourceFiles{}:
      {==}
    case Job.Cloning{} Job.SourceFilesFound{}:
      {==}
    case Job.Cloning{} Job.AnalysisOk{}:
      {==}
    case Job.Cloning{} Job.AnalysisCrash{}:
      {==}
    case Job.Collecting{} Job.StartScan{}:
      {==}
    case Job.Collecting{} Job.CloneOk{}:
      {==}
    case Job.Collecting{} Job.CloneFail{}:
      {==}
    case Job.Collecting{} Job.NoSourceFiles{}:
      {==}
    case Job.Collecting{} Job.SourceFilesFound{}:
      {==}
    case Job.Collecting{} Job.AnalysisOk{}:
      {==}
    case Job.Collecting{} Job.AnalysisCrash{}:
      {==}
    case Job.Analyzing{} Job.StartScan{}:
      {==}
    case Job.Analyzing{} Job.CloneOk{}:
      {==}
    case Job.Analyzing{} Job.CloneFail{}:
      {==}
    case Job.Analyzing{} Job.NoSourceFiles{}:
      {==}
    case Job.Analyzing{} Job.SourceFilesFound{}:
      {==}
    case Job.Analyzing{} Job.AnalysisOk{}:
      {==}
    case Job.Analyzing{} Job.AnalysisCrash{}:
      {==}
    case Job.Succeeded{} _:
      {==}
    case Job.SucceededEmpty{} _:
      {==}
    case Job.Errored{} _:
      {==}
    case Job.Aborted{} _:
      {==}

def Laws.scan_progress_bounded(p):
  match p:
    case Job.Queued{}:
      {==}
    case Job.Cloning{}:
      {==}
    case Job.Collecting{}:
      {==}
    case Job.Analyzing{}:
      {==}
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      {==}
    case Job.Aborted{}:
      {==}

def Laws.scan_terminal_absorbing(p, w, e):
  match p:
    case Job.Queued{}:
      match w:
    case Job.Cloning{}:
      match w:
    case Job.Collecting{}:
      match w:
    case Job.Analyzing{}:
      match w:
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      {==}
    case Job.Aborted{}:
      {==}

def Laws.scan_terminal_replay(p, w, es):
  match es:
    case Nil{}:
      {==}
    case Con{e, rest}:
      %Equal.sym(Job.Phase, Job.step(e, p), p, Laws.scan_terminal_absorbing(p, w, e)) : {Job.run(rest, _) == p : Job.Phase}
      Laws.scan_terminal_replay(p, w, rest)

def Laws.scan_running_iff_unfinished(p):
  match p:
    case Job.Queued{}:
      {==}
    case Job.Cloning{}:
      {==}
    case Job.Collecting{}:
      {==}
    case Job.Analyzing{}:
      {==}
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      {==}
    case Job.Aborted{}:
      {==}

def Laws.scan_completed_is_persisted(p, w):
  match p:
    case Job.Queued{}:
      match w:
    case Job.Cloning{}:
      match w:
    case Job.Collecting{}:
      match w:
    case Job.Analyzing{}:
      match w:
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      match w:
    case Job.Aborted{}:
      match w:

def Laws.scan_persisted_reaches_100(p, w):
  match p:
    case Job.Queued{}:
      match w:
    case Job.Cloning{}:
      match w:
    case Job.Collecting{}:
      match w:
    case Job.Analyzing{}:
      match w:
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      {==}
    case Job.Aborted{}:
      # A failed clone is now persisted as a FAILED scan at 100%.
      {==}

def Laws.scan_every_finished_scan_recorded(p, w):
  match p:
    case Job.Queued{}:
      match w:
    case Job.Cloning{}:
      match w:
    case Job.Collecting{}:
      match w:
    case Job.Analyzing{}:
      match w:
    case Job.Succeeded{}:
      {==}
    case Job.SucceededEmpty{}:
      {==}
    case Job.Errored{}:
      {==}
    case Job.Aborted{}:
      # Clone failed or timed out: runScan persists a FAILED scan, then rethrows.
      {==}

# ===========================================================================
# 2. Engine file pipeline
# ===========================================================================

def Laws.engine_missing_wins(big):
  {==}

def Laws.engine_counts_partition(fs):
  match fs:
    case Nil{}:
      {==}
    case Con{f, rest}:
      match f:
        case Eng.FileIn{ex, big}:
          match ex:
            case False{}:
              %Laws.engine_counts_partition(rest) : {1n+Eng.processed(rest) == 1n+_ : Nat}
              {==}
            case True{}:
              match big:
                case True{}:
                  %Equal.sym(Nat, Nat.add(Eng.count_missing(rest), 1n+Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest))), 1n+Nat.add(Eng.count_missing(rest), Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest))), add_succ_r(Eng.count_missing(rest), Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest)))) : {1n+Eng.processed(rest) == _ : Nat}
                  %Laws.engine_counts_partition(rest) : {1n+Eng.processed(rest) == 1n+_ : Nat}
                  {==}
                case False{}:
                  %Equal.sym(Nat, Nat.add(Eng.count_skipped(rest), 1n+Eng.count_scanned(rest)), 1n+Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest)), add_succ_r(Eng.count_skipped(rest), Eng.count_scanned(rest))) : {1n+Eng.processed(rest) == Nat.add(Eng.count_missing(rest), _) : Nat}
                  %Equal.sym(Nat, Nat.add(Eng.count_missing(rest), 1n+Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest))), 1n+Nat.add(Eng.count_missing(rest), Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest))), add_succ_r(Eng.count_missing(rest), Nat.add(Eng.count_skipped(rest), Eng.count_scanned(rest)))) : {1n+Eng.processed(rest) == _ : Nat}
                  %Laws.engine_counts_partition(rest) : {1n+Eng.processed(rest) == 1n+_ : Nat}
                  {==}

# ===========================================================================
# 3. External scanner registry
# ===========================================================================

def Laws.registry_disabled_silent(av, cr):
  {==}

def Laws.registry_one_start_per_enabled(ss):
  match ss:
    case Nil{}:
      {==}
    case Con{s, rest}:
      match s:
        case Reg.ScannerIn{en, av, cr}:
          match en:
            case False{}:
              Laws.registry_one_start_per_enabled(rest)
            case True{}:
              match av:
                case False{}:
                  %Laws.registry_one_start_per_enabled(rest) : {1n+Reg.count_starts(Reg.run_all(rest)) == 1n+_ : Nat}
                  {==}
                case True{}:
                  match cr:
                    case True{}:
                      %Laws.registry_one_start_per_enabled(rest) : {1n+Reg.count_starts(Reg.run_all(rest)) == 1n+_ : Nat}
                      {==}
                    case False{}:
                      %Laws.registry_one_start_per_enabled(rest) : {1n+Reg.count_starts(Reg.run_all(rest)) == 1n+_ : Nat}
                      {==}

def Laws.registry_one_outcome_per_enabled(ss):
  match ss:
    case Nil{}:
      {==}
    case Con{s, rest}:
      match s:
        case Reg.ScannerIn{en, av, cr}:
          match en:
            case False{}:
              Laws.registry_one_outcome_per_enabled(rest)
            case True{}:
              match av:
                case False{}:
                  %Laws.registry_one_outcome_per_enabled(rest) : {1n+Reg.count_outcomes(Reg.run_all(rest)) == 1n+_ : Nat}
                  {==}
                case True{}:
                  match cr:
                    case True{}:
                      %Laws.registry_one_outcome_per_enabled(rest) : {1n+Reg.count_outcomes(Reg.run_all(rest)) == 1n+_ : Nat}
                      {==}
                    case False{}:
                      %Laws.registry_one_outcome_per_enabled(rest) : {1n+Reg.count_outcomes(Reg.run_all(rest)) == 1n+_ : Nat}
                      {==}

# ===========================================================================
# 4. Terminal command protocol
# ===========================================================================

# Relayed scanner output never contains done, error or result events.
def relay_done(em: List<&2, Router.Emit>, -tail: List<&2, Router.TEv>) -> {Router.count_done(Router.relay(em, tail)) == Router.count_done(tail) : Nat}:
  match em:
    case Nil{}:
      {==}
    case Con{x, rest}:
      match x:
        case Router.EmLine{}:
          relay_done(rest, tail)
        case Router.EmErrorLine{}:
          relay_done(rest, tail)
        case Router.EmStatus{}:
          relay_done(rest, tail)

def relay_error(em: List<&2, Router.Emit>, -tail: List<&2, Router.TEv>) -> {Router.has_error(Router.relay(em, tail)) == Router.has_error(tail) : Bool}:
  match em:
    case Nil{}:
      {==}
    case Con{x, rest}:
      match x:
        case Router.EmLine{}:
          relay_error(rest, tail)
        case Router.EmErrorLine{}:
          relay_error(rest, tail)
        case Router.EmStatus{}:
          relay_error(rest, tail)

def relay_result(em: List<&2, Router.Emit>, -tail: List<&2, Router.TEv>) -> {Router.has_result(Router.relay(em, tail)) == Router.has_result(tail) : Bool}:
  match em:
    case Nil{}:
      {==}
    case Con{x, rest}:
      match x:
        case Router.EmLine{}:
          relay_result(rest, tail)
        case Router.EmErrorLine{}:
          relay_result(rest, tail)
        case Router.EmStatus{}:
          relay_result(rest, tail)

# Relaying before [x, done] is relaying before [x], then done.
def relay_snoc(em: List<&2, Router.Emit>, -x: Router.TEv) -> {Router.relay(em, [x, Router.TDone{}]) == List.append(&2, Router.TEv, Router.relay(em, [x]), [Router.TDone{}]) : List<&2, Router.TEv>}:
  match em:
    case Nil{}:
      {==}
    case Con{y, rest}:
      %relay_snoc(rest, x) : {Router.relay_one(y) <> Router.relay(rest, [x, Router.TDone{}]) == Router.relay_one(y) <> _ : List<&2, Router.TEv>}
      {==}

def Laws.router_one_done(c, em):
  match c:
    case Router.CmdScanResolved{}:
      %Equal.sym(Nat, Router.count_done(Router.relay(em, [Router.TResult{}, Router.TDone{}])), 1n, relay_done(em, [Router.TResult{}, Router.TDone{}])) : {_ == 1n : Nat}
      {==}
    case Router.CmdScanRejected{}:
      %Equal.sym(Nat, Router.count_done(Router.relay(em, [Router.TError{}, Router.TDone{}])), 1n, relay_done(em, [Router.TError{}, Router.TDone{}])) : {_ == 1n : Nat}
      {==}
    case Router.CmdUnknown{}:
      {==}
    case Router.CmdUpload{}:
      {==}
    case Router.CmdHelp{}:
      {==}
    case Router.CmdClear{}:
      {==}
    case Router.CmdScans{}:
      {==}
    case Router.CmdFindings{}:
      {==}
    case Router.CmdScanNoUrl{}:
      {==}

def Laws.router_done_last(c, em):
  match c:
    case Router.CmdUnknown{}:
      ([Router.TErrorLine{}, Router.TError{}], {==})
    case Router.CmdUpload{}:
      ([], {==})
    case Router.CmdHelp{}:
      ([Router.TLine{}], {==})
    case Router.CmdClear{}:
      ([Router.TResult{}], {==})
    case Router.CmdScans{}:
      ([Router.TResult{}], {==})
    case Router.CmdFindings{}:
      ([Router.TResult{}], {==})
    case Router.CmdScanNoUrl{}:
      ([Router.TError{}], {==})
    case Router.CmdScanResolved{}:
      (Router.relay(em, [Router.TResult{}]), relay_snoc(em, Router.TResult{}))
    case Router.CmdScanRejected{}:
      (Router.relay(em, [Router.TError{}]), relay_snoc(em, Router.TError{}))

def Laws.router_error_iff_failure(c, em):
  match c:
    case Router.CmdUnknown{}:
      {==}
    case Router.CmdUpload{}:
      {==}
    case Router.CmdHelp{}:
      {==}
    case Router.CmdClear{}:
      {==}
    case Router.CmdScans{}:
      {==}
    case Router.CmdFindings{}:
      {==}
    case Router.CmdScanNoUrl{}:
      {==}
    case Router.CmdScanResolved{}:
      %Equal.sym(Bool, Router.has_error(Router.relay(em, [Router.TResult{}, Router.TDone{}])), Router.has_error([Router.TResult{}, Router.TDone{}]), relay_error(em, [Router.TResult{}, Router.TDone{}])) : {_ == False{} : Bool}
      {==}
    case Router.CmdScanRejected{}:
      %Equal.sym(Bool, Router.has_error(Router.relay(em, [Router.TError{}, Router.TDone{}])), Router.has_error([Router.TError{}, Router.TDone{}]), relay_error(em, [Router.TError{}, Router.TDone{}])) : {_ == True{} : Bool}
      {==}

def Laws.router_result_iff_payload(c, em):
  match c:
    case Router.CmdUnknown{}:
      {==}
    case Router.CmdUpload{}:
      {==}
    case Router.CmdHelp{}:
      {==}
    case Router.CmdClear{}:
      {==}
    case Router.CmdScans{}:
      {==}
    case Router.CmdFindings{}:
      {==}
    case Router.CmdScanNoUrl{}:
      {==}
    case Router.CmdScanResolved{}:
      %Equal.sym(Bool, Router.has_result(Router.relay(em, [Router.TResult{}, Router.TDone{}])), Router.has_result([Router.TResult{}, Router.TDone{}]), relay_result(em, [Router.TResult{}, Router.TDone{}])) : {_ == True{} : Bool}
      {==}
    case Router.CmdScanRejected{}:
      %Equal.sym(Bool, Router.has_result(Router.relay(em, [Router.TError{}, Router.TDone{}])), Router.has_result([Router.TError{}, Router.TDone{}]), relay_result(em, [Router.TError{}, Router.TDone{}])) : {_ == False{} : Bool}
      {==}

# ===========================================================================
# 5. Terminal WebSocket session
# ===========================================================================

def Laws.socket_messages_inert(s):
  match s:
    case Sock.Pending{}:
      {==}
    case Sock.PendingClosed{}:
      {==}
    case Sock.Rejected{}:
      {==}
    case Sock.Open{}:
      {==}
    case Sock.Closed{}:
      {==}

def rejected_stays(es: List<Sock.SEv>) -> {Sock.replay(Sock.Rejected{}, es) == Sock.Rejected{} : Sock.Sock}:
  match es:
    case Nil{}:
      {==}
    case Con{e, rest}:
      rejected_stays(rest)

def closed_stays(es: List<Sock.SEv>) -> {Sock.replay(Sock.Closed{}, es) == Sock.Closed{} : Sock.Sock}:
  match es:
    case Nil{}:
      {==}
    case Con{e, rest}:
      closed_stays(rest)

def Laws.socket_rejected_never_registers(es):
  %Equal.sym(Sock.Sock, Sock.replay(Sock.Rejected{}, es), Sock.Rejected{}, rejected_stays(es)) : {Sock.has_session(_) == False{} : Bool}
  {==}

def Laws.socket_closed_stays_cleared(es):
  %Equal.sym(Sock.Sock, Sock.replay(Sock.Closed{}, es), Sock.Closed{}, closed_stays(es)) : {Sock.has_session(_) == False{} : Bool}
  {==}

def orphan_step(s: Sock.Sock, e: Sock.SEv, w: K.T(K.imp(Sock.has_session(s), Sock.is_connected(s)))) -> K.T(K.imp(Sock.has_session(Sock.step(e, s)), Sock.is_connected(Sock.step(e, s)))):
  match s e:
    case Sock.Pending{} Sock.AuthOk{}:
      Unit{}
    case Sock.Pending{} Sock.AuthFail{}:
      Unit{}
    case Sock.Pending{} Sock.ClientMessage{}:
      Unit{}
    case Sock.Pending{} Sock.ClientClose{}:
      Unit{}
    case Sock.PendingClosed{} Sock.AuthFail{}:
      Unit{}
    case Sock.PendingClosed{} Sock.ClientMessage{}:
      Unit{}
    case Sock.PendingClosed{} Sock.ClientClose{}:
      Unit{}
    case Sock.Open{} Sock.AuthOk{}:
      Unit{}
    case Sock.Open{} Sock.AuthFail{}:
      Unit{}
    case Sock.Open{} Sock.ClientMessage{}:
      Unit{}
    case Sock.Open{} Sock.ClientClose{}:
      Unit{}
    case Sock.PendingClosed{} Sock.AuthOk{}:
      # Client left before auth finished: no session is registered.
      Unit{}
    case Sock.Rejected{} _:
      Unit{}
    case Sock.Closed{} _:
      Unit{}

def orphan_run(es: List<Sock.SEv>, +s: Sock.Sock, w: K.T(K.imp(Sock.has_session(s), Sock.is_connected(s)))) -> K.T(K.imp(Sock.has_session(Sock.run(es, s)), Sock.is_connected(Sock.run(es, s)))):
  match es:
    case Nil{}:
      w
    case Con{+e, rest}:
      orphan_run(rest, Sock.step(e, s), orphan_step(s, e, w))

def Laws.socket_no_orphan_session(es):
  orphan_run(es, Sock.Pending{}, Unit{})

# ===========================================================================
# 6. Web terminal connection
# ===========================================================================

def close_bound(cl: Bool, u: Bool, -a: Nat, h: K.T(K.imp(u, K.nat_lt(a, Web.max_attempts()))), w: K.T(K.nat_le(a, Web.max_attempts()))) -> K.T(K.nat_le(Web.attempts(Web.close_pick(cl, u, a)), Web.max_attempts())):
  match cl u:
    case False{} True{}:
      h
    case True{} True{}:
      w
    case False{} False{}:
      w
    case True{} False{}:
      w

def keep_bound(e: Web.WEv, t: Web.Term, w: K.T(K.nat_le(Web.attempts(t), Web.max_attempts()))) -> K.T(K.nat_le(Web.attempts(Web.step(e, t)), Web.max_attempts())):
  match e t:
    case Web.WOpened{} Web.Term{l, a, s}:
      Unit{}
    case Web.WClosed{cl} Web.Term{l, +a, s}:
      close_bound(cl, K.nat_lt(a, Web.max_attempts()), a, imp_refl(K.nat_lt(a, Web.max_attempts())), w)
    case Web.WRetry{} Web.Term{l, a, s}:
      w
    case Web.WStatus{} Web.Term{l, a, s}:
      w
    case Web.WDone{} Web.Term{l, a, s}:
      w
    case Web.WError{} Web.Term{l, a, s}:
      w
    case Web.WResult{} Web.Term{l, a, s}:
      w
    case Web.WQueueScan{} Web.Term{l, a, s}:
      w

def bound_run(es: List<Web.WEv>, +t: Web.Term, w: K.T(K.nat_le(Web.attempts(t), Web.max_attempts()))) -> K.T(K.nat_le(Web.attempts(Web.run(es, t)), Web.max_attempts())):
  match es:
    case Nil{}:
      w
    case Con{+e, rest}:
      bound_run(rest, Web.step(e, t), keep_bound(e, t, w))

def Laws.web_attempts_bounded(es):
  bound_run(es, Web.init(), Unit{})

def Laws.web_open_resets_attempts(t):
  match t:
    case Web.Term{l, a, s}:
      {==}

def clean_keeps(u: Bool, -a: Nat) -> {Web.attempts(Web.close_pick(True{}, u, a)) == a : Nat}:
  match u:
    case True{}:
      {==}
    case False{}:
      {==}

def Laws.web_clean_close_no_retry(t):
  match t:
    case Web.Term{l, a, s}:
      clean_keeps(K.nat_lt(a, Web.max_attempts()), a)

def gives_up(cl: Bool, u: Bool, -a: Nat) -> {Web.is_link_error(Web.link(Web.close_pick(cl, u, a))) == Bool.not(u) : Bool}:
  match cl u:
    case False{} True{}:
      {==}
    case True{} True{}:
      {==}
    case False{} False{}:
      {==}
    case True{} False{}:
      {==}

def Laws.web_gives_up_at_max(c, t):
  match t:
    case Web.Term{l, a, s}:
      gives_up(c, K.nat_lt(a, Web.max_attempts()), a)

def Laws.web_failed_scan_never_passes(critical, high):
  # scanVerdict() returns 'failed' for status FAILED, whatever the counts.
  {==}

def close_stops_scan(cl: Bool, u: Bool, -a: Nat) -> K.T(Bool.not(Web.scanning(Web.close_pick(cl, u, a)))):
  match cl u:
    case False{} True{}:
      Unit{}
    case True{} True{}:
      Unit{}
    case False{} False{}:
      Unit{}
    case True{} False{}:
      Unit{}

def Laws.web_scan_indicator_clears(e, t):
  match e t:
    case Web.WClosed{cl} Web.Term{l, +a, s}:
      close_stops_scan(cl, K.nat_lt(a, Web.max_attempts()), a)
    case Web.WOpened{} Web.Term{l, a, s}:
      Unit{}
    case Web.WRetry{} Web.Term{l, a, s}:
      Unit{}
    case Web.WStatus{} Web.Term{l, a, s}:
      Unit{}
    case Web.WDone{} Web.Term{l, a, s}:
      Unit{}
    case Web.WError{} Web.Term{l, a, s}:
      Unit{}
    case Web.WResult{} Web.Term{l, a, s}:
      Unit{}
    case Web.WQueueScan{} Web.Term{l, a, s}:
      Unit{}

# ===========================================================================
# 7. Client auth store
# ===========================================================================

def store_keeps(a: Store.Act, s: Store.AuthS, h: {Store.authed(s) == Store.has_user(Store.user(s)) : Bool}) -> {Store.authed(Store.reduce(a, s)) == Store.has_user(Store.user(Store.reduce(a, s))) : Bool}:
  match a s:
    case Store.BootStart{} Store.AuthS{u, au, l}:
      h
    case Store.BootDone{nu} Store.AuthS{u, au, l}:
      {==}
    case Store.SignedIn{id} Store.AuthS{u, au, l}:
      {==}
    case Store.SignedOut{} Store.AuthS{u, au, l}:
      {==}

def store_run(acts: List<Store.Act>, +s: Store.AuthS, h: {Store.authed(s) == Store.has_user(Store.user(s)) : Bool}) -> {Store.authed(Store.run(acts, s)) == Store.has_user(Store.user(Store.run(acts, s))) : Bool}:
  match acts:
    case Nil{}:
      h
    case Con{+a, rest}:
      store_run(rest, Store.reduce(a, s), store_keeps(a, s, h))

def Laws.store_authed_iff_user(acts):
  store_run(acts, Store.init(), {==})

def Laws.store_loading_iff_bootstrapping(a, s):
  match a s:
    case Store.BootStart{} Store.AuthS{u, au, l}:
      {==}
    case Store.BootDone{nu} Store.AuthS{u, au, l}:
      {==}
    case Store.SignedIn{id} Store.AuthS{u, au, l}:
      {==}
    case Store.SignedOut{} Store.AuthS{u, au, l}:
      {==}

def Laws.store_sign_out_forgets(s):
  match s:
    case Store.AuthS{u, au, l}:
      {==}

def Laws.store_bootstrap_keeps_user(s):
  match s:
    case Store.AuthS{u, au, l}:
      {==}

# ===========================================================================
# 8. Server login sessions
# ===========================================================================

def revoked_step(e: Sess.AEv, s: Sess.Sess, w: K.T(Sess.revoked(s))) -> K.T(Sess.revoked(Sess.step(e, s))):
  match e s:
    case Sess.AccessExpires{} Sess.Sess{r, al, rl}:
      w
    case Sess.RefreshExpires{} Sess.Sess{r, al, rl}:
      w
    case Sess.Logout{} Sess.Sess{r, al, rl}:
      Unit{}

def revoked_run(es: List<Sess.AEv>, +s: Sess.Sess, w: K.T(Sess.revoked(s))) -> K.T(Sess.revoked(Sess.run(es, s))):
  match es:
    case Nil{}:
      w
    case Con{+e, rest}:
      revoked_run(rest, Sess.step(e, s), revoked_step(e, s, w))

def Laws.session_revocation_permanent(s, w, es):
  revoked_run(es, s, w)

def expired_step(e: Sess.AEv, s: Sess.Sess, w: K.T(Bool.not(Sess.access_live(s)))) -> K.T(Bool.not(Sess.access_live(Sess.step(e, s)))):
  match e s:
    case Sess.AccessExpires{} Sess.Sess{r, al, rl}:
      Unit{}
    case Sess.RefreshExpires{} Sess.Sess{r, al, rl}:
      Unit{}
    case Sess.Logout{} Sess.Sess{r, al, rl}:
      w

def expired_run(es: List<Sess.AEv>, +s: Sess.Sess, w: K.T(Bool.not(Sess.access_live(s)))) -> K.T(Bool.not(Sess.access_live(Sess.run(es, s)))):
  match es:
    case Nil{}:
      w
    case Con{+e, rest}:
      expired_run(rest, Sess.step(e, s), expired_step(e, s, w))

def Laws.session_expiry_permanent(s, w, es):
  expired_run(es, s, w)

def revoked_denies(s: Sess.Sess, w: K.T(Sess.revoked(s))) -> {Sess.access_ok(s) == False{} : Bool}:
  match s:
    case Sess.Sess{r, al, rl}:
      match r:
        case True{}:
          {==}
        case False{}:
          match w:

def revoked_run_denies(es: List<Sess.AEv>, +s: Sess.Sess, w: K.T(Sess.revoked(s))) -> {Sess.access_ok(Sess.run(es, s)) == False{} : Bool}:
  match es:
    case Nil{}:
      revoked_denies(s, w)
    case Con{+e, rest}:
      revoked_run_denies(rest, Sess.step(e, s), revoked_step(e, s, w))

def Laws.session_logout_is_final(s, es):
  match s:
    case Sess.Sess{r, al, rl}:
      revoked_run_denies(es, Sess.Sess{True{}, al, rl}, Unit{})

def Laws.session_refresh_grants_iff_valid(s):
  match s:
    case Sess.Sess{r, al, rl}:
      match r:
        case True{}:
          {==}
        case False{}:
          match rl:
            case True{}:
              {==}
            case False{}:
              {==}

def Laws.session_refresh_single_use(s):
  match s:
    case Sess.Sess{r, al, rl}:
      match r:
        case True{}:
          {==}
        case False{}:
          match rl:
            case True{}:
              {==}
            case False{}:
              {==}

def Laws.session_refresh_redeemed_once(i, s):
  match i:
    case Sess.OneAfterOther{}:
      match s:
        case Sess.Sess{r, al, rl}:
          match r:
            case True{}:
              {==}
            case False{}:
              match rl:
                case True{}:
                  {==}
                case False{}:
                  {==}
    case Sess.BothReadFirst{}:
      match s:
        case Sess.Sess{r, al, rl}:
          match r:
            case True{}:
              {==}
            case False{}:
              match rl:
                case True{}:
                  # Both requests SELECT the live row, but the conditional
                  # UPDATE matches only once: the second request is rejected.
                  {==}
                case False{}:
                  {==}

# ===========================================================================
# 9. OAuth callback
# ===========================================================================

def Laws.oauth_needs_started_flow(c):
  match c:
    case OAuth.Callback{perr, code, x}:
      match perr:
        case True{}:
          {==}
        case False{}:
          match code:
            case True{}:
              {==}
            case False{}:
              {==}

def Laws.oauth_callback_consumes_verifier(c, f):
  {==}

def Laws.oauth_replay_rejected(c1, f, c2):
  Laws.oauth_needs_started_flow(c2)

def Laws.oauth_dashboard_iff_all_clear(f, c):
  match f:
    case OAuth.FlowIdle{}:
      match c:
        case OAuth.Callback{perr, code, x}:
          match perr:
            case True{}:
              {==}
            case False{}:
              match code:
                case True{}:
                  {==}
                case False{}:
                  {==}
    case OAuth.FlowStarted{}:
      match c:
        case OAuth.Callback{perr, code, x}:
          match perr:
            case True{}:
              {==}
            case False{}:
              match code:
                case False{}:
                  {==}
                case True{}:
                  match x:
                    case OAuth.ExNoSession{}:
                      {==}
                    case OAuth.ExNoEmail{}:
                      {==}
                    case OAuth.ExThrows{}:
                      {==}
                    case OAuth.ExOk{}:
                      {==}

def Laws.oauth_errors_have_messages(e):
  match e:
    case OAuth.ErrCallbackFailed{}:
      {==}
    case OAuth.ErrOAuthFailed{}:
      {==}
    case OAuth.ErrEmailRequired{}:
      {==}
    case OAuth.ErrOAuthDisabled{}:
      {==}

# ===========================================================================
# 10. Commit gate and confidence bands
# ===========================================================================

def Laws.gate_cli_matches_web(fs):
  match fs:
    case Nil{}:
      {==}
    case Con{f, rest}:
      match f:
        case Gate.Critical{}:
          {==}
        case Gate.High{}:
          Equal.sym(Bool, Bool.or(K.is_pos(Gate.count_critical(rest)), True{}), True{}, or_true_r(K.is_pos(Gate.count_critical(rest))))
        case Gate.Medium{}:
          Laws.gate_cli_matches_web(rest)
        case Gate.Low{}:
          Laws.gate_cli_matches_web(rest)

def Laws.gate_minor_never_blocks(fs, w):
  match fs:
    case Nil{}:
      {==}
    case Con{f, rest}:
      match f:
        case Gate.Critical{}:
          match w:
        case Gate.High{}:
          match w:
        case Gate.Medium{}:
          Laws.gate_minor_never_blocks(rest, w)
        case Gate.Low{}:
          Laws.gate_minor_never_blocks(rest, w)

# The band ranks are ordered whenever "below 40" and "below 70" can only
# switch on as the score goes down.
def pick_mono(a40: Bool, a70: Bool, b40: Bool, b70: Bool, h40: K.T(K.imp(b40, a40)), h70: K.T(K.imp(b70, a70))) -> K.T(K.nat_le(Gate.rank(Gate.band_pick(a40, a70)), Gate.rank(Gate.band_pick(b40, b70)))):
  match a40 a70 b40 b70:
    case True{} _ _ _:
      Unit{}
    case False{} True{} True{} _:
      match h40:
    case False{} True{} False{} True{}:
      Unit{}
    case False{} True{} False{} False{}:
      Unit{}
    case False{} False{} True{} _:
      match h40:
    case False{} False{} False{} True{}:
      match h70:
    case False{} False{} False{} False{}:
      Unit{}

def Laws.band_monotone(a, b, w):
  pick_mono(K.nat_lt(a, 40n), K.nat_lt(a, 70n), K.nat_lt(b, 40n), K.nat_lt(b, 70n), lt_mono(a, b, 40n, w), lt_mono(a, b, 70n, w))

def Laws.band_boundaries():
  {==}
