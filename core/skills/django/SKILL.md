---
name: django
description: 'Django settings: hosts, CSRF and cookie flags.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - python
  frameworks:
  - django
  detect:
    dependencies:
    - django
    imports:
    - django
categories:
- config
- session
---

## When this applies

Projects that depend on Django.

## How to investigate

Read settings.py for ALLOWED_HOSTS, cookie flags and csrf_exempt views.

## Verification checklist

- Is ALLOWED_HOSTS explicit?
- Are *_COOKIE_SECURE True in production?

## Fixes

Pin ALLOWED_HOSTS, set cookie flags, avoid csrf_exempt.

## References

- https://docs.djangoproject.com/en/stable/topics/security/

