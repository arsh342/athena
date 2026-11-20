# Command protocol of backend/src/terminal-router.ts (handleCommand): the
# TerminalEvent sequence the server sends for one command.
#
#   unknown command  -> line(error) error done   (allowlist rejection)
#   upload           -> done
#   help             -> line done
#   clear|scans|findings -> result done
#   scan (no URL)    -> error done
#   scan, runScan resolves (COMPLETED or FAILED) -> <relayed lines/status> result done
#   scan, runScan rejects (clone error/timeout)  -> <relayed lines/status> error done

import Base
import ./kit.bend as K

type Cmd is Data:
  CmdUnknown{}
  CmdUpload{}
  CmdHelp{}
  CmdClear{}
  CmdScans{}
  CmdFindings{}
  CmdScanNoUrl{}
  CmdScanResolved{}
  CmdScanRejected{}

# What the scanner emits through `emit` while a scan runs.
type Emit is Data:
  EmLine{}
  EmErrorLine{}
  EmStatus{}

type TEv is Data:
  TLine{}
  TErrorLine{}
  TStatus{}
  TResult{}
  TError{}
  TDone{}

def relay_one(x: Emit) -> TEv:
  match x:
    case EmLine{}:
      TLine{}
    case EmErrorLine{}:
      TErrorLine{}
    case EmStatus{}:
      TStatus{}

# Forward the scanner's emitted events, then the closing events.
def relay(em: List<&2, Emit>, tail: List<&2, TEv>) -> List<&2, TEv>:
  match em:
    case Nil{}:
      tail
    case Con{x, rest}:
      relay_one(x) <> relay(rest, tail)

def respond(c: Cmd, em: List<&2, Emit>) -> List<&2, TEv>:
  match c:
    case CmdUnknown{}:
      [TErrorLine{}, TError{}, TDone{}]
    case CmdUpload{}:
      [TDone{}]
    case CmdHelp{}:
      [TLine{}, TDone{}]
    case CmdClear{}:
      [TResult{}, TDone{}]
    case CmdScans{}:
      [TResult{}, TDone{}]
    case CmdFindings{}:
      [TResult{}, TDone{}]
    case CmdScanNoUrl{}:
      [TError{}, TDone{}]
    case CmdScanResolved{}:
      relay(em, [TResult{}, TDone{}])
    case CmdScanRejected{}:
      relay(em, [TError{}, TDone{}])

def is_done(e: TEv) -> Bool:
  match e:
    case TDone{}:
      True{}
    case _:
      False{}

def is_error(e: TEv) -> Bool:
  match e:
    case TError{}:
      True{}
    case _:
      False{}

def is_result(e: TEv) -> Bool:
  match e:
    case TResult{}:
      True{}
    case _:
      False{}

def count_done(es: List<&2, TEv>) -> Nat:
  match es:
    case Nil{}:
      0n
    case Con{e, rest}:
      Nat.add(K.one_if(is_done(e)), count_done(rest))

def has_error(es: List<&2, TEv>) -> Bool:
  match es:
    case Nil{}:
      False{}
    case Con{e, rest}:
      Bool.or(is_error(e), has_error(rest))

def has_result(es: List<&2, TEv>) -> Bool:
  match es:
    case Nil{}:
      False{}
    case Con{e, rest}:
      Bool.or(is_result(e), has_result(rest))

# Commands that end in an `error` event.
def is_failure(c: Cmd) -> Bool:
  match c:
    case CmdUnknown{}:
      True{}
    case CmdScanNoUrl{}:
      True{}
    case CmdScanRejected{}:
      True{}
    case _:
      False{}

# Commands that answer with a `result` payload.
def yields_result(c: Cmd) -> Bool:
  match c:
    case CmdClear{}:
      True{}
    case CmdScans{}:
      True{}
    case CmdFindings{}:
      True{}
    case CmdScanResolved{}:
      True{}
    case _:
      False{}
