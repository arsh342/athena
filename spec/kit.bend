# Shared vocabulary for the Athena specs: Boolean reflection and the Nat
# comparisons the TypeScript code uses (`<`, `<=`, `===`, `> 0`).

import Base

# T(b): the truth of b as a type. Unit when True, Empty when False, so a
# law `T(check(..))` is proven by computing check(..) to True.
def T(b: Bool) -> Data:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

# a implies b
def imp(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      b
    case False{}:
      True{}

# a <= b
def nat_le(a: Nat, b: Nat) -> Bool:
  match a:
    case 0n:
      True{}
    case 1n+p:
      match b:
        case 0n:
          False{}
        case 1n+q:
          nat_le(p, q)

# a < b
def nat_lt(a: Nat, b: Nat) -> Bool:
  nat_le(1n+a, b)

# a === b
def nat_eq(a: Nat, b: Nat) -> Bool:
  match a:
    case 0n:
      match b:
        case 0n:
          True{}
        case 1n+q:
          False{}
    case 1n+p:
      match b:
        case 0n:
          False{}
        case 1n+q:
          nat_eq(p, q)

# n > 0
def is_pos(n: Nat) -> Bool:
  match n:
    case 0n:
      False{}
    case 1n+p:
      True{}

# 1 when b holds, else 0: how the TS code bumps a counter on a condition.
def one_if(b: Bool) -> Nat:
  match b:
    case True{}:
      1n
    case False{}:
      0n
