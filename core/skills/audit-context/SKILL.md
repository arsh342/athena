---
name: audit-context
description: 'Understand a codebase before hunting for bugs: entry points, trust boundaries, data stores and who can reach what.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- audit
---

## When this applies

Start of any security review of an unfamiliar codebase, or when a finding needs context.

## How to investigate

1. List entry points (routes, CLI commands, consumers, uploads, websockets) and mark each public, authenticated or internal.
2. Draw trust boundaries: where does data cross from outside to inside, and which stores hold sensitive data?
3. Note the guards each entry point goes through (middleware, decorators, annotations).
4. Only then read individual functions, one at a time, noting what each assumes about its inputs.

## Verification checklist

- Can an unauthenticated caller reach the code?
- Which data does it touch?
- What does the caller guarantee about the input?

## Fixes

Record the map (entry points, guards, stores) with the findings so reviewers can check reachability quickly.

## References

- https://owasp.org/www-project-application-security-verification-standard/

