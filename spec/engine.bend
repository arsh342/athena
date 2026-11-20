# Per-file pipeline of core/src/engine.ts (scanFiles).
#
# Every input path ends in exactly one outcome, checked in this order:
#   stat() fails            -> missing   (processedFiles += 1)
#   size > maxFileSize      -> skipped   (processedFiles += 1, skippedFiles += 1)
#   otherwise               -> scanned   (parse + score + local analyzers,
#                                         processedFiles += 1)

import Base
import ./kit.bend as K

type FileIn is Data:
  FileIn{exists: Bool, oversized: Bool}

type Outcome is Data:
  FileMissing{}
  FileSkipped{}
  FileScanned{}

def classify_go(ex: Bool, big: Bool) -> Outcome:
  match ex:
    case False{}:
      FileMissing{}
    case True{}:
      match big:
        case True{}:
          FileSkipped{}
        case False{}:
          FileScanned{}

def classify(f: FileIn) -> Outcome:
  match f:
    case FileIn{ex, big}:
      classify_go(ex, big)

def is_missing(o: Outcome) -> Bool:
  match o:
    case FileMissing{}:
      True{}
    case _:
      False{}

def is_skipped(o: Outcome) -> Bool:
  match o:
    case FileSkipped{}:
      True{}
    case _:
      False{}

def is_scanned(o: Outcome) -> Bool:
  match o:
    case FileScanned{}:
      True{}
    case _:
      False{}

# processedFiles: bumped once in every branch of the loop body.
def processed(fs: List<&2, FileIn>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      1n+processed(rest)

def count_missing(fs: List<&2, FileIn>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      Nat.add(K.one_if(is_missing(classify(f))), count_missing(rest))

def count_skipped(fs: List<&2, FileIn>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      Nat.add(K.one_if(is_skipped(classify(f))), count_skipped(rest))

def count_scanned(fs: List<&2, FileIn>) -> Nat:
  match fs:
    case Nil{}:
      0n
    case Con{f, rest}:
      Nat.add(K.one_if(is_scanned(classify(f))), count_scanned(rest))
