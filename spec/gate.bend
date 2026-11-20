# The commit gate and the AI-confidence bands.
#
# CLI gate (core/src/report/report-generator.ts): blocked when any finding's
# severity is in config.blockOn, which defaults to ['CRITICAL', 'HIGH']
# (core/src/config.ts). `athena check` exits 1 when blocked.
# Web gate (frontend/src/components/WebTerminal.tsx): "blocked" when the
# scan summary counts critical > 0 || high > 0.
# Bands (core/src/scorer/heuristic-scorer.ts, explain):
#   score < 40 -> LOW, score < 70 -> UNCERTAIN, else HIGH.

import Base
import ./kit.bend as K

type Sev is Data:
  Critical{}
  High{}
  Medium{}
  Low{}

# config.blockOn.includes(severity), with the default blockOn.
def blocks(s: Sev) -> Bool:
  match s:
    case Critical{}:
      True{}
    case High{}:
      True{}
    case Medium{}:
      False{}
    case Low{}:
      False{}

def blocked_cli(fs: List<&2, Sev>) -> Bool:
  match fs:
    case Nil{}:
      False{}
    case Con{f, rest}:
      Bool.or(blocks(f), blocked_cli(rest))

def is_critical(s: Sev) -> Bool:
  match s:
    case Critical{}:
      True{}
    case _:
      False{}

def is_high(s: Sev) -> Bool:
  match s:
    case High{}:
      True{}
    case _:
      False{}

# summary.findings.CRITICAL / .HIGH
def count_critical(fs: List<&2, Sev>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      Nat.add(K.one_if(is_critical(f)), count_critical(rest))

def count_high(fs: List<&2, Sev>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      Nat.add(K.one_if(is_high(f)), count_high(rest))

def blocked_web(critical: Nat, high: Nat) -> Bool:
  Bool.or(K.is_pos(critical), K.is_pos(high))

def is_minor(s: Sev) -> Bool:
  Bool.not(blocks(s))

def all_minor(fs: List<&2, Sev>) -> Bool:
  match fs:
    case Nil{}:
      True{}
    case Con{f, rest}:
      Bool.and(is_minor(f), all_minor(rest))

type Band is Data:
  BandLow{}
  BandUncertain{}
  BandHigh{}

def band_pick(below40: Bool, below70: Bool) -> Band:
  match below40:
    case True{}:
      BandLow{}
    case False{}:
      match below70:
        case True{}:
          BandUncertain{}
        case False{}:
          BandHigh{}

def band(+score: Nat) -> Band:
  band_pick(K.nat_lt(score, 40n), K.nat_lt(score, 70n))

def rank(b: Band) -> Nat:
  match b:
    case BandLow{}:
      0n
    case BandUncertain{}:
      1n
    case BandHigh{}:
      2n

# unit.flagged: score >= config.threshold
def flagged(score: Nat, threshold: Nat) -> Bool:
  K.nat_le(threshold, score)
