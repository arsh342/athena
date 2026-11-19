---
name: docker
description: 'Dockerfiles: root user, remote ADD, floating tags and curl-pipe-shell.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  detect:
    files:
    - (?:^|/)(?:Dockerfile[\w.-]*|[\w.-]+\.dockerfile)$
categories:
- container
- supply-chain
---

## When this applies

Repositories with Dockerfiles.

## How to investigate

Check the final stage for a non-root USER, base image tags, ADD of URLs and download-and-run steps.

## Verification checklist

- Does the container run as root?
- Is the base image pinned?

## Fixes

Add a non-root USER, pin base images by version or digest, verify downloads.

## References

- https://docs.docker.com/develop/security-best-practices/

