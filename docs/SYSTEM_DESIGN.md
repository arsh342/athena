# Athena — System Design Document

> **Version:** 2.0  
> **Date:** April 2026  
> **Status:** Finalized  

---

## 1. Introduction

### 1.1 Purpose
Athena is an AI Code Provenance Tracker — a developer security tool that detects likely AI-generated code sections in JavaScript/TypeScript codebases and runs targeted security analysis on flagged sections. It operates as both a CLI tool (pre-commit hook) and a web platform (GitHub repo scanner with live terminal streaming).

### 1.2 Problem Statement
Developers increasingly commit AI-generated code into production without adequate review. This code frequently contains:
- Subtle security vulnerabilities (hardcoded secrets, injection vectors)
- Hallucinated API calls that don't exist
- Deprecated patterns and insecure defaults
- Logic that appears syntactically correct but is semantically flawed

No existing developer tooling specifically identifies AI-generated sections for elevated scrutiny before they enter version control.

### 1.3 Scope
- **In scope:** JS/TS/JSX/TSX file analysis, CLI pre-commit integration, web platform with GitHub repo scanning
- **Out of scope:** Python/Java/Go support (future), ML-based classifier (v2), CI/CD pipeline integration (future)

---

## 2. High-Level Architecture

### 2.1 System Overview

```mermaid
graph TB
    subgraph ATHENA["Athena System"]
        subgraph CORE["Core Engine (core/)"]
            AST["AST Parser<br/>TypeScript Compiler API"]
            SCORER["Heuristic Scorer<br/>11 Weighted Signals"]
            SECURITY["Security Analyzer<br/>ESLint + Semgrep + Secrets"]
            REPORT["Report Generator<br/>Terminal / JSON / HTML / JSONL"]
            DIFF["Diff Analyzer"]
            BASELINE["Repo Fingerprint"]
            HALLUC["Hallucination Detector"]
            SUPPRESS["Suppression Manager"]
            BENCH["Benchmark Runner"]

            AST --> SCORER
            SCORER --> SECURITY
            SECURITY --> REPORT
            DIFF -.-> AST
            BASELINE -.-> SCORER
            HALLUC -.-> SECURITY
            SUPPRESS -.-> REPORT
        end

        subgraph CLI["CLI Tool (cli/)"]
            CMD["Commander.js<br/>check / scan / init / report"]
            HOOK["Pre-commit Hook"]
            TERMUI["Terminal UI<br/>Chalk + Ora"]
        end

        subgraph WEB["Web Platform"]
            subgraph FE["Frontend (frontend/)"]
                REACT["React + Vite"]
                XTERM["xterm.js Terminal"]
                DASH["Dashboard + Reports"]
            end
            subgraph BE["Backend (backend/)"]
                EXPRESS["Express Server"]
                WS["WebSocket (ws)"]
                SANDBOX["Sandbox Manager"]
                AUTH["JWT Auth"]
            end
        end

        subgraph DATA["Data Layer"]
            PG["PostgreSQL<br/>Web scan results"]
            JSON["JSON File Store<br/>CLI scan history"]
        end

        CORE --> CLI
        CORE --> BE
        CLI --> JSON
        BE --> PG
        FE <-->|"WebSocket"| BE
        FE <-->|"REST API"| BE
    end

    USER_CLI["Developer<br/>Terminal"] --> CLI
    USER_WEB["Developer<br/>Browser"] --> FE
    GIT["Git Repository"] --> BE
    GIT --> CLI
```

### 2.2 Component Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| **Core Engine** | `core/` | Standalone shared package — AST parsing, scoring, security analysis, reporting. Zero CLI/web deps. |
| **CLI** | `cli/` | npm-installable CLI tool w/ pre-commit hook. Imports `@athena/core`. |
| **Web Frontend** | `frontend/` | React + xterm.js dashboard for repo scanning |
| **Web Backend** | `backend/` | Express + WebSocket server, repo cloning, scan orchestration. Imports `@athena/core`. |

### 2.3 Design Principles
1. **Core engine is framework-agnostic** — zero dependency on CLI or web layers
2. **Fully offline** — no external API calls, no telemetry, no cloud deps
3. **Graceful degradation** — works w/o Semgrep (fewer findings, not failure)
4. **Streaming-first** — all scan output streamed in real-time (CLI terminal + web WS)

### 2.4 Package Dependency Graph

```mermaid
graph LR
    CORE["@athena/core"]
    CLI["@arsh342/athena<br/>(CLI)"]
    BE["backend"]
    FE["frontend"]

    CLI -->|"depends on"| CORE
    BE -->|"depends on"| CORE
    FE -->|"HTTP/WS"| BE
    CLI -.->|"no dependency"| FE
    CLI -.->|"no dependency"| BE

    style CORE fill:#3b82f6,color:#fff
    style CLI fill:#8b5cf6,color:#fff
    style BE fill:#06b6d4,color:#fff
    style FE fill:#f97316,color:#fff
```

---

## 3. Core Engine Design

The core engine is the shared analysis pipeline consumed by both CLI and web.

### 3.1 Pipeline Architecture

