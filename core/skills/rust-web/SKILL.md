---
name: rust-web
description: 'Rust web services: permissive CORS.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - rust
  frameworks:
  - axum
  - actix
  detect:
    dependencies:
    - axum
    - actix-web
    - tower-http
    imports:
    - axum
    - actix_web
    - tower_http
categories:
- cors
---

## When this applies

Rust services using axum or actix-web.

## How to investigate

Check CORS layers and extractor-based auth.

## Verification checklist

- Is any CORS layer permissive in production?

## Fixes

List origins explicitly.

## References

- https://docs.rs/tower-http/latest/tower_http/cors/

