---
name: sharp-edges
description: Error-prone APIs and configurations that look fine but behave dangerously.
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- api-misuse
---

## When this applies

Reviewing use of APIs with surprising defaults (assert for security, loose comparisons, regex with user patterns).

## How to investigate

List the language and framework APIs with surprising defaults and check each use against the safe form.

## Verification checklist

- Is a security decision made by `assert`, loose equality or a type coercion?
- Is user input used as a pattern, format string or path?

## Fixes

Replace with the explicit safe API and add a test for the dangerous input.

## References

- https://owasp.org/