```mermaid
flowchart TD
    INPUT["Input Files<br/>(JS/TS/JSX/TSX)"] --> DIFF_CHECK{Diff-Aware?}
    DIFF_CHECK -->|Yes| DIFF["Diff Analyzer<br/>Parse git diff → changed ranges"]
    DIFF_CHECK -->|No| AST
    DIFF --> AST["AST Parser<br/>ts.createSourceFile + visitor"]
    
    AST -->|"CodeUnit[]"| SCORER["Heuristic Scorer<br/>11 signals × configurable weights"]
    
    BASELINE["Repo Fingerprint<br/>.athena/baseline.json"] -.->|"deviation score"| SCORER
    
    SCORER -->|"ScoredUnit[]"| THRESHOLD{Score ≥ Threshold?}
    THRESHOLD -->|"Flagged"| SECURITY["Security Analyzer"]
    THRESHOLD -->|"Not flagged"| PASS["Pass through"]
    
    subgraph SEC["Security Analysis Layer"]
        SECURITY --> ESLINT["ESLint<br/>Programmatic API<br/>eslint-plugin-security"]
        SECURITY --> SEMGREP["Semgrep<br/>Subprocess (optional)"]
        SECURITY --> SECRET["Secret Detector<br/>Regex + Shannon Entropy"]
        SECURITY --> HALLUC["Hallucination Detector<br/>Import/Call validation"]
    end
    
    ESLINT --> CLASSIFY
    SEMGREP --> CLASSIFY
    SECRET --> CLASSIFY
    HALLUC --> CLASSIFY
    
    SUPPRESS["Suppression Manager<br/>.athena/suppressions.json"] -.->|"skip suppressed"| CLASSIFY
    
    CLASSIFY["Severity Classifier<br/>AI score × finding severity"] -->|"ClassifiedFinding[]"| REPORT["Report Generator"]
    PASS --> REPORT
    
    REPORT --> TERM["Terminal<br/>(ANSI)"]
    REPORT --> JSON_OUT["JSON"]
    REPORT --> HTML["HTML"]
    REPORT --> JSONL["JSONL<br/>(Research)"]
    
    REPORT --> HISTORY["History Storage<br/>.athena/history/"]
    HISTORY --> TREND["Trend Analysis"]

    style INPUT fill:#3b82f6,color:#fff
    style SCORER fill:#8b5cf6,color:#fff
    style SECURITY fill:#ef4444,color:#fff
    style CLASSIFY fill:#f97316,color:#fff
    style REPORT fill:#06b6d4,color:#fff
```

### 3.2 AST Parser

**Input:** File path or source code string  
**Output:** Array of `CodeUnit` objects

```typescript
interface CodeUnit {
  id: string;                    // unique hash
  name: string;                  // function/class/block name
  kind: CodeUnitKind;            // 'function' | 'class' | 'method' | 'arrow' | 'block'
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;                  // raw source text
  metadata: CodeUnitMetadata;
}

interface CodeUnitMetadata {
  loc: number;                   // lines of code (excluding blanks/comments)
  commentLines: number;          // number of comment lines
  commentRatio: number;          // commentLines / (loc + commentLines)
  identifiers: string[];         // all variable/param/fn names used
  nestingDepth: number;          // max nesting depth
  parameters: string[];          // function parameter names
  hasJSDoc: boolean;             // preceded by JSDoc comment
  complexity: number;            // cyclomatic complexity estimate
}
```

**Implementation approach:**
- `ts.createSourceFile()` to parse without full program creation (faster, no type checking needed)
- Recursive visitor via `ts.forEachChild()` 
- Extract: `FunctionDeclaration`, `ArrowFunction`, `MethodDeclaration`, `ClassDeclaration`
- Minimum unit size: 3 LOC (skip trivial getters/setters)

#### AST Extraction Flow

```mermaid
flowchart LR
    SRC["Source File"] --> PARSE["ts.createSourceFile()"]
    PARSE --> VISIT["ts.forEachChild()<br/>Recursive Visitor"]
    VISIT --> FN["FunctionDeclaration"]
    VISIT --> ARROW["ArrowFunction"]
    VISIT --> METHOD["MethodDeclaration"]
    VISIT --> CLASS["ClassDeclaration"]
    
    FN --> FILTER{"LOC ≥ 3?"}
    ARROW --> FILTER
    METHOD --> FILTER
    CLASS --> FILTER
    
    FILTER -->|Yes| EXTRACT["Extract CodeUnit<br/>+ Metadata"]
    FILTER -->|No| SKIP["Skip"]
    
    EXTRACT --> UNITS["CodeUnit[]"]
```

### 3.3 Heuristic Scorer

**Input:** `CodeUnit`  
**Output:** `ScoredUnit` (CodeUnit + score + signal breakdown)

#### Signal Architecture

```mermaid
flowchart TD
    UNIT["CodeUnit"] --> S1["Signal 1: Generic Names<br/>Weight: 15"]
    UNIT --> S2["Signal 2: Comment Ratio<br/>Weight: 12"]
    UNIT --> S3["Signal 3: Obvious Comments<br/>Weight: 10"]
    UNIT --> S4["Signal 4: Empty Catch<br/>Weight: 10"]
    UNIT --> S5["Signal 5: Null Checks<br/>Weight: 8"]
    UNIT --> S6["Signal 6: Format Uniformity<br/>Weight: 8"]
    UNIT --> S7["Signal 7: Universal JSDoc<br/>Weight: 7"]
    UNIT --> S8["Signal 8: Naming Entropy<br/>Weight: 10"]
    UNIT --> S9["Signal 9: Boilerplate<br/>Weight: 10"]
    UNIT --> S10["Signal 10: Helper Ordering<br/>Weight: 10"]
    UNIT --> S11["Signal 11: Emoji Comments<br/>Weight: 10"]
    
    S1 --> AGG["Aggregate + Normalize<br/>Total: 110 → scaled 0–100"]
    S2 --> AGG
    S3 --> AGG
    S4 --> AGG
    S5 --> AGG
    S6 --> AGG
    S7 --> AGG
    S8 --> AGG
    S9 --> AGG
    S10 --> AGG
    S11 --> AGG
    
    AGG --> BANDS{Confidence Band}
    BANDS -->|"0–40"| LOW["LOW<br/>Likely Human"]
    BANDS -->|"40–70"| UNC["UNCERTAIN<br/>Review Needed"]
    BANDS -->|"70–100"| HIGH["HIGH<br/>Likely AI"]
    
    AGG --> EXPLAIN["Explainability<br/>Top 3 signals + % contribution"]

    style LOW fill:#22c55e,color:#fff
    style UNC fill:#eab308,color:#000
    style HIGH fill:#ef4444,color:#fff
```

#### Signal Table

