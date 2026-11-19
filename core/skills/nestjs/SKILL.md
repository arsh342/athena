---
name: nestjs
description: 'NestJS: validation pipe and CORS defaults.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - nestjs
  detect:
    dependencies:
    - '@nestjs/core'
    imports:
    - '@nestjs/core'
categories:
- validation
- cors
---

## When this applies

Projects that depend on @nestjs/core.

## How to investigate

Check main.ts for a global ValidationPipe and enableCors options; check controllers for guards.

## Verification checklist

- Is a global ValidationPipe (whitelist: true) registered?

## Fixes

Register ValidationPipe with whitelist and forbidNonWhitelisted; list CORS origins.

## References

- https://docs.nestjs.com/security/cors

