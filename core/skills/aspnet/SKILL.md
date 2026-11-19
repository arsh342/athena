---
name: aspnet
description: 'ASP.NET Core: CORS and cookie settings.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - csharp
  frameworks:
  - aspnetcore
  detect:
    imports:
    - Microsoft.AspNetCore
    dependencies:
    - microsoft.aspnetcore
categories:
- cors
- session
---

## When this applies

Projects that use ASP.NET Core.

## How to investigate

Check CORS policies, cookie options and antiforgery attributes.

## Verification checklist

- AllowAnyOrigin together with AllowCredentials?

## Fixes

Name explicit origins; set Secure and HttpOnly cookie policies.

## References

- https://learn.microsoft.com/aspnet/core/security/

