# Server side of the terminal WebSocket: backend/src/pty-handler.ts plus
# backend/src/terminal-session-store.ts.
#
# On 'connection' handleTerminalConnection attaches its 'close' listener BEFORE
# awaiting getAuthenticatedUser(), and checks the socket is still open before
# registering a session:
#   Pending --AuthOk--> Open        (registerTerminalSession, send session)
#   Pending --AuthFail--> Rejected  (send error, ws.close(); no session)
#   Open --ClientClose--> Closed    (clearTerminalSession)
#   Pending --ClientClose--> PendingClosed  (close listener already attached)
#   PendingClosed --AuthOk--> Closed (socket no longer open: no session is
#                                     registered, nothing to clear)
# Messages never change the connection state.

import Base

type Sock is Data:
  Pending{}
  PendingClosed{}
  Rejected{}
  Open{}
  Closed{}

type SEv is Data:
  AuthOk{}
  AuthFail{}
  ClientMessage{}
  ClientClose{}

def on_pending(e: SEv) -> Sock:
  match e:
    case AuthOk{}:
      Open{}
    case AuthFail{}:
      Rejected{}
    case ClientMessage{}:
      Pending{}
    case ClientClose{}:
      PendingClosed{}

def on_pending_closed(e: SEv) -> Sock:
  match e:
    case AuthOk{}:
      Closed{}
    case AuthFail{}:
      Rejected{}
    case _:
      PendingClosed{}

def on_open(e: SEv) -> Sock:
  match e:
    case ClientClose{}:
      Closed{}
    case _:
      Open{}

def step(e: SEv, s: Sock) -> Sock:
  match s:
    case Pending{}:
      on_pending(e)
    case PendingClosed{}:
      on_pending_closed(e)
    case Rejected{}:
      Rejected{}
    case Open{}:
      on_open(e)
    case Closed{}:
      Closed{}

def run(es: List<SEv>, s: Sock) -> Sock:
  match es:
    case Nil{}:
      s
    case Con{e, rest}:
      run(rest, step(e, s))

def replay(s: Sock, es: List<SEv>) -> Sock:
  run(es, s)

# Is there an entry for this socket in the session store?
def has_session(s: Sock) -> Bool:
  match s:
    case Open{}:
      True{}
    case _:
      False{}

# Is the client still connected?
def is_connected(s: Sock) -> Bool:
  match s:
    case Pending{}:
      True{}
    case Open{}:
      True{}
    case _:
      False{}
