---
type: community
cohesion: 0.25
members: 14
---

# CLI Commands & Scanning

**Cohesion:** 0.25 - loosely connected
**Members:** 14 nodes

## Members
- [[checkCommand()]] - code - cli/src/commands/check.ts
- [[file-filter.ts]] - code - cli/src/utils/file-filter.ts
- [[findSourceFiles()]] - code - cli/src/utils/file-filter.ts
- [[formatJsonl()]] - code - core/src/report/report-generator.ts
- [[formatTerminalReport()]] - code - core/src/report/terminal-formatter.ts
- [[isSourceFile()]] - code - cli/src/utils/file-filter.ts
- [[metricLine()]] - code - core/src/report/terminal-formatter.ts
- [[printRunResult()]] - code - cli/src/utils/terminal.ts
- [[scanCommand()]] - code - cli/src/commands/scan.ts
- [[scanFiles()]] - code - core/src/engine.ts
- [[sectionRule()]] - code - core/src/report/terminal-formatter.ts
- [[severityBar()]] - code - core/src/report/terminal-formatter.ts
- [[terminal-formatter.ts]] - code - core/src/report/terminal-formatter.ts
- [[walk()]] - code - cli/src/utils/file-filter.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/CLI_Commands_&_Scanning
SORT file.name ASC
```

## Connections to other communities
- 8 edges to [[_COMMUNITY_CLI UI & Banner]]
- 5 edges to [[_COMMUNITY_Engine Orchestration]]
- 1 edge to [[_COMMUNITY_Community 6]]

## Top bridge nodes
- [[scanFiles()]] - degree 6, connects to 2 communities
- [[checkCommand()]] - degree 8, connects to 1 community
- [[scanCommand()]] - degree 7, connects to 1 community
- [[file-filter.ts]] - degree 5, connects to 1 community
- [[terminal-formatter.ts]] - degree 5, connects to 1 community