| # | Signal | Max Weight | Method |
|---|--------|-----------|--------|
| 1 | Generic variable names | 15 | Count identifiers matching generic list ÷ total identifiers |
| 2 | Excessive comment ratio | 12 | commentRatio > 0.4 = max score, linear scale below |
| 3 | Obvious-code comments | 10 | Comment immediately before single assignment/return/log |
| 4 | Empty catch blocks | 10 | AST: catch clause w/ empty body or console.error only |
| 5 | Unnecessary null checks | 8 | Optional chaining on required params, redundant typeof checks |
| 6 | Formatting uniformity | 8 | Indentation std deviation across unit = 0 |
| 7 | Universal JSDoc coverage | 7 | Every fn/method has preceding comment |
| 8 | Low naming entropy | 10 | Shannon entropy of identifier set below threshold |
| 9 | Boilerplate patterns | 10 | Template matching: CRUD fns, express route handlers, React boilerplate |
| 10 | Helper fn call ordering | 10 | Helper defined before used, sequential call pattern |
| 11 | Emoji in comments/strings | 10 | Detect emoji chars (✅🔥📝⚡🚀💡🎉 etc.) in comments — strong AI signal |

**Total possible:** 110 (normalized to 0–100 scale)  
**Default threshold:** 65  
**Weights configurable** via `.athena.config.json` — enables ablation studies.

#### Confidence Bands

| Band | Score Range | Interpretation |
|------|------------|----------------|
| LOW | 0–40 | Likely human-written |
| UNCERTAIN | 40–70 | Ambiguous — review if flagged |
| HIGH | 70–100 | Likely AI-generated |

#### Explainability Output

```typescript
interface ExplainedScore {
  score: number;
  band: 'LOW' | 'UNCERTAIN' | 'HIGH';
  signalsTriggered: number;
  variance: number;
  topSignals: {
    signal: string;
    contribution: number;  // percentage
    score: number;
  }[];
}
```

**Output per unit:**

```typescript
interface ScoredUnit {
  unit: CodeUnit;
  score: number;                    // 0-100
  signals: SignalResult[];          // which signals fired, individual scores
  flagged: boolean;                 // score >= threshold
  explained: ExplainedScore;        // confidence band + top-3 breakdown
}

interface SignalResult {
  signal: string;
  score: number;
  maxWeight: number;
  evidence: string;                 // human-readable explanation
}
```

### 3.4 Security Analyzer

Runs on flagged units only (optimization — skip low-score code).

#### Security Analysis Flow

```mermaid
flowchart TD
    FLAGGED["Flagged CodeUnits<br/>(score ≥ threshold)"]
    
    FLAGGED --> TMPFILE["Write to temp file"]
    TMPFILE --> ESLINT["ESLint<br/>Programmatic API"]
    TMPFILE --> SEMGREP{"Semgrep<br/>installed?"}
    FLAGGED --> SECRET["Secret Detector<br/>Regex + Entropy"]
    FLAGGED --> HALLUC["Hallucination<br/>Detector"]
    
    SEMGREP -->|Yes| SEMGREP_RUN["semgrep --json<br/>--config=auto"]
    SEMGREP -->|No| SKIP["Skip<br/>(graceful)"]
    
    ESLINT --> FINDINGS["Finding[]"]
    SEMGREP_RUN --> FINDINGS
    SECRET --> FINDINGS
    HALLUC --> FINDINGS
    SKIP -.-> FINDINGS

    style FLAGGED fill:#ef4444,color:#fff
    style FINDINGS fill:#f97316,color:#fff
```

#### 3.4.1 ESLint Security Analysis
- Programmatic ESLint API (`new ESLint({ ... })`)
- Rules from `eslint-plugin-security`:
  - `detect-unsafe-regex`
  - `detect-eval-with-expression`
  - `detect-non-literal-fs-filename`
  - `detect-non-literal-require`
  - `detect-object-injection`
  - `detect-possible-timing-attacks`
  - `detect-no-csrf-before-method-override`

#### 3.4.2 Semgrep Integration (Optional)
- Write flagged unit code to temp file
- `semgrep --json --config=auto --config=p/security-audit <tmpfile>`
- Parse JSON → extract rule ID, message, severity, matched code
- Graceful skip if `semgrep` binary not found

#### 3.4.3 Native Secret Detector

```mermaid
flowchart TD
    INPUT["String literals<br/>from CodeUnit"] --> REGEX["Regex Pattern<br/>Matching"]
    INPUT --> ENTROPY["Shannon Entropy<br/>Analysis"]
    
    REGEX --> AWS["AWS Key<br/>AKIA[0-9A-Z]{16}"]
    REGEX --> GH["GitHub Token<br/>gh[ps]_[A-Za-z0-9_]{36,}"]
    REGEX --> JWT_PAT["JWT<br/>eyJ..."]
    REGEX --> PKEY["Private Key<br/>-----BEGIN..."]
    REGEX --> PWD["Password<br/>password[:=]'...'"]
    REGEX --> GENERIC["Generic API Key<br/>api_key/token/secret"]
    
    ENTROPY --> CHECK{"Entropy > 4.5<br/>AND len > 20?"}
    CHECK -->|Yes| POSSIBLE["Possible Secret"]
    CHECK -->|No| SAFE["Not a secret"]
    
    POSSIBLE --> EXCLUDE{"Is URL/path/<br/>error msg?"}
    EXCLUDE -->|Yes| SAFE
    EXCLUDE -->|No| FLAGGED["🔴 Secret Found"]

    style FLAGGED fill:#ef4444,color:#fff
    style SAFE fill:#22c55e,color:#fff
```

### 3.5 Severity Classifier

#### Cross-Reference Matrix

```mermaid
quadrantChart
    title Severity Classification Matrix
    x-axis "Low AI Score" --> "High AI Score"
    y-axis "Low Finding Severity" --> "High Finding Severity"
    quadrant-1 "🟠 HIGH"
    quadrant-2 "🔴 CRITICAL"
    quadrant-3 "🔵 LOW"
    quadrant-4 "🟡 MEDIUM"
```

| Finding Type | AI Score ≥ 65 | AI Score < 65 |
|-------------|---------------|---------------|
| Hardcoded secret | 🔴 CRITICAL | 🟠 HIGH |
| Known vuln (injection, XSS, eval) | 🟠 HIGH | 🟡 MEDIUM |
| Insecure pattern (weak regex, timing) | 🟡 MEDIUM | 🔵 LOW |
| Code quality (empty catch, unused var) | 🟡 MEDIUM | 🔵 LOW |

