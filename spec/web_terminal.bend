# Client side of the terminal: frontend/src/components/WebTerminal.tsx.
#
# State: the connection label, reconnectAttempts and the isScanning flag.
#   onopen                -> connected, attempts = 0
#   onclose(wasClean)     -> disconnected, scanning off, then
#       !wasClean && attempts < MAX_RECONNECT_ATTEMPTS -> attempts += 1 (retry timer)
#       else if attempts >= MAX_RECONNECT_ATTEMPTS     -> 'error' (gives up)
#   retry timer           -> connecting (doConnect)
#   'status' event, queued scan/upload -> scanning on
#   'done', 'error', 'result'          -> scanning off

import Base
import ./kit.bend as K

type Link is Data:
  Connecting{}
  Connected{}
  Disconnected{}
  LinkError{}

type Term is Data:
  Term{link: Link, attempts: Nat, scanning: Bool}

type WEv is Data:
  WOpened{}
  WClosed{clean: Bool}
  WRetry{}
  WStatus{}
  WDone{}
  WError{}
  WResult{}
  WQueueScan{}

# MAX_RECONNECT_ATTEMPTS
def max_attempts() -> Nat:
  5n

def init() -> Term:
  Term{Connecting{}, 0n, False{}}

# onclose, once `under` = (attempts < MAX_RECONNECT_ATTEMPTS) is known.
def close_pick(clean: Bool, under: Bool, a: Nat) -> Term:
  match clean under:
    case False{} True{}:
      Term{Disconnected{}, 1n+a, False{}}
    case _ False{}:
      Term{LinkError{}, a, False{}}
    case True{} True{}:
      Term{Disconnected{}, a, False{}}

def on_close(clean: Bool, +a: Nat) -> Term:
  close_pick(clean, K.nat_lt(a, max_attempts()), a)

def retry_link(l: Link) -> Link:
  match l:
    case Disconnected{}:
      Connecting{}
    case Connecting{}:
      Connecting{}
    case Connected{}:
      Connected{}
    case LinkError{}:
      LinkError{}

def step(e: WEv, t: Term) -> Term:
  match e t:
    case WOpened{} Term{l, a, s}:
      Term{Connected{}, 0n, s}
    case WClosed{clean} Term{l, a, s}:
      on_close(clean, a)
    case WRetry{} Term{l, a, s}:
      Term{retry_link(l), a, s}
    case WStatus{} Term{l, a, s}:
      Term{l, a, True{}}
    case WQueueScan{} Term{l, a, s}:
      Term{l, a, True{}}
    case WDone{} Term{l, a, s}:
      Term{l, a, False{}}
    case WError{} Term{l, a, s}:
      Term{l, a, False{}}
    case WResult{} Term{l, a, s}:
      Term{l, a, False{}}

def run(es: List<WEv>, t: Term) -> Term:
  match es:
    case Nil{}:
      t
    case Con{e, rest}:
      run(rest, step(e, t))

def replay(t: Term, es: List<WEv>) -> Term:
  run(es, t)

def attempts(t: Term) -> Nat:
  match t:
    case Term{l, a, s}:
      a

def scanning(t: Term) -> Bool:
  match t:
    case Term{l, a, s}:
      s

def link(t: Term) -> Link:
  match t:
    case Term{l, a, s}:
      l

def is_link_error(l: Link) -> Bool:
  match l:
    case LinkError{}:
      True{}
    case _:
      False{}

# Events after which the title bar must stop showing "scanning".
def ends_scan(e: WEv) -> Bool:
  match e:
    case WClosed{c}:
      True{}
    case WDone{}:
      True{}
    case WError{}:
      True{}
    case WResult{}:
      True{}
    case _:
      False{}

# The verdict line printed for a scan `result` payload: scanVerdict() in
# frontend/src/utils/gate.ts. A FAILED scan is a 'failed' verdict before the
# counts are looked at; otherwise any CRITICAL or HIGH finding blocks.
# ('pass (incomplete)' is still not a failure verdict, so it prints no pass
# for a failed scan either.)
def prints_gate_pass(failed: Bool, critical: Nat, high: Nat) -> Bool:
  match failed:
    case True{}:
      False{}
    case False{}:
      Bool.not(Bool.or(K.is_pos(critical), K.is_pos(high)))
