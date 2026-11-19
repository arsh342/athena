---
name: file-uploads
description: 'File uploads: size limits and attacker-chosen file names.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  - python
  detect:
    always: true
categories:
- path-traversal
- dos
---

## When this applies

Code that accepts uploaded files.

## How to investigate

Check size/type limits and how the stored file name is built.

## Verification checklist

- Is the client-supplied file name used in a path?
- Are size limits set?

## Fixes

Generate server-side names, set limits, validate content type by content.

## References

- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

