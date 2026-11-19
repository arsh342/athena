---
name: ai-generated-code
description: 'Flaws AI-written code shows most often: open CORS defaults and credentials in logs (and, via the core checks, invented packages and APIs).'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  - python
  - go
  detect:
    always: true
categories:
- ai-code
- cors
- info-leak
---

## When this applies

Any codebase, most useful where the AI estimate is high.

## How to investigate

AI assistants favour permissive defaults (CORS *, debug logging, verify=False) and may log secrets while debugging. Also check for packages and APIs that do not exist.

## Verification checklist

- Is CORS open to every origin?
- Do log statements print passwords, tokens or keys?

## Fixes

Restrict CORS, remove debug logging of secrets, verify every dependency exists and is the intended one.

## References

- https://www.veracode.com/state-of-software-security-report

