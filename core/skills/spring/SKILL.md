---
name: spring
description: 'Spring Security and Boot: CSRF, open authorization, CORS and actuator exposure.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - java
  frameworks:
  - spring
  detect:
    dependencies:
    - spring-boot
    - spring-security
    - spring-web
    imports:
    - org.springframework
categories:
- authn
- config
- cors
---

## When this applies

Projects that use Spring.

## How to investigate

Review the SecurityFilterChain, @CrossOrigin annotations and management.endpoints settings.

## Verification checklist

- Does anyRequest() require authentication?
- Which actuator endpoints are exposed?

## Fixes

Authenticate anyRequest(), keep CSRF on for browser sessions, expose only health and info.

## References

- https://docs.spring.io/spring-security/reference/

