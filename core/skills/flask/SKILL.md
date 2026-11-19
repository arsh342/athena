---
name: flask
description: 'Flask: CORS and session cookie settings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - python
  frameworks:
  - flask
  detect:
    dependencies:
    - flask
    imports:
    - flask
categories:
- cors
- session
---

## When this applies

Projects that import flask.

## How to investigate

Check config for SESSION_COOKIE_* flags and flask-cors options.

## Verification checklist

- Are session cookies Secure and HttpOnly?

## Fixes

Set SESSION_COOKIE_SECURE=True and list CORS origins.

## References

- https://flask.palletsprojects.com/en/latest/security/

