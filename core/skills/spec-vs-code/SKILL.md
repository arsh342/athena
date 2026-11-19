---
name: spec-vs-code
description: Compare what names, comments and docs promise with what the code actually does.
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- intent
---

## When this applies

When documentation, comments or function names describe security behavior (sanitizes, authenticates, validates).

## How to investigate

For each promise, find the code that fulfils it. A validator that cannot fail, a comment that says "sanitize" next to unsanitized code, or a README that claims encryption the code lacks are findings.

## Verification checklist

- Name the line that does what the comment says.
- If none exists, either implement it or correct the claim.

## Fixes

Make the code match the promise, or fix the documentation.

## References

- https://cwe.mitre.org/data/definitions/1116.html

