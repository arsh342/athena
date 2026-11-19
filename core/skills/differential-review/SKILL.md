---
name: differential-review
description: 'Security-focused review of a change: what did the diff add, remove or relax, and who is affected?'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- review
---

## When this applies

Reviewing a pull request or the staged changes before commit.

## How to investigate

1. Read the diff for removed checks and widened access first.
2. For each new entry point or query, apply the audit-context steps.
3. Check whether the change breaks a convention its siblings follow (auth, ownership filter, validation).
4. Look at git history of the touched lines for earlier fixes being undone.

## Verification checklist

- Were any guards, validations or limits removed?
- Does new code follow the sibling conventions?

## Fixes

Request the missing check in the same change, with a test.

## References

- https://owasp.org/www-project-code-review-guide/

