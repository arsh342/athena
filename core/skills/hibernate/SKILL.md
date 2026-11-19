---
name: hibernate
description: 'Hibernate/JPA: HQL and native queries built from strings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - java
  frameworks:
  - hibernate
  detect:
    dependencies:
    - hibernate
    - spring-data-jpa
    imports:
    - org.hibernate
    - javax.persistence
    - jakarta.persistence
categories:
- injection
---

## When this applies

Projects that use hibernate.

## How to investigate

Find raw-query escape hatches and check every one for bound parameters.

## Verification checklist

- Is the query text a literal? Are values bound separately?

## Fixes

Use bound parameters or the query builder.

## References

- https://owasp.org/www-community/attacks/SQL_Injection

