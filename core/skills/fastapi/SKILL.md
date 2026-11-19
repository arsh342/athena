---
name: fastapi
description: 'FastAPI: CORS with credentials.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - python
  frameworks:
  - fastapi
  detect:
    dependencies:
    - fastapi
    imports:
    - fastapi
categories:
- cors
---

## When this applies

Projects that import fastapi.

## How to investigate

Check add_middleware(CORSMiddleware) and dependencies that authenticate routes.

## Verification checklist

- Is allow_origins ["*"] combined with allow_credentials=True?

## Fixes

List origins explicitly.

## References

- https://fastapi.tiangolo.com/tutorial/cors/

