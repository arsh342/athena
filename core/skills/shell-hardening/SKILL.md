---
name: shell-hardening
description: 'Shell scripts: strict mode.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - shell
  detect:
    always: true
categories:
- config
---

## When this applies

Bash/sh scripts.

## How to investigate

Check for set -euo pipefail near the top, quoting of expansions and use of mktemp.

## Verification checklist

- Does the script stop on the first error and on unset variables?

## Fixes

Add set -euo pipefail after the shebang.

## References

- https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html

