# Server-side login sessions: the auth_sessions table driven by
# backend/src/auth.ts (legacy provider).
#
# A row holds revoked_at, access_expires_at (15 min) and refresh_expires_at
# (7 days). Time and logout move it:
#   access TTL passes   -> access dead
#   refresh TTL passes  -> refresh dead (access, being shorter, is dead too)
#   POST /logout        -> revoked_at = NOW()
# POST /refresh (refreshSession) rotates: if the row is unrevoked and its
# refresh token unexpired, it is revoked and a fresh row is issued;
# otherwise 401 and the row is left as it is.

import Base

type Sess is Data:
  Sess{revoked: Bool, access_live: Bool, refresh_live: Bool}

type AEv is Data:
  AccessExpires{}
  RefreshExpires{}
  Logout{}

type Rot is Data:
  Rotated{old: Sess, fresh: Sess}
  RotRejected{old: Sess}

def fresh() -> Sess:
  Sess{False{}, True{}, True{}}

def step(e: AEv, s: Sess) -> Sess:
  match e s:
    case AccessExpires{} Sess{r, al, rl}:
      Sess{r, False{}, rl}
    case RefreshExpires{} Sess{r, al, rl}:
      Sess{r, False{}, False{}}
    case Logout{} Sess{r, al, rl}:
      Sess{True{}, al, rl}

def run(es: List<AEv>, s: Sess) -> Sess:
  match es:
    case Nil{}:
      s
    case Con{e, rest}:
      run(rest, step(e, s))

def replay(s: Sess, es: List<AEv>) -> Sess:
  run(es, s)

def revoked(s: Sess) -> Bool:
  match s:
    case Sess{r, al, rl}:
      r

def access_live(s: Sess) -> Bool:
  match s:
    case Sess{r, al, rl}:
      al

# findUserByAccessToken: revoked_at IS NULL AND access_expires_at > NOW()
def access_ok(s: Sess) -> Bool:
  match s:
    case Sess{r, al, rl}:
      Bool.and(Bool.not(r), al)

# refreshSession's guard: !revoked_at && refresh_expires_at > now
def refresh_ok(s: Sess) -> Bool:
  match s:
    case Sess{r, al, rl}:
      Bool.and(Bool.not(r), rl)

def rotate_go(r: Bool, al: Bool, rl: Bool) -> Rot:
  match r:
    case True{}:
      RotRejected{Sess{True{}, al, rl}}
    case False{}:
      match rl:
        case True{}:
          Rotated{Sess{True{}, al, True{}}, fresh()}
        case False{}:
          RotRejected{Sess{False{}, al, False{}}}

def rotate(s: Sess) -> Rot:
  match s:
    case Sess{r, al, rl}:
      rotate_go(r, al, rl)

# The row the presented refresh token points at, after the request.
def old_of(x: Rot) -> Sess:
  match x:
    case Rotated{o, n}:
      o
    case RotRejected{o}:
      o

# Did the request hand out a working access token?
def granted(x: Rot) -> Bool:
  match x:
    case Rotated{o, n}:
      access_ok(n)
    case RotRejected{o}:
      False{}

def is_rejected(x: Rot) -> Bool:
  match x:
    case Rotated{o, n}:
      False{}
    case RotRejected{o}:
      True{}

# Two requests presenting the SAME refresh token. refreshSession does a
# SELECT, then `UPDATE ... SET revoked_at = NOW() WHERE id = $1 AND
# revoked_at IS NULL RETURNING id`, and issues tokens only if a row came
# back. The two requests either run one after the other, or both SELECT
# before either UPDATE (two tabs, or React StrictMode): in the second case
# the database lets only the first UPDATE match, so the second is rejected.
type Interleaving is Data:
  OneAfterOther{}
  BothReadFirst{}

# Was each of the two requests granted fresh tokens?
type TwoGrants is Data:
  TwoGrants{first: Bool, second: Bool}

def redeem_twice(i: Interleaving, +s: Sess) -> TwoGrants:
  match i:
    case OneAfterOther{}:
      TwoGrants{refresh_ok(s), granted(rotate(old_of(rotate(s))))}
    case BothReadFirst{}:
      TwoGrants{refresh_ok(s), False{}}

def both_granted(g: TwoGrants) -> Bool:
  match g:
    case TwoGrants{a, b}:
      Bool.and(a, b)
