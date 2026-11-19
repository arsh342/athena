---
name: prisma
description: 'Prisma: unsafe raw query APIs built from strings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - prisma
  detect:
    dependencies:
    - '@prisma/client'
    - prisma
    imports:
    - '@prisma/client'
categories:
- injection
---

## When this applies

Projects that use prisma.

## How to investigate

Find raw-query escape hatches and check every one for bound parameters.

## Verification checklist

- Is the query text a literal? Are values bound separately?

## Fixes

Use bound parameters or the query builder.

## References

- https://owasp.org/www-community/attacks/SQL_Injection

