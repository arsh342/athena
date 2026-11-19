---
name: typeorm
description: 'TypeORM: query() built from strings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - typeorm
  detect:
    dependencies:
    - typeorm
    imports:
    - typeorm
categories:
- injection
---

## When this applies

Projects that use typeorm.

## How to investigate

Find raw-query escape hatches and check every one for bound parameters.

## Verification checklist

- Is the query text a literal? Are values bound separately?

## Fixes

Use bound parameters or the query builder.

## References

- https://owasp.org/www-community/attacks/SQL_Injection

