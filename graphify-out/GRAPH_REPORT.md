# Graph Report - /Users/arsh/Developer/Projects/athena  (2026-04-21)

## Corpus Check
- 65 files · ~41,384 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 288 nodes · 416 edges · 49 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]

## God Nodes (most connected - your core abstractions)
1. `scoreUnit()` - 15 edges
2. `signal()` - 12 edges
3. `Core Engine (@athena/core)` - 11 edges
4. `checkCommand()` - 10 edges
5. `Heuristic Scorer (11 Weighted Signals)` - 10 edges
6. `scanCommand()` - 9 edges
7. `Security Analyzer Pipeline` - 9 edges
8. `scoreBurstiness()` - 8 edges
9. `scanFiles()` - 7 edges
10. `scorePerplexity()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `scanFiles()` --calls--> `parseFile()`  [INFERRED]
  /Users/arsh/Developer/Projects/athena/core/src/engine.ts → core/src/parser/ast-parser.ts
- `collectScores()` --calls--> `parseFile()`  [INFERRED]
  /Users/arsh/Developer/Projects/athena/core/src/calibration/calibrate-threshold.ts → core/src/parser/ast-parser.ts
- `findSourceFiles()` --calls--> `scanCommand()`  [INFERRED]
  cli/src/utils/file-filter.ts → /Users/arsh/Developer/Projects/athena/cli/src/commands/scan.ts
- `findSourceFiles()` --calls--> `checkCommand()`  [INFERRED]
  cli/src/utils/file-filter.ts → /Users/arsh/Developer/Projects/athena/cli/src/commands/check.ts
- `random()` --calls--> `createLine()`  [INFERRED]
  frontend/src/components/ParticleAnimation.tsx → /Users/arsh/Developer/Projects/athena/frontend/src/components/SandboxTerminal.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (21): dashedLine(), printBanner(), truncate(), checkCommand(), appendScanHistory(), formatRecentHistory(), getRecentScanHistory(), logHistoryWarning() (+13 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (26): Athena CLI Tool (Commander.js), PostgreSQL + Prisma Database Layer, Deployment Architecture (Vercel + Railway), Diff-Aware Analysis Mode, Pre-commit Hook Integration, Sandbox Manager (Isolated Scan Environment), Athena AI Code Provenance Tracker, Security Threat Model & Mitigations (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (11): fetchFindings(), fetchJson(), fetchScans(), fetchScanTerminalLines(), startScan(), random(), createLine(), executeCommand() (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (25): AST Parser (TypeScript Compiler API), Benchmark Runner (Precision/Recall/F1), Core Engine (@athena/core), Hallucinated API Detector, Heuristic Scorer (11 Weighted Signals), Repository Fingerprinting (Baseline), Report Generator (Terminal/JSON/HTML/JSONL), Native Secret Detector (Regex + Shannon Entropy) (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (16): clearAuthCookies(), createDbSession(), createTokens(), findUserByAccessToken(), getAuthenticatedUser(), hashToken(), isTruthy(), isValidEmail() (+8 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (8): addScan(), findSourceFiles(), isSourceFile(), walk(), collectSourceFiles(), mapScanSummary(), parseRepoName(), runScan()

### Community 6 - "Community 6"
Cohesion: 0.33
Nodes (15): explain(), scoreBoilerplatePatterns(), scoreCommentRatio(), scoreEmojiComments(), scoreEmptyCatch(), scoreFormattingUniformity(), scoreGenericNames(), scoreHelperOrdering() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.23
Nodes (10): mergeConfig(), scanFiles(), countBand(), generateReport(), roundPerK(), summarizeWeightedContributions(), formatTerminalReport(), metricLine() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (10): collectIdentifiers(), collectParameters(), createUnit(), estimateComplexity(), getKind(), getMetadata(), getName(), maxNestingDepth() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.39
Nodes (7): average(), clamp01(), scoreBurstiness(), sentenceOpenerVariety(), signal(), splitSentences(), standardDeviation()

### Community 10 - "Community 10"
Cohesion: 0.42
Nodes (6): getGitHooksDir(), getGitRoot(), getStagedFiles(), logGitWarning(), initCommand(), uninstallCommand()

### Community 11 - "Community 11"
Cohesion: 0.46
Nodes (7): chooseThreshold(), collectScores(), evaluateAtThreshold(), findSourceFiles(), main(), parseArgs(), sweepThresholds()

### Community 12 - "Community 12"
Cohesion: 0.57
Nodes (6): clamp01(), repetitionRate(), scorePerplexity(), shannonEntropy(), signal(), tokenize()

### Community 13 - "Community 13"
Cohesion: 0.4
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (2): detectHallucinations(), analyzeSecurity()

### Community 15 - "Community 15"
Cohesion: 0.5
Nodes (2): ProtectedRoute(), useAuth()

### Community 16 - "Community 16"
Cohesion: 0.67
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 0.67
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (1): Temporal Trend Analysis

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (1): Node.js Runtime (v18+)

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (1): Vitest Testing Framework

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (1): Phase 1: Project Scaffolding

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (1): Phase 5: Report + Engine + Advanced Features

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (1): Phase 9: Testing + Benchmarks + Polish

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (1): Phase 10: Publishing (@arsh342/athena)

## Knowledge Gaps
- **38 isolated node(s):** `Hallucinated API Detector`, `Suppression System`, `Temporal Trend Analysis`, `Benchmark Runner (Precision/Recall/F1)`, `Security Threat Model & Mitigations` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (2 nodes): `ScrollToTop()`, `App.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `InfraPipeline()`, `InfraPipeline.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `Terminal()`, `Terminal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `ScrollStroke.tsx`, `ScrollStroke()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `ScoreGauge.tsx`, `ScoreGauge()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `GridBackground.tsx`, `GridBackground()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `CodeBlock()`, `CodeBlock.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `TermsPage()`, `Terms.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `Login()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `Dashboard()`, `Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `Register()`, `Register.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `ScanPage()`, `ScanPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `ReportPage()`, `ReportPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `tsup.config.ts`, `outExtension()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `SeverityBadge.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `HubDiagram.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `ReportView.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `PrivacyPolicy.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `Sitemap.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `bcryptjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `Temporal Trend Analysis`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `Node.js Runtime (v18+)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `Vitest Testing Framework`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `Phase 1: Project Scaffolding`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `Phase 5: Report + Engine + Advanced Features`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `Phase 9: Testing + Benchmarks + Polish`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `Phase 10: Publishing (@arsh342/athena)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scanFiles()` connect `Community 7` to `Community 8`, `Community 0`, `Community 5`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `runScan()` connect `Community 5` to `Community 7`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `checkCommand()` connect `Community 0` to `Community 10`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `scoreUnit()` (e.g. with `scorePerplexity()` and `scoreBurstiness()`) actually correct?**
  _`scoreUnit()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `checkCommand()` (e.g. with `getStagedFiles()` and `clearScreen()`) actually correct?**
  _`checkCommand()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Hallucinated API Detector`, `Suppression System`, `Temporal Trend Analysis` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._