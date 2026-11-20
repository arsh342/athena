# Client auth state: frontend/src/auth/auth-store.ts (authReducer), driven
# by frontend/src/hooks/useAuth.ts.

import Base

type Slot is Data:
  NoUser{}
  User{id: Nat}

type AuthS is Data:
  AuthS{user: Slot, authed: Bool, loading: Bool}

type Act is Data:
  BootStart{}
  BootDone{user: Slot}
  SignedIn{id: Nat}
  SignedOut{}

def has_user(u: Slot) -> Bool:
  match u:
    case NoUser{}:
      False{}
    case User{id}:
      True{}

def init() -> AuthS:
  AuthS{NoUser{}, False{}, True{}}

def reduce(a: Act, s: AuthS) -> AuthS:
  match a s:
    case BootStart{} AuthS{u, au, l}:
      AuthS{u, au, True{}}
    case BootDone{+nu} _:
      AuthS{nu, has_user(nu), False{}}
    case SignedIn{id} _:
      AuthS{User{id}, True{}, False{}}
    case SignedOut{} _:
      AuthS{NoUser{}, False{}, False{}}

def run(acts: List<Act>, s: AuthS) -> AuthS:
  match acts:
    case Nil{}:
      s
    case Con{a, rest}:
      run(rest, reduce(a, s))

def replay(s: AuthS, acts: List<Act>) -> AuthS:
  run(acts, s)

def user(s: AuthS) -> Slot:
  match s:
    case AuthS{u, au, l}:
      u

def authed(s: AuthS) -> Bool:
  match s:
    case AuthS{u, au, l}:
      au

def loading(s: AuthS) -> Bool:
  match s:
    case AuthS{u, au, l}:
      l

def is_boot_start(a: Act) -> Bool:
  match a:
    case BootStart{}:
      True{}
    case _:
      False{}
