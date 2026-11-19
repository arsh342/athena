---
name: efcore
description: 'Entity Framework Core: FromSqlRaw built from strings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - csharp
  frameworks:
  - efcore
  detect:
    dependencies:
    - microsoft.entityframeworkcore
    imports:
    - Microsoft.EntityFrameworkCore
categories:
- injection
---

## When this applies

Projects that use efcore.

## How to investigate

Find raw-query escape hatches and check every one for bound parameters.

## Verification checklist

- Is the query text a literal? Are values bound separately?

## Fixes

Use bound parameters or the query builder.

## References

- https://owasp.org/www-community/attacks/SQL_Injection

