---
name: gorm
description: 'GORM: Raw/Exec/Where built with fmt.Sprintf or concatenation.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - go
  frameworks:
  - gorm
  detect:
    dependencies:
    - gorm.io/gorm
    imports:
    - gorm.io/gorm
categories:
- injection
---

## When this applies

Projects that use gorm.

## How to investigate

Find raw-query escape hatches and check every one for bound parameters.

## Verification checklist

- Is the query text a literal? Are values bound separately?

## Fixes

Use bound parameters or the query builder.

## References

- https://owasp.org/www-community/attacks/SQL_Injection

