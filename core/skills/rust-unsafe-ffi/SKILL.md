---
name: rust-unsafe-ffi
description: 'Rust unsafe code and FFI: raw slices and uninitialized memory.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - rust
  detect:
    always: true
categories:
- memory-safety
---

## When this applies

Rust code with unsafe blocks or FFI.

## How to investigate

Check every from_raw_parts for a valid pointer/length proof and every uninitialized value for full initialization before read.

## Verification checklist

- Is the invariant written next to the unsafe block?

## Fixes

Wrap unsafe in a small safe function that checks its inputs.

## References

- https://doc.rust-lang.org/nomicon/

