---
name: insecure-defaults-code
description: 'Fail-open defaults in code: secrets that fall back to a hard-coded value when the environment variable is missing.'
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
- config
- authn
---

## When this applies

Any code that reads secrets or keys from the environment.

## How to investigate

Search for `process.env.X || "literal"`, `os.environ.get("X", "literal")` and similar fallbacks.

## Verification checklist

- Does the app start in production without the secret set? It must not.

## Fixes

Remove the fallback and fail at startup when the variable is missing.

## References

- https://cwe.mitre.org/data/definitions/1188.html

