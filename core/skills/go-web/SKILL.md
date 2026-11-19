---
name: go-web
description: 'Go web servers: timeouts and file serving.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - go
  frameworks:
  - gin
  - net/http
  detect:
    imports:
    - net/http
    - github.com/gin-gonic/gin
    - github.com/labstack/echo
categories:
- dos
- path-traversal
---

## When this applies

Go services built on net/http, gin or echo.

## How to investigate

Check http.Server timeouts and any c.File/ServeFile calls taking user paths.

## Verification checklist

- Are ReadHeaderTimeout and ReadTimeout set?

## Fixes

Use an http.Server with timeouts instead of ListenAndServe; clean and prefix-check user paths.

## References

- https://pkg.go.dev/net/http#Server

