---
name: sharp-edges-code
description: 'Security decisions made with APIs that do not guarantee them: assert in Python.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - python
  detect:
    always: true
categories:
- api-misuse
---

## When this applies

Python code.

## How to investigate

Python strips assert statements under -O, so asserts must never enforce authorization or validation.

## Verification checklist

- Is an assert protecting a security decision?

## Fixes

Raise an explicit exception instead.

## References

- https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement

