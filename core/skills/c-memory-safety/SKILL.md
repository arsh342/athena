---
name: c-memory-safety
description: C/C++ memory safety beyond the basic unsafe-function checks.
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - c
  detect:
    always: true
categories:
- memory-safety
---

## When this applies

C and C++ code.

## How to investigate

Look at buffer lengths derived from the source (strlen) instead of the destination, variable-size stack allocations, and manual allocation arithmetic.

## Verification checklist

- Is the bound the destination size?

## Fixes

Bound by the destination size, use snprintf, calloc/reallocarray, and heap allocation for variable sizes.

## References

- https://wiki.sei.cmu.edu/confluence/display/c/

