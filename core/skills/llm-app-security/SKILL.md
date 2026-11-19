---
name: llm-app-security
description: 'Applications that call LLMs: prompt injection paths and model output reaching dangerous sinks (OWASP LLM Top 10).'
version: 1.0.0
license: MIT
author: Athena
appliesTo:
  languages:
  - js
  - python
  detect:
    imports:
    - openai
    - '@anthropic-ai/sdk'
    - anthropic
    - langchain
    - '@langchain'
    - ollama
    - '@google/generative-ai'
    - google.generativeai
categories:
- llm
---

## When this applies

Code that imports an LLM SDK.

## How to investigate

Trace model output to sinks (eval, shell, SQL, innerHTML) and user input into system prompts and tool arguments.

## Verification checklist

- Is model output executed or rendered as HTML?
- Do tools run with more authority than the user has?

## Fixes

Treat model output as untrusted input: validate against a schema, never eval/exec it, sandbox tools, keep user text out of the system prompt.

## References

- https://owasp.org/www-project-top-10-for-large-language-model-applications/

