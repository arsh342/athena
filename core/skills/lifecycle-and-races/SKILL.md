---
name: lifecycle-and-races
description: 'Resources, cleanup, failure paths and concurrency: leaks, late cleanup handlers, swallowed errors, check-then-act races.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- lifecycle
- race-condition
---

## When this applies

Reviewing long-lived connections, background jobs, token and session handling, and anything that reads then writes shared state.

## How to investigate

- Acquire without release on every path (including errors).
- Registration then await then cleanup handler: a disconnect during the await leaks.
- Success status written but not the failure status.
- A catch that returns an empty value that callers read as success.
- Read a row, decide, then update by id only: two requests can both pass.

## Verification checklist

- Is the update conditional (`WHERE id = $1 AND used = false`) and its row count checked?
- Is cleanup attached before the first await?
- Does every exit path record an outcome?

## Fixes

Make updates conditional or transactional, attach cleanup first, and record failures explicitly.

## References

- https://cwe.mitre.org/data/definitions/367.html

