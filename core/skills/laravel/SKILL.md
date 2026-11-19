---
name: laravel
description: 'Laravel: mass assignment, CSRF exceptions and unescaped Blade output.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - php
  frameworks:
  - laravel
  detect:
    dependencies:
    - laravel/framework
    imports:
    - Illuminate
categories:
- authz
- xss
---

## When this applies

Projects that depend on laravel/framework.

## How to investigate

Check Eloquent $fillable/$guarded, VerifyCsrfToken exceptions and {!! !!} in Blade views.

## Verification checklist

- Is $guarded an empty array?

## Fixes

Use $fillable lists and {{ }} escaping.

## References

- https://laravel.com/docs/eloquent#mass-assignment

