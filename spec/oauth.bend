# OAuth (PKCE) sign-in: backend/src/auth-supabase.ts (startOAuth,
# completeOAuthCallback) and frontend/src/auth/oauth.ts.
#
# startOAuth sets the athena_oauth_verifier cookie (or clears it on error).
# completeOAuthCallback clears the cookie FIRST, then decides:
#   ?error=...                      -> /login?oauth_error=oauth_failed
#   no ?code or no verifier cookie  -> /login?oauth_error=callback_failed
#   exchange returns null / throws  -> /login?oauth_error=oauth_failed
#   session without an email        -> /login?oauth_error=email_required
#   otherwise                       -> /dashboard (tokens issued)
# With OAuth turned off, backend/src/auth.ts answers oauth_disabled.

import Base

type Flow is Data:
  FlowIdle{}
  FlowStarted{}

type Exchange is Data:
  ExNoSession{}
  ExNoEmail{}
  ExThrows{}
  ExOk{}

type Callback is Data:
  Callback{provider_error: Bool, has_code: Bool, exchange: Exchange}

type OErr is Data:
  ErrCallbackFailed{}
  ErrOAuthFailed{}
  ErrEmailRequired{}
  ErrOAuthDisabled{}

type Outcome is Data:
  ToLogin{err: OErr}
  ToDashboard{}

type OEv is Data:
  OStart{}
  OStartFails{}
  OCallback{cb: Callback}

def has_verifier(f: Flow) -> Bool:
  match f:
    case FlowIdle{}:
      False{}
    case FlowStarted{}:
      True{}

def step(e: OEv, f: Flow) -> Flow:
  match e:
    case OStart{}:
      FlowStarted{}
    case OStartFails{}:
      FlowIdle{}
    case OCallback{cb}:
      FlowIdle{}

def exchange_outcome(x: Exchange) -> Outcome:
  match x:
    case ExNoSession{}:
      ToLogin{ErrOAuthFailed{}}
    case ExNoEmail{}:
      ToLogin{ErrEmailRequired{}}
    case ExThrows{}:
      ToLogin{ErrOAuthFailed{}}
    case ExOk{}:
      ToDashboard{}

def callback_go(perr: Bool, ready: Bool, x: Exchange) -> Outcome:
  match perr:
    case True{}:
      ToLogin{ErrOAuthFailed{}}
    case False{}:
      match ready:
        case False{}:
          ToLogin{ErrCallbackFailed{}}
        case True{}:
          exchange_outcome(x)

# The redirect completeOAuthCallback answers, given the flow it found.
def outcome(f: Flow, c: Callback) -> Outcome:
  match c:
    case Callback{perr, code, x}:
      callback_go(perr, Bool.and(code, has_verifier(f)), x)

def is_dashboard(o: Outcome) -> Bool:
  match o:
    case ToDashboard{}:
      True{}
    case ToLogin{e}:
      False{}

def is_ok_exchange(x: Exchange) -> Bool:
  match x:
    case ExOk{}:
      True{}
    case _:
      False{}

# Every condition the dashboard redirect needs.
def all_clear(f: Flow, c: Callback) -> Bool:
  match c:
    case Callback{perr, code, x}:
      Bool.and(Bool.not(perr), Bool.and(Bool.and(code, has_verifier(f)), is_ok_exchange(x)))

# getOAuthErrorMessage returns a non-empty text for this code.
def has_message(e: OErr) -> Bool:
  match e:
    case ErrCallbackFailed{}:
      True{}
    case ErrOAuthFailed{}:
      True{}
    case ErrEmailRequired{}:
      True{}
    case ErrOAuthDisabled{}:
      True{}
