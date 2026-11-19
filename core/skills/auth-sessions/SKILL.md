---
name: auth-sessions
description: 'Authentication and sessions: token storage, password hashing cost and token lifetime.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  - python
  detect:
    always: true
categories:
- authn
- session
---

## When this applies

Code that logs users in, stores tokens or hashes passwords.

## How to investigate

Check where tokens are stored, bcrypt cost, token expiry and refresh rotation.

## Verification checklist

- Are tokens in localStorage (readable by any script)?
- Is the password hash cost at least 10?
- Do tokens expire?

## Fixes

Store tokens in httpOnly cookies, use cost >= 10 (or argon2id), set expiresIn, rotate refresh tokens atomically.

## References

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

