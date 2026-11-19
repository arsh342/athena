---
name: express
description: 'Express.js hardening: session cookies, static file serving, body limits and fingerprinting.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - express
  detect:
    dependencies:
    - express
    imports:
    - express
categories:
- session
- config
---

## When this applies

Projects that depend on express.

## How to investigate

Check app setup (helmet, trust proxy), session middleware options, static file options and body parser limits.

## Verification checklist

- Is the session cookie secure/httpOnly/sameSite in production?
- Does express.static serve dotfiles?

## Fixes

Use helmet, set cookie flags from an environment-aware config, keep dotfiles denied.

## References

- https://expressjs.com/en/advanced/best-practice-security.html

