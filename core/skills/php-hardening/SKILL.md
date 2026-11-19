---
name: php-hardening
description: 'PHP pitfalls: legacy eval-like regex flags and loose hash comparison.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - php
  detect:
    always: true
categories:
- injection
- crypto
---

## When this applies

PHP code.

## How to investigate

Search for preg_replace with /e, and for == comparisons between hashes ("magic hashes").

## Verification checklist

- Is a hash compared with == instead of hash_equals?

## Fixes

Use preg_replace_callback and hash_equals.

## References

- https://www.php.net/manual/en/function.hash-equals.php

