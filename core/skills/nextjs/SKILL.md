---
name: nextjs
description: 'Next.js: server secrets leaking into the client bundle and risky image settings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - next
  detect:
    dependencies:
    - next
    imports:
    - next
categories:
- config
---

## When this applies

Projects that depend on next.

## How to investigate

Variables prefixed NEXT_PUBLIC_ are embedded in the browser bundle. Check route handlers and server actions for session checks.

## Verification checklist

- Is any NEXT_PUBLIC_ variable a secret?
- Does each route handler check the session?

## Fixes

Move secrets to server-only variables and read them in route handlers or server actions.

## References

- https://nextjs.org/docs/app/building-your-application/configuring/environment-variables

