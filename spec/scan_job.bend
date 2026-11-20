# Scan job lifecycle: backend/src/scanner.ts (runScan, scanFromPath) and the
# ScanSummary.status column in backend/src/data.ts.
#
#   Queued --StartScan--> Cloning (status 10 "clone sandbox initialized",
#                                   then 20 "cloning repository")
#   Cloning --CloneOk--> Collecting (30 "Collecting source files")
#   Cloning --CloneFail--> Aborted   (clone error or 120 s timeout: runScan
#                                     emits 100 "Scan failed", persists a
#                                     FAILED scan row, then rethrows so the
#                                     router sends error+done)
#   Collecting --NoSourceFiles--> SucceededEmpty (100, COMPLETED, persisted)
#   Collecting --SourceFilesFound--> Analyzing (60 "Running analysis")
#   Collecting|Analyzing --AnalysisCrash--> Errored (100, FAILED, persisted)
#   Analyzing --AnalysisOk--> Succeeded (100, COMPLETED, persisted)
# Every other (event, phase) pair leaves the phase unchanged.

import Base
import ./kit.bend as K

type Phase is Data:
  Queued{}
  Cloning{}
  Collecting{}
  Analyzing{}
  Succeeded{}
  SucceededEmpty{}
  Errored{}
  Aborted{}

type Ev is Data:
  StartScan{}
  CloneOk{}
  CloneFail{}
  NoSourceFiles{}
  SourceFilesFound{}
  AnalysisOk{}
  AnalysisCrash{}

type Status is Data:
  Running{}
  Completed{}
  Failed{}

def on_queued(e: Ev) -> Phase:
  match e:
    case StartScan{}:
      Cloning{}
    case _:
      Queued{}

def on_cloning(e: Ev) -> Phase:
  match e:
    case CloneOk{}:
      Collecting{}
    case CloneFail{}:
      Aborted{}
    case _:
      Cloning{}

def on_collecting(e: Ev) -> Phase:
  match e:
    case NoSourceFiles{}:
      SucceededEmpty{}
    case SourceFilesFound{}:
      Analyzing{}
    case AnalysisCrash{}:
      Errored{}
    case _:
      Collecting{}

def on_analyzing(e: Ev) -> Phase:
  match e:
    case AnalysisOk{}:
      Succeeded{}
    case AnalysisCrash{}:
      Errored{}
    case _:
      Analyzing{}

def step(e: Ev, p: Phase) -> Phase:
  match p:
    case Queued{}:
      on_queued(e)
    case Cloning{}:
      on_cloning(e)
    case Collecting{}:
      on_collecting(e)
    case Analyzing{}:
      on_analyzing(e)
    case Succeeded{}:
      Succeeded{}
    case SucceededEmpty{}:
      SucceededEmpty{}
    case Errored{}:
      Errored{}
    case Aborted{}:
      Aborted{}

def run(es: List<Ev>, p: Phase) -> Phase:
  match es:
    case Nil{}:
      p
    case Con{e, rest}:
      run(rest, step(e, p))

def replay(p: Phase, es: List<Ev>) -> Phase:
  run(es, p)

def start() -> Phase:
  Queued{}

# The last progress percentage the client saw (emit.status in scanner.ts).
def progress(p: Phase) -> Nat:
  match p:
    case Queued{}:
      0n
    case Cloning{}:
      20n
    case Collecting{}:
      30n
    case Analyzing{}:
      60n
    case Succeeded{}:
      100n
    case SucceededEmpty{}:
      100n
    case Errored{}:
      100n
    case Aborted{}:
      100n

# What the client sees as ScanSummary.status.
def status(p: Phase) -> Status:
  match p:
    case Succeeded{}:
      Completed{}
    case SucceededEmpty{}:
      Completed{}
    case Errored{}:
      Failed{}
    case Aborted{}:
      Failed{}
    case _:
      Running{}

def is_terminal(p: Phase) -> Bool:
  match p:
    case Succeeded{}:
      True{}
    case SucceededEmpty{}:
      True{}
    case Errored{}:
      True{}
    case Aborted{}:
      True{}
    case _:
      False{}

def is_running(s: Status) -> Bool:
  match s:
    case Running{}:
      True{}
    case _:
      False{}

def is_completed(s: Status) -> Bool:
  match s:
    case Completed{}:
      True{}
    case _:
      False{}

# Did persistScan() write a scan row for this phase?
def is_persisted(p: Phase) -> Bool:
  match p:
    case Succeeded{}:
      True{}
    case SucceededEmpty{}:
      True{}
    case Errored{}:
      True{}
    case Aborted{}:
      True{}
    case _:
      False{}
