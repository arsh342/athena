# Graph Report - /Users/arsh/Developer/Projects/athena  (2026-05-20)

## Corpus Check
- 134 files · ~86,779 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 567 nodes · 812 edges · 75 communities detected
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]

## God Nodes (most connected - your core abstractions)
1. `checkCommand()` - 16 edges
2. `scoreUnit()` - 15 edges
3. `scanCommand()` - 15 edges
4. `signal()` - 12 edges
5. `scanFiles()` - 11 edges
6. `scanFromPath()` - 11 edges
7. `Core Engine (@athena/core)` - 11 edges
8. `Heuristic Scorer (11 Weighted Signals)` - 10 edges
9. `ScannerRegistry` - 9 edges
10. `shouldUseSupabaseAuth()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `scanFiles()` --calls--> `parseFile()`  [INFERRED]
  /Users/arsh/Developer/Projects/athena/core/src/engine.ts → core/src/parser/ast-parser.ts
- `collectScores()` --calls--> `parseFile()`  [INFERRED]
  /Users/arsh/Developer/Projects/athena/core/src/calibration/calibrate-threshold.ts → core/src/parser/ast-parser.ts
- `formatRecentHistory()` --calls--> `select()`  [INFERRED]
  /Users/arsh/Developer/Projects/athena/cli/src/utils/history.ts → cli/src/commands/menu.ts
- `random()` --calls--> `createLine()`  [INFERRED]
  frontend/src/components/ParticleAnimation.tsx → /Users/arsh/Developer/Projects/athena/frontend/src/components/SandboxTerminal.tsx
- `random()` --calls--> `createResetToken()`  [INFERRED]
  frontend/src/components/ParticleAnimation.tsx → /Users/arsh/Developer/Projects/athena/test/app/auth.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (13): addScanReport(), appendTerminalLine(), mapTerminalLineRow(), attachPtyWebSocket(), isPrivateOrLocalHost(), validateRepoUrl(), dedupeFindings(), generateReportMarkdown() (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (40): dashedLine(), printBanner(), truncate(), checkCommand(), parseMaxFindings(), captureMessage(), normalizeCoreMessage(), withBufferedAthenaCoreConsole() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (51): AST Parser (TypeScript Compiler API), Benchmark Runner (Precision/Recall/F1), Athena CLI Tool (Commander.js), Core Engine (@athena/core), PostgreSQL + Prisma Database Layer, Deployment Architecture (Vercel + Railway), Diff-Aware Analysis Mode, Hallucinated API Detector (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (23): chooseThreshold(), collectScores(), evaluateAtThreshold(), findSourceFiles(), main(), parseArgs(), sweepThresholds(), mergeConfig() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (19): fetchFindings(), fetchFindingsByScanId(), fetchJson(), fetchReportMarkdown(), fetchScan(), fetchScans(), fetchScanTerminalLines(), startScan() (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (28): average(), clamp01(), scoreBurstiness(), sentenceOpenerVariety(), signal(), splitSentences(), standardDeviation(), explain() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (25): clearAuthCookies(), completeOAuthCallback(), createDbSession(), createTokens(), exchangeOAuthCode(), findUserByAccessToken(), getAppOrigin(), getAuthenticatedUser() (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (21): addScan(), collectSourceFiles(), createEmitterLog(), createEmptyScan(), createLocalDisplayName(), createScanId(), extractZipUploadWorkspace(), filterRelativeParts() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (9): buildFrontendRedirect(), clearOAuthFlowCookies(), getAppOrigin(), getCookieSecurity(), getOAuthCallbackUrl(), isTruthy(), setOAuthFlowCookies(), setSupabaseCookies() (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (10): getGitHooksDir(), getGitRoot(), getStagedFiles(), logGitWarning(), initCommand(), getSemgrepInstallCommand(), getSetupAllPlan(), setupAllCommand() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (4): getFolderRootName(), getUploadDisplayName(), handleUploadSubmit(), validateUploadSelection()

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (8): isLegacyAdvisory(), mapNpmAuditSeverity(), normalizeLegacyFindings(), normalizeModernFindings(), normalizeNpmAuditFindings(), normalizeNpmAuditOutput(), runNpmAudit(), safeParseNpmAudit()

### Community 12 - "Community 12"
Cohesion: 0.31
Nodes (9): formatESLintType(), getESLintCategory(), getSecurityRules(), installTypeScriptParserInTempDir(), loadTypeScriptParser(), mapESLintSeverity(), normalizeESLintFinding(), prepareEslintInputs() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (10): collectIdentifiers(), collectParameters(), createUnit(), estimateComplexity(), getKind(), getMetadata(), getName(), maxNestingDepth() (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.43
Nodes (7): checkDockerAvailable(), execNodejsscan(), getNodejsscanCategory(), mapNodejsscanSeverity(), normalizeNodejsscanFinding(), runNodejsscan(), safeParseNodejsscan()

### Community 15 - "Community 15"
Cohesion: 0.43
Nodes (7): execBearer(), formatBearerType(), getBearerCategory(), mapBearerSeverity(), normalizeBearerFinding(), runBearer(), safeParseBearer()

### Community 16 - "Community 16"
Cohesion: 0.39
Nodes (6): execSemgrep(), formatSemgrepType(), mapSemgrepSeverity(), normalizeSemgrepFinding(), runSemgrep(), safeParseSemgrep()

### Community 17 - "Community 17"
Cohesion: 0.5
Nodes (2): isSecretFinding(), redactFindingText()

### Community 18 - "Community 18"
Cohesion: 0.4
Nodes (2): ProtectedRoute(), useAuth()

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (2): detectHallucinations(), analyzeSecurity()

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.5
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (2): doConnect(), resolveWsUrl()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (2): checkTool(), doctorCommand()

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
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): Temporal Trend Analysis

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): Node.js Runtime (v18+)

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (1): Vitest Testing Framework

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (1): Phase 1: Project Scaffolding

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (1): Phase 5: Report + Engine + Advanced Features

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): Phase 9: Testing + Benchmarks + Polish

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): Phase 10: Publishing (@arsh342/athena)

## Knowledge Gaps
- **38 isolated node(s):** `Hallucinated API Detector`, `Suppression System`, `Temporal Trend Analysis`, `Benchmark Runner (Precision/Recall/F1)`, `Security Threat Model & Mitigations` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 34`** (2 nodes): `ScrollToTop()`, `App.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `getDashboardEmptyState()`, `dashboard.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `InfraPipeline()`, `InfraPipeline.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `Terminal.tsx`, `Terminal()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `ScrollStroke.tsx`, `ScrollStroke()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `ScoreGauge.tsx`, `ScoreGauge()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `GridBackground.tsx`, `GridBackground()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `CodeBlock()`, `CodeBlock.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `TermsPage()`, `Terms.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `handleSubmit()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `handleSubmit()`, `Register.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `ReviewCard()`, `template.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `diagnose()`, `diagnose-db.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `main()`, `scratch_test_db.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `main()`, `scratch_test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `main()`, `scratch_test_nossl.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `outExtension()`, `tsup.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `config.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `dashboard-utils.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `vite-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `SeverityBadge.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `HubDiagram.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `ReportView.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `PrivacyPolicy.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `Sitemap.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `Quickstart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `report-endpoints.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `third-party.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `bcryptjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `Temporal Trend Analysis`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `Node.js Runtime (v18+)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `Vitest Testing Framework`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `Phase 1: Project Scaffolding`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `Phase 5: Report + Engine + Advanced Features`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `Phase 9: Testing + Benchmarks + Polish`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `Phase 10: Publishing (@arsh342/athena)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scanFiles()` connect `Community 3` to `Community 1`, `Community 13`, `Community 7`?**
  _High betweenness centrality (0.179) - this node is a cross-community bridge._
- **Why does `runScan()` connect `Community 7` to `Community 3`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `runScanFilesInProjectRoot()` connect `Community 7` to `Community 3`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `checkCommand()` (e.g. with `mergeConfig()` and `getStagedFiles()`) actually correct?**
  _`checkCommand()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `scoreUnit()` (e.g. with `scorePerplexity()` and `scoreBurstiness()`) actually correct?**
  _`scoreUnit()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `scanCommand()` (e.g. with `mergeConfig()` and `clearScreen()`) actually correct?**
  _`scanCommand()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `scanFiles()` (e.g. with `mergeConfig()` and `parseFile()`) actually correct?**
  _`scanFiles()` has 8 INFERRED edges - model-reasoned connections that need verification._