Rationale: Same vulnerability in AI-generated code = higher risk because the code is unreviewed.

#### Rule Taxonomy

All findings mapped to unified categories:

| Category | Examples |
|----------|----------|
| `injection` | SQL injection, command injection, XSS |
| `credential-exposure` | Hardcoded API keys, passwords, tokens |
| `unsafe-dynamic-exec` | eval(), Function(), dynamic require |
| `weak-crypto` | MD5, SHA1 for security purposes |
| `data-exposure` | Logging sensitive data, unmasked PII |
| `insecure-config` | CORS *, no HTTPS, weak TLS |

### 3.6 Report Generator

**Formats:**
1. **Terminal** — ANSI-colored output w/ box drawing, severity icons
2. **JSON** — structured output for programmatic consumption
3. **HTML** — standalone HTML file w/ embedded CSS, no server needed
4. **JSONL** — one JSON object per line, research-ready export

**Report structure:**
```typescript
interface ScanReport {
  timestamp: string;
  duration: number;                    // ms
  performanceProfile?: PerformanceProfile;
  summary: {
    filesScanned: number;
    totalUnits: number;
    flaggedUnits: number;
    findings: Record<Severity, number>;
    blocked: boolean;
    // Repo-level AI metrics
    aiScore: number;                   // avg score across all units
    aiFlagRatio: number;               // flaggedUnits / totalUnits (0-1)
    aiPercentage: number;              // aiFlagRatio * 100
    // Risk density
    riskDensity: {
      criticalPer1kLoc: number;
      findingsPer1kLoc: number;
      flaggedRatio: number;
    };
    // Confidence distribution
    confidenceBands: {
      low: number;
      uncertain: number;
      high: number;
    };
  };
  trend?: {
    previousScore: number;
    direction: 'increasing' | 'decreasing' | 'stable';
    changePercent: number;
  };
  files: FileReport[];
}

interface FileReport {
  path: string;
  units: ScoredUnit[];
  findings: ClassifiedFinding[];
}

interface ClassifiedFinding {
  id: string;
  severity: Severity;
  type: FindingType;
  category: FindingCategory;
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  aiScore: number;
  explainedScore: ExplainedScore;
  source: 'semgrep' | 'eslint' | 'secret-detector' | 'hallucination-detector';
  ruleId: string;
}

interface PerformanceProfile {
  parsing: number;     // ms
  scoring: number;
  securityAnalysis: number;
  reportGeneration: number;
  total: number;
}
```

### 3.7 Diff-Aware Analysis

Change-focused mode for pre-commit and PR review:

```mermaid
flowchart TD
    COMMIT["git commit"] --> STAGED["git diff --cached<br/>Get staged changes"]
    STAGED --> RANGES["Parse changed<br/>line ranges per file"]
    RANGES --> MAP["Map to CodeUnits<br/>that intersect changes"]
    MAP --> SCORE["Score + analyze<br/>only affected units"]
    SCORE --> DELTA["Risk Delta Report<br/>'This commit adds 2 HIGH findings'"]
    
    DELTA --> EXIT{Exit Code}
    EXIT -->|"0"| ALLOW["✅ Commit proceeds"]
    EXIT -->|"1"| BLOCK["❌ Commit blocked"]

    style BLOCK fill:#ef4444,color:#fff
    style ALLOW fill:#22c55e,color:#fff
```

**Activation:** `athena check` uses diff-aware by default. `athena scan` uses full mode.

### 3.8 Repository Fingerprinting

```mermaid
flowchart LR
    FIRST["First Scan"] --> COMPUTE["Compute baseline<br/>from all units"]
    COMPUTE --> STORE["Store in<br/>.athena/baseline.json"]
    
    NEXT["Subsequent Scans"] --> LOAD["Load baseline"]
    LOAD --> COMPARE["Compare each unit<br/>against baseline"]
    COMPARE --> DEVIATION["Deviation Score<br/>How far from project style?"]

    style DEVIATION fill:#8b5cf6,color:#fff
```

```typescript
interface RepoBaseline {
  identifierEntropy: { mean: number; stdDev: number };
  commentRatio: { mean: number; stdDev: number };
  namingPatterns: { camelCase: number; snake_case: number; PascalCase: number };
  avgComplexity: number;
  avgLoc: number;
}
```

Converts detection from generic → **context-aware anomaly detection**.

### 3.9 Hallucinated API Detection

```mermaid
flowchart TD
    CODE["Source Code"] --> IMPORTS["Parse imports/<br/>require statements"]
    CODE --> CALLS["Track function/<br/>method calls"]
    
    IMPORTS --> RESOLVE{"Resolve in<br/>node_modules?"}
    RESOLVE -->|No| FLAG1["🔴 Non-existent<br/>package import"]
    RESOLVE -->|Yes| EXPORTS["Check package<br/>exports"]
    
    CALLS --> MATCH{"Method exists<br/>on module?"}
    MATCH -->|No| FLAG2["🔴 Hallucinated<br/>method call"]
    MATCH -->|Yes| OK["✅ Valid call"]
    
    EXPORTS --> NAMED{"Named export<br/>exists?"}
    NAMED -->|No| FLAG3["🔴 Invalid<br/>named import"]
    NAMED -->|Yes| OK

    style FLAG1 fill:#ef4444,color:#fff
    style FLAG2 fill:#ef4444,color:#fff
    style FLAG3 fill:#ef4444,color:#fff
    style OK fill:#22c55e,color:#fff
```

**Example detections:**
```typescript
// ❌ axios.fetchData()       — .fetchData() doesn't exist on axios
// ❌ import { nonExistent } from 'express'
// ❌ fs.readFilePromise()    — not a real fs method
```

