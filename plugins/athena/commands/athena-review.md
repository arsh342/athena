---
description: Review the current change (staged by default) for issues it introduces
argument-hint: "[staged|uncommitted|range <a..b>|base <branch>]"
allowed-tools: mcp__athena__athena_review, mcp__athena__athena_explain, mcp__athena__athena_check_files, mcp__athena__athena_dependencies, Read, Grep, Glob
---

Use the athena-security skill to review `$ARGUMENTS` (staged changes when empty) with `athena_review`. Only findings on changed lines count; mention existing issues separately. Verify medium and low confidence candidates, then list blocking issues first.
