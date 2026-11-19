---
name: github-actions
description: 'GitHub Actions workflows: script injection, privileged triggers and permissions.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    files:
    - (?:^|/)\.github/workflows/[^/]+\.ya?ml$
categories:
- ci
- supply-chain
---

## When this applies

Repositories with .github/workflows files.

## How to investigate

Look for untrusted event fields interpolated into run scripts, pull_request_target workflows that check out PR code, and broad permissions.

## Verification checklist

- Is ${{ github.event.* }} used directly in a run script?
- Does a pull_request_target workflow run code from the PR?

## Fixes

Pass untrusted values through env: and quote them; avoid checking out PR code in privileged workflows; set minimal permissions.

## References

- https://securitylab.github.com/resources/github-actions-untrusted-input/