### 3.10 Suppression System

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant CLI as Athena CLI
    participant FILE as suppressions.json
    participant ENGINE as Core Engine
    
    DEV->>CLI: athena scan ./src
    CLI->>ENGINE: Run analysis
    ENGINE-->>CLI: Finding ABC123 (false positive)
    CLI-->>DEV: Report shows ABC123
    
    DEV->>CLI: athena suppress ABC123
    CLI->>FILE: Add { findingId: "ABC123", ... }
    
    DEV->>CLI: athena scan ./src (next run)
    CLI->>ENGINE: Run analysis
    ENGINE->>FILE: Check suppressions
    FILE-->>ENGINE: ABC123 suppressed
    ENGINE-->>CLI: Skip ABC123
    CLI-->>DEV: Clean report
```

### 3.11 Temporal Analysis

```mermaid
flowchart LR
    H1["Scan 1<br/>Score: 45"] --> H2["Scan 2<br/>Score: 52"]
    H2 --> H3["Scan 3<br/>Score: 48"]
    H3 --> H4["Scan 4<br/>Score: 61"]
    H4 --> TREND["Trend: ⬆️ Increasing<br/>Direction: degrading<br/>Change: +35%"]

    style H1 fill:#22c55e,color:#fff
    style H2 fill:#eab308,color:#000
    style H3 fill:#eab308,color:#000
    style H4 fill:#f97316,color:#fff
    style TREND fill:#ef4444,color:#fff
```

**CLI:** `athena report --trend`  
**Web:** Line chart of risk over scans on dashboard.

### 3.12 Benchmark Module

```mermaid
flowchart TD
    CORPUS["Benchmark Corpus"]
    
    subgraph AI["benchmarks/ai/"]
        A1["crud-api.ts"]
        A2["react-component.tsx"]
        A3["utility-functions.ts"]
    end
    
    subgraph HUMAN["benchmarks/human/"]
        H1["domain-logic.ts"]
        H2["custom-hook.tsx"]
        H3["algorithm.ts"]
    end
    
    CORPUS --> AI
    CORPUS --> HUMAN
    
    AI --> RUN["athena benchmark"]
    HUMAN --> RUN
    
    RUN --> METRICS["Precision: 0.82<br/>Recall: 0.74<br/>F1 Score: 0.78<br/>False Positive Rate: 0.18"]

    style METRICS fill:#3b82f6,color:#fff
```

---

## 4. CLI Design

### 4.1 Command Structure

```
athena <command> [options]

Commands:
  check [files...]     Scan specific files (default: staged files, diff-aware)
  scan [dir]           Full directory scan
  init                 Install pre-commit hook
  uninstall            Remove pre-commit hook
  report               Generate report from last scan
  suppress <id>        Suppress a finding by ID
  benchmark            Run detection accuracy benchmark
  config               View/edit configuration

Global Options:
  --threshold <n>      AI score threshold (default: 65)
  --format <fmt>       Output format: terminal|json|html|jsonl (default: terminal)
  --no-semgrep         Skip Semgrep analysis
  --verbose            Show all units, not just flagged
  --profile            Show performance timing per phase
  --diff               Diff-aware mode (default for check)
  --no-diff            Force full-file analysis
  --trend              Include trend analysis from history
  --version            Show version
  --help               Show help
```

### 4.2 Pre-commit Hook Flow

```mermaid
flowchart TD
    COMMIT["git commit"] --> HOOK[".git/hooks/pre-commit"]
    HOOK --> STAGED["git diff --cached<br/>--name-only --diff-filter=ACM"]
    STAGED --> FILTER["Filter:<br/>*.js, *.ts, *.jsx, *.tsx"]
    FILTER --> CHECK["athena check <files>"]
    CHECK --> ENGINE["Core Engine<br/>Diff-aware pipeline"]
    ENGINE --> RESULT{Findings?}
    
    RESULT -->|"CRITICAL or HIGH"| BLOCK["Exit 1<br/>❌ Commit Blocked<br/>Print report"]
    RESULT -->|"MEDIUM/LOW/None"| ALLOW["Exit 0<br/>✅ Commit Proceeds"]

    style BLOCK fill:#ef4444,color:#fff
    style ALLOW fill:#22c55e,color:#fff
```

### 4.3 Configuration File

`.athena.config.json` at project root:

```json
{
  "threshold": 65,
  "blockOn": ["CRITICAL", "HIGH"],
  "exclude": [
    "dist/", "build/", "node_modules/",
    "*.test.ts", "*.spec.ts", "*.test.js", "*.spec.js",
    "__tests__/"
  ],
  "semgrep": true,
  "eslint": true,
  "secretDetection": true,
  "hallucinationDetection": true,
  "reportFormat": "terminal",
  "maxFileSize": 102400,
  "historyDir": ".athena/history",
  "weights": {
    "genericNames": 15,
    "commentRatio": 12,
    "obviousComments": 10,
    "emptyCatch": 10,
    "nullChecks": 8,
    "formattingUniformity": 8,
    "universalJsdoc": 7,
    "namingEntropy": 10,
    "boilerplatePatterns": 10,
    "helperOrdering": 10,
    "emojiComments": 10
  }
}
```

### 4.4 Result Storage (CLI)

```mermaid
graph TD
    SCAN["athena scan"] --> RESULT["ScanReport JSON"]
    RESULT --> HISTORY[".athena/history/<br/>2026-04-15T10-30-00.json"]
    RESULT --> LATEST[".athena/history/latest.json<br/>(symlink)"]
    
    FIRST_SCAN["First scan"] --> BASELINE[".athena/baseline.json<br/>(repo fingerprint)"]
    
    SUPPRESS_CMD["athena suppress"] --> SUPPRESSIONS[".athena/suppressions.json"]
    
    CONFIG["athena config"] --> CONFIG_FILE[".athena/config.json<br/>(resolved config)"]
