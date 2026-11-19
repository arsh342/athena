---
name: react
description: 'React: unsafe link targets and tab-nabbing.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  frameworks:
  - react
  detect:
    dependencies:
    - react
    imports:
    - react
categories:
- xss
---

## When this applies

Projects that use React.

## How to investigate

Search JSX for dangerouslySetInnerHTML, javascript: URLs and target="_blank" links.

## Verification checklist

- Is any URL taken from user data and used in href/src?

## Fixes

Validate URL schemes (allow http, https, mailto) and add rel="noopener noreferrer".

## References

- https://react.dev/reference/react-dom/components/common

