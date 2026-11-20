# External scanner loop of core/src/scanner-registry.ts
# (runEnabledScanners). For each registered scanner, in order:
#   disabled in config        -> no progress event at all
#   enabled                   -> 'scanning', then exactly one of:
#     checkAvailable() false  -> 'skipped'  ("<name> unavailable")
#     run() throws            -> 'missing'  ("<name> failed"; the loop goes on)
#     run() succeeds          -> 'scanned'

import Base
import ./kit.bend as K

type ScannerIn is Data:
  ScannerIn{enabled: Bool, available: Bool, crashes: Bool}

type REv is Data:
  RScanning{}
  RSkipped{}
  RFailed{}
  RScanned{}

def outcome(available: Bool, crashes: Bool) -> REv:
  match available:
    case False{}:
      RSkipped{}
    case True{}:
      match crashes:
        case True{}:
          RFailed{}
        case False{}:
          RScanned{}

def events_go(enabled: Bool, available: Bool, crashes: Bool) -> List<&2, REv>:
  match enabled:
    case False{}:
      []
    case True{}:
      [RScanning{}, outcome(available, crashes)]

def events(s: ScannerIn) -> List<&2, REv>:
  match s:
    case ScannerIn{en, av, cr}:
      events_go(en, av, cr)

# The whole loop: each scanner's events, in registration order.
def run_all(ss: List<&2, ScannerIn>) -> List<&2, REv>:
  match ss:
    case Nil{}:
      []
    case Con{s, rest}:
      List.append(&2, REv, events(s), run_all(rest))

def is_start(e: REv) -> Bool:
  match e:
    case RScanning{}:
      True{}
    case _:
      False{}

def count_starts(es: List<&2, REv>) -> Nat:
  match es:
    case Nil{}:
      0n
    case Con{e, rest}:
      Nat.add(K.one_if(is_start(e)), count_starts(rest))

def count_outcomes(es: List<&2, REv>) -> Nat:
  match es:
    case Nil{}:
      0n
    case Con{e, rest}:
      Nat.add(K.one_if(Bool.not(is_start(e))), count_outcomes(rest))

def is_enabled(s: ScannerIn) -> Bool:
  match s:
    case ScannerIn{en, av, cr}:
      en

def count_enabled(ss: List<&2, ScannerIn>) -> Nat:
  match ss:
    case Nil{}:
      0n
    case Con{s, rest}:
      Nat.add(K.one_if(is_enabled(s)), count_enabled(rest))
