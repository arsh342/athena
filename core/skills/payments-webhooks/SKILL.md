---
name: payments-webhooks
description: 'Payment webhooks: signature verification.'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  detect:
    always: true
categories:
- authn
---

## When this applies

Code that receives webhooks from payment or SaaS providers.

## How to investigate

Check that the raw body signature is verified before acting on the event, and that handlers are idempotent.

## Verification checklist

- Is constructEvent (or an HMAC check) called before using the payload?

## Fixes

Verify the signature with the provider SDK on the raw body; store processed event ids.

## References

- https://stripe.com/docs/webhooks/signatures