```

---

## 5. Web Platform Design

### 5.1 Frontend Architecture

```mermaid
graph TD
    subgraph PAGES["Pages"]
        LANDING["Landing<br/>Hero + Features + CTA"]
        LOGIN["Login"]
        REGISTER["Register"]
        DASHBOARD["Dashboard<br/>Scan History + Stats + Trends"]
        SCANPAGE["Scan Page<br/>URL Input + Live Terminal"]
        REPORTPAGE["Report Page<br/>Full Report View"]
    end
    
    subgraph COMPONENTS["Components"]
        TERMINAL["Terminal<br/>xterm.js wrapper"]
        REPORTVIEW["ReportView<br/>Severity cards + code blocks"]
        SCOREGAUGE["ScoreGauge<br/>AI % visualization"]
        SEVERITY["SeverityBadge"]
        CODEBLOCK["CodeBlock<br/>Highlighted snippets"]
        NAVBAR["Navbar"]
        PROTECTED["ProtectedRoute"]
    end
    
    subgraph HOOKS["Hooks"]
        USEWS["useWebSocket"]
        USEAUTH["useAuth"]
    end
    
    SCANPAGE --> TERMINAL
    SCANPAGE --> USEWS
    REPORTPAGE --> REPORTVIEW
    REPORTPAGE --> SCOREGAUGE
    DASHBOARD --> REPORTVIEW
    PROTECTED --> USEAUTH
```

### 5.2 Terminal Component (xterm.js)

```mermaid
sequenceDiagram
    participant USER as User Browser
    participant XTERM as xterm.js
    participant WS as WebSocket
    participant SERVER as Backend
    participant ENGINE as Core Engine
    
    USER->>SERVER: POST /api/scans { repoUrl }
    SERVER-->>USER: { scanId, wsUrl }
    
    USER->>WS: Connect ws://host/ws/scan/:scanId
    
    SERVER->>ENGINE: Clone repo
    ENGINE-->>WS: { type: "log", data: "⠋ Cloning..." }
    WS-->>XTERM: write("⠋ Cloning...")
    
    SERVER->>ENGINE: Parse AST
    ENGINE-->>WS: { type: "progress", stage: "parsing", percent: 45 }
    WS-->>XTERM: write("✓ Parsed 89 files")
    
    SERVER->>ENGINE: Run analysis
    ENGINE-->>WS: { type: "log", data: "⠋ Analyzing..." }
    WS-->>XTERM: write("⠋ Analyzing...")
    
    ENGINE-->>WS: { type: "result", report: ScanReport }
    WS-->>XTERM: Render results box
    WS-->>USER: Display ReportView
```

**Tech:** xterm.js v5 + `@xterm/addon-fit` + `@xterm/addon-web-links`  
**Theme:** Monokai dark, JetBrains Mono font  
**Mode:** Read-only (sandboxed — no user input accepted)

### 5.3 Backend Architecture

```mermaid
graph TD
    subgraph ROUTES["Routes"]
        AUTH_R["POST /api/auth/register<br/>POST /api/auth/login"]
        SCAN_R["POST /api/scans<br/>GET /api/scans<br/>GET /api/scans/:id"]
        REPORT_R["GET /api/reports/:scanId"]
    end
    
    subgraph SERVICES["Services"]
        AUTH_S["Auth Service<br/>JWT + bcrypt"]
        SCAN_S["Scan Service<br/>Clone → Analyze → Stream"]
        SANDBOX_S["Sandbox Manager<br/>Isolated temp dirs"]
        WS_S["WebSocket Service<br/>Connection manager"]
    end
    
    subgraph MIDDLEWARE["Middleware"]
        AUTH_M["JWT Verification"]
        RATE["Rate Limiting<br/>10 scans/hour"]
        ERROR["Error Handler"]
    end
    
    AUTH_R --> AUTH_S
    SCAN_R --> AUTH_M
    AUTH_M --> SCAN_S
    SCAN_S --> SANDBOX_S
    SCAN_S --> WS_S
    SCAN_S --> CORE["@athena/core"]
    
    style CORE fill:#3b82f6,color:#fff
```

### 5.4 API Contracts

#### Authentication
```
POST /api/auth/register
Body: { email: string, password: string }
Response: { token: string, user: { id, email } }

POST /api/auth/login
Body: { email: string, password: string }
Response: { token: string, user: { id, email } }
```

#### Scans
```
POST /api/scans
Headers: Authorization: Bearer <token>
Body: { repoUrl: string }
Response: { scanId: string, wsUrl: string }

GET /api/scans
Headers: Authorization: Bearer <token>
Response: { scans: Scan[] }

GET /api/scans/:id
Headers: Authorization: Bearer <token>
Response: { scan: Scan, report: ScanReport }
```

#### WebSocket Protocol
```
Client connects to: ws://host/ws/scan/:scanId

Server → Client messages (JSON):
  { type: 'log', data: string }
  { type: 'progress', stage: string, percent: number }
  { type: 'result', report: ScanReport }
  { type: 'error', message: string }
```

### 5.5 Scan Execution Flow (Web)

```mermaid
flowchart TD
    USER["User submits GitHub URL"] --> POST["POST /api/scans"]
    POST --> CREATE["Create Scan record<br/>Status: PENDING"]
    CREATE --> RETURN["Return scanId + WS URL"]
    RETURN --> CONNECT["Frontend connects WebSocket"]
    
    CONNECT --> CLONE["1. git clone --depth 1<br/>→ isolated temp dir"]
    CLONE --> VALIDATE["2. Validate:<br/>file count, total size"]
    VALIDATE --> RUN["3. Run @athena/core<br/>Stream progress via WS"]
    RUN --> SAVE["4. Save report to DB<br/>Status: COMPLETED"]
    SAVE --> SEND["5. Send final report<br/>via WebSocket"]
    SEND --> CLEANUP["6. Cleanup temp dir"]
    
    CLEANUP --> RENDER["Frontend renders<br/>Terminal + ReportView"]
    
    VALIDATE -->|"Too large"| FAIL["❌ FAILED<br/>Size limit exceeded"]
    CLONE -->|"Error"| FAIL
    
    style USER fill:#3b82f6,color:#fff
    style RENDER fill:#22c55e,color:#fff
    style FAIL fill:#ef4444,color:#fff
