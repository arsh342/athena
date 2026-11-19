---
name: variant-analysis
description: 'From one confirmed vulnerability, find its siblings: generalize the pattern, sweep the code, validate each match.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- variants
---

## When this applies

After a vulnerability is confirmed (by a person, a test or an AI check), to find every other place with the same root cause.

## How to investigate

1. State the root cause in one sentence (for example "request value reaches a SQL string without binding").
2. Abstract the exact code shape: callee, which argument, what makes it unsafe.
3. Sweep the whole codebase for that shape (`athena variants <finding-id>`).
4. Validate each match: reachable? attacker controlled? guarded?
5. Record the confirmed cousins and add the rule to the repo so it keeps catching them.

## Verification checklist

- Did the sweep include every language and file type the root cause can appear in?
- Are guarded or unreachable matches excluded with a reason?

## Fixes

Fix the root cause once (a shared helper) rather than patching each call site.

## References

- https://owasp.org/www-community/Vulnerability_Analysis

