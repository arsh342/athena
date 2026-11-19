---
description: Scan this project with Athena and triage the findings
argument-hint: "[path]"
allowed-tools: mcp__athena__athena_scan, mcp__athena__athena_explain, mcp__athena__athena_dependencies, mcp__athena__athena_codebase_map, mcp__athena__athena_taint_paths, Read, Grep, Glob
---

Use the athena-security skill to scan `$ARGUMENTS` (the current project when empty). Start with `athena_scan`, then verify the medium and low confidence candidates with the three lenses, check `athena_dependencies`, and report confirmed issues first with `file:line` and the fix.