```

### 5.6 Sandbox Manager

```mermaid
flowchart TD
    REQ["Scan Request"] --> CHECK{"Concurrent<br/>scans < 3?"}
    CHECK -->|No| QUEUE["Queue request"]
    CHECK -->|Yes| CREATE["Create sandbox<br/>/tmp/athena-scanId/"]
    
    CREATE --> CLONE["git clone --depth 1"]
    CLONE --> SIZE{"Repo size<br/>< 100MB?"}
    SIZE -->|No| ABORT["Abort + cleanup"]
    SIZE -->|Yes| SCAN["Run analysis<br/>Timeout: 120s"]
    
    SCAN --> COMPLETE["Save results"]
    COMPLETE --> DESTROY["rm -rf temp dir"]
    
    SCAN -->|Timeout| KILL["Kill process"]
    KILL --> DESTROY
    SCAN -->|Error| DESTROY
    
    style ABORT fill:#ef4444,color:#fff
    style DESTROY fill:#f97316,color:#fff
```

**Security constraints:**
- Temp dirs in OS temp directory, not project root
- Max concurrent scans: 3
- Repo size limit: 100MB post-clone
- Scan timeout: 120 seconds
- Auto-cleanup on completion/error/timeout

### 5.7 Sandboxed Terminal

The web terminal is **read-only** — users cannot execute arbitrary commands.

```mermaid
flowchart TD
    subgraph BACKEND["Backend Sandbox"]
        TEMP["Isolated temp dir<br/>/tmp/athena-scanId/"]
        CLONE["git clone (depth 1)"]
        ENGINE["Core engine<br/>(read-only analysis)"]
        
        TEMP --> CLONE --> ENGINE
    end
    
    subgraph CONSTRAINTS["Security Constraints"]
        C1["❌ No shell access"]
        C2["❌ No code execution"]
        C3["✅ Read-only file analysis"]
        C4["⏱️ Process-level timeout"]
        C5["🧹 Auto-cleanup on exit"]
        C6["🔒 Blocked network egress"]
    end
    
    ENGINE -->|"stdout via WS"| XTERM["Frontend Terminal<br/>xterm.js"]
    
    subgraph XTERM_PROPS["Terminal Properties"]
        P1["✅ Read-only display"]
        P2["❌ No user input"]
        P3["✅ ANSI rendering"]
    end

    style XTERM fill:#06b6d4,color:#fff
