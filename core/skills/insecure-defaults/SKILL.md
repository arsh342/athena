---
name: insecure-defaults
description: 'Find fail-open behavior: code that runs insecurely when configuration is missing, such as a fallback secret or disabled auth.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    always: true
categories:
- config
- authn
---

## When this applies

Reviewing configuration loading, secrets handling and feature flags.

## How to investigate

Look for values read from the environment with a hard-coded fallback, auth or TLS that turns off when a setting is absent, and defaults that differ between dev and prod.

## Verification checklist

- Does the application start without the secret/config? It should refuse to.
- Is the fallback usable in production?

## Fixes

Fail closed: require the setting at startup and exit with a clear error.

## References

- https://cwe.mitre.org/data/definitions/1188.html