```

---

## 6. Database Design

### 6.1 Entity Relationship Diagram

```mermaid
erDiagram
    USER ||--o{ SCAN : "has many"
    
    USER {
        uuid id PK
        string email UK
        string password
        datetime createdAt
        datetime updatedAt
    }
    
    SCAN {
        uuid id PK
        string repoUrl
        string repoName
        enum status "PENDING | RUNNING | COMPLETED | FAILED"
        json result
        json summary
        int fileCount
        int flaggedCount
        int duration
        uuid userId FK
        datetime createdAt
        datetime updatedAt
    }
```

### 6.2 Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  scans     Scan[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Scan {
  id           String     @id @default(uuid())
  repoUrl      String
  repoName     String
  status       ScanStatus @default(PENDING)
  result       Json?
  summary      Json?
  fileCount    Int?
  flaggedCount Int?
  duration     Int?
  userId       String
  user         User       @relation(fields: [userId], references: [id])
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@index([userId])
  @@index([createdAt])
}

enum ScanStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}
```

---

## 7. Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Language** | TypeScript (strict) | Type safety, TS Compiler API access, team's strongest language |
| **AST Parsing** | TypeScript Compiler API | Native, no extra dependency, handles JS/TS/JSX/TSX |
| **CLI Framework** | Commander.js | Mature, 0 deps, widely adopted, excellent TypeScript support |
| **CLI UI** | Chalk + Ora | Industry standard for colored output + spinners |
| **Web Frontend** | React + Vite | Fast dev server, SPA sufficient (no SSR needed) |
| **Terminal UI** | xterm.js v5 | Same engine as VS Code terminal, ANSI support |
| **Web Backend** | Express.js | Simple, proven, good WS integration |
| **WebSocket** | ws library | Lightweight, performant, no Socket.io overhead |
| **Database** | PostgreSQL + Prisma | Typed ORM, migration support, full-stack credibility |
| **Auth** | JWT + bcrypt | Stateless, simple, sufficient for this use case |
| **Security Analysis** | ESLint (programmatic) + Semgrep (subprocess) | ESLint = zero friction, Semgrep = comprehensive rules |
| **Secret Detection** | Native (regex + entropy) | No external dep, full control |
| **Build (CLI)** | tsup | esbuild-based, fast, single file output |
| **Build (Web)** | Vite | Built-in for frontend, fast HMR |
| **Testing** | Vitest | Fast, Vite-native, Jest-compatible API |
| **Packaging** | npm (@arsh342/athena) | npm scope = guaranteed availability |

---

## 8. Security Considerations

### 8.1 Threat Model

```mermaid
flowchart TD
    subgraph THREATS["Threat Vectors"]
        T1["Malicious repo URL<br/>(command injection)"]
        T2["Oversized repo<br/>(resource exhaustion)"]
        T3["Concurrent overload<br/>(DoS)"]
        T4["Auth bypass"]
        T5["Sensitive data in logs"]
    end
    
    subgraph MITIGATIONS["Mitigations"]
        M1["URL format validation<br/>before clone"]
        M2["100MB size limit<br/>120s timeout"]
        M3["Rate limit: 10/hour<br/>Concurrent limit: 3"]
        M4["JWT w/ bcrypt<br/>salt rounds 12"]
        M5["Structured logging<br/>no secrets in logs"]
    end
    
    T1 --> M1
    T2 --> M2
    T3 --> M3
    T4 --> M4
    T5 --> M5
```

### 8.2 Web Platform Security
- **Repo cloning** — depth 1 only, size limit, timeout, isolated temp dirs
- **Auth** — bcrypt w/ salt rounds 12, JWT expiry 24h
- **Rate limiting** — max 10 scans/hour per user
- **Input validation** — GitHub URL format validation before clone attempt
- **No code execution** — Athena reads/parses code, never executes it
- **CORS** — restricted to frontend origin only

### 8.3 CLI Security
- **No telemetry** — zero external network calls
- **No code execution** — AST parsing only, subprocess calls to trusted tools only
- **Config validation** — schema validation on `.athena.config.json`

---

## 9. Performance Targets

| Metric | Target |
|--------|--------|
| CLI scan: 50-file repo | < 10 seconds |
| CLI scan: single file | < 1 second |
| Web: clone + scan (50-file repo) | < 30 seconds |
| AST parse: single file | < 100ms |
| Heuristic score: single unit | < 5ms |
| Secret detection: single file | < 50ms |
| Memory: CLI peak | < 256MB |

---

## 10. Deployment Architecture

### 10.1 Deployment Diagram

```mermaid
graph TD
    subgraph DEV["Developer Machine"]
        CLI_LOCAL["athena CLI<br/>npm install -g @arsh342/athena"]
        GIT_LOCAL["Git repo + .git/hooks"]
    end
    
    subgraph CLOUD["Cloud"]
        subgraph VERCEL["Vercel / Netlify"]
            FE_DEPLOY["React SPA<br/>(Static files)"]
        end
        
        subgraph RAILWAY["Railway / Render"]
            BE_DEPLOY["Node.js Backend<br/>Express + WS"]
        end
        
        subgraph DB_HOST["Railway / Supabase"]
            PG_DEPLOY["PostgreSQL"]
        end
    end
    
    subgraph NPM["npmjs.com"]
        PACKAGE["@arsh342/athena<br/>Published package"]
    end
    
    CLI_LOCAL -.->|"npm install"| PACKAGE
    FE_DEPLOY <-->|"HTTPS"| BE_DEPLOY
    FE_DEPLOY <-->|"WSS"| BE_DEPLOY
    BE_DEPLOY --> PG_DEPLOY
    
    BROWSER["Developer Browser"] --> FE_DEPLOY

    style PACKAGE fill:#cb3837,color:#fff
    style PG_DEPLOY fill:#336791,color:#fff
```

### 10.2 Environment Variables (Backend)

```env
DATABASE_URL=postgresql://user:pass@host:5432/athena
JWT_SECRET=<random-64-char-string>
PORT=3001
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
MAX_CONCURRENT_SCANS=3
MAX_REPO_SIZE_MB=100
SCAN_TIMEOUT_MS=120000
```

---

## 11. Error Handling Strategy

```mermaid
flowchart TD
    ERR["Error Occurs"] --> TYPE{Error Type}
    
    TYPE -->|"Parse failure"| SKIP["Skip file<br/>Log warning<br/>Continue scan"]
    TYPE -->|"Semgrep missing"| DEGRADE["Skip Semgrep<br/>Log info<br/>Continue w/ ESLint"]
    TYPE -->|"Clone failure"| REPORT_ERR["Return error<br/>w/ details"]
    TYPE -->|"Clone timeout"| KILL_PROC["Kill process<br/>Cleanup temp dir<br/>Return timeout error"]
    TYPE -->|"Clone too large"| ABORT_CLONE["Abort clone<br/>Cleanup<br/>Return size error"]
    TYPE -->|"DB failure"| RETRY["Return 503<br/>Retry w/ backoff"]
    TYPE -->|"WS disconnect"| CONTINUE["Continue scan<br/>Save results<br/>User views via GET"]
    TYPE -->|"Invalid config"| DEFAULT["Fall back to<br/>defaults<br/>Log warning"]

    style SKIP fill:#eab308,color:#000
    style DEGRADE fill:#eab308,color:#000
    style REPORT_ERR fill:#ef4444,color:#fff
    style KILL_PROC fill:#ef4444,color:#fff
```

---

## 12. Future Scope

1. **LLM explanation layer** — optional API call to explain findings in plain English
2. **Python support** — Bandit integration, Python AST parsing
3. **VS Code extension** — inline highlighting of AI-flagged sections
4. **ML classifier** — train on labeled AI vs human code corpus (replace heuristics)
5. **Team features** — shared dashboards, org-wide policies
6. **Intra-file call graph** — trace data flow from flagged units to unsafe sinks
7. **GitHub App integration** — PR review bot with inline comments
8. **Multi-language support** — Go, Rust, Java via tree-sitter

---

## 13. CI Integration (Minimal)

No full GitHub Actions pipeline built. Provide usage example in README:

```yaml
# .github/workflows/athena.yml
name: Athena Code Scan
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install -g @arsh342/athena
      - run: athena scan . --format json
```

Shows real-world applicability without scope explosion.

---

## 14. Diagram Index

| # | Diagram | Section | Type |
|---|---------|---------|------|
| 1 | System Overview | §2.1 | Architecture |
| 2 | Package Dependency Graph | §2.4 | Dependency |
| 3 | Core Pipeline | §3.1 | Flowchart |
| 4 | AST Extraction | §3.2 | Flowchart |
| 5 | Signal Architecture | §3.3 | Flowchart |
| 6 | Security Analysis Flow | §3.4 | Flowchart |
| 7 | Secret Detection | §3.4.3 | Flowchart |
| 8 | Severity Matrix | §3.5 | Quadrant |
| 9 | Diff-Aware Flow | §3.7 | Flowchart |
| 10 | Repo Fingerprinting | §3.8 | Flowchart |
| 11 | Hallucination Detection | §3.9 | Flowchart |
| 12 | Suppression Sequence | §3.10 | Sequence |
| 13 | Temporal Analysis | §3.11 | Flowchart |
| 14 | Benchmark Module | §3.12 | Flowchart |
| 15 | Pre-commit Hook | §4.2 | Flowchart |
| 16 | Result Storage | §4.4 | Graph |
| 17 | Frontend Architecture | §5.1 | Graph |
| 18 | Terminal WebSocket Sequence | §5.2 | Sequence |
| 19 | Backend Architecture | §5.3 | Graph |
| 20 | Scan Execution Flow | §5.5 | Flowchart |
| 21 | Sandbox Manager | §5.6 | Flowchart |
| 22 | Sandboxed Terminal | §5.7 | Flowchart |
| 23 | ER Diagram | §6.1 | ERD |
| 24 | Threat Model | §8.1 | Flowchart |
| 25 | Deployment Diagram | §10.1 | Architecture |
| 26 | Error Handling | §11 | Flowchart |
