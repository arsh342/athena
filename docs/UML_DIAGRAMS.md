# Athena — UML Diagrams

> **Version:** 1.0  
> **Date:** April 2026  

---

## 1. System Architecture Diagram

```mermaid
graph TB
    subgraph CLIENT_LAYER["Client Layer"]
        DEV_TERM["Developer Terminal"]
        DEV_BROWSER["Developer Browser"]
    end

    subgraph APPLICATION_LAYER["Application Layer"]
        subgraph CLI_APP["CLI Application"]
            CLI_ENTRY["CLI Entry Point<br/>(Commander.js)"]
            CLI_CMDS["Commands<br/>check | scan | init | report<br/>suppress | benchmark | config"]
            CLI_HOOKS["Git Hook Manager<br/>pre-commit installer"]
            CLI_TERMUI["Terminal UI<br/>Chalk + Ora"]
        end

        subgraph WEB_APP["Web Application"]
            subgraph FRONTEND["Frontend (React + Vite)"]
                ROUTER["React Router"]
                PAGES["Pages<br/>Landing | Dashboard<br/>Scan | Report | Auth"]
                UI_COMPONENTS["UI Components<br/>Terminal | ScoreGauge<br/>ReportView | SeverityBadge"]
                WS_HOOK["useWebSocket Hook"]
                AUTH_HOOK["useAuth Hook"]
            end

            subgraph BACKEND["Backend (Express)"]
                REST_API["REST API<br/>/api/auth/*<br/>/api/scans/*<br/>/api/reports/*"]
                WS_SERVER["WebSocket Server<br/>Live scan streaming"]
                AUTH_MW["Auth Middleware<br/>JWT verification"]
                RATE_MW["Rate Limiter<br/>10 req/hour"]
                SANDBOX_MGR["Sandbox Manager<br/>Isolated temp dirs"]
            end
        end
    end

    subgraph CORE_LAYER["Core Engine Layer (@athena/core)"]
        ENGINE["Engine Orchestrator"]
        AST_PARSER["AST Parser<br/>TypeScript Compiler API"]
        HEURISTIC["Heuristic Scorer<br/>11 Configurable Signals"]
        SECURITY["Security Analyzer"]
        DIFF_ENGINE["Diff Analyzer"]
        BASELINE_ENGINE["Repo Fingerprint"]
        HALLUC_ENGINE["Hallucination Detector"]
        SUPPRESS_ENGINE["Suppression Manager"]
        REPORT_GEN["Report Generator<br/>Terminal | JSON | HTML | JSONL"]
        BENCHMARK["Benchmark Runner<br/>Precision / Recall / F1"]

        ENGINE --> AST_PARSER
        ENGINE --> HEURISTIC
        ENGINE --> SECURITY
        ENGINE --> DIFF_ENGINE
        ENGINE --> BASELINE_ENGINE
        ENGINE --> HALLUC_ENGINE
        ENGINE --> SUPPRESS_ENGINE
        ENGINE --> REPORT_GEN
    end

    subgraph SECURITY_LAYER["Security Analysis Sub-layer"]
        ESLINT["ESLint<br/>Programmatic API<br/>eslint-plugin-security"]
        SEMGREP["Semgrep<br/>Subprocess (optional)"]
        SECRET_DET["Secret Detector<br/>Regex + Shannon Entropy"]
    end

    subgraph DATA_LAYER["Data Layer"]
        PG["PostgreSQL<br/>(Web scan results + users)"]
        JSON_STORE[".athena/ Directory<br/>history/ | baseline.json<br/>suppressions.json"]
    end

    subgraph EXTERNAL["External Systems"]
        GIT_REPO["Git Repositories<br/>(GitHub / local)"]
        NPM_REG["npm Registry<br/>@arsh342/athena"]
    end

    DEV_TERM --> CLI_APP
    DEV_BROWSER --> FRONTEND
    FRONTEND <-->|"HTTP + WS"| BACKEND

    CLI_APP --> CORE_LAYER
    BACKEND --> CORE_LAYER

    SECURITY --> ESLINT
    SECURITY --> SEMGREP
    SECURITY --> SECRET_DET

    CLI_APP --> JSON_STORE
    BACKEND --> PG
    BACKEND --> GIT_REPO
    CLI_APP --> GIT_REPO
    NPM_REG -.->|"npm install"| CLI_APP
```

---

## 2. ER Diagram

```mermaid
erDiagram
    USER {
        uuid id PK "Primary Key"
        varchar email UK "Unique, indexed"
        varchar password "bcrypt hashed, 12 salt rounds"
        timestamp createdAt "Default: now()"
        timestamp updatedAt "Auto-updated"
    }

    SCAN {
        uuid id PK "Primary Key"
        varchar repoUrl "GitHub/GitLab URL"
        varchar repoName "Extracted repo name"
        enum status "PENDING | RUNNING | COMPLETED | FAILED"
        jsonb result "Full ScanReport JSON"
        jsonb summary "Summary metrics snapshot"
        int fileCount "Total files scanned"
        int flaggedCount "Units above threshold"
        float aiPercentage "Repo-level AI score"
        int duration "Scan duration in ms"
        uuid userId FK "References User.id"
        timestamp createdAt "Indexed for queries"
        timestamp updatedAt "Auto-updated"
    }

    SUPPRESSION {
        uuid id PK "Primary Key"
        varchar findingId "Original finding hash"
        varchar file "File path"
        int line "Line number"
        varchar reason "User-provided reason"
        varchar suppressedBy "manual | auto"
        uuid scanId FK "Scan where found"
        uuid userId FK "Who suppressed"
        timestamp createdAt "When suppressed"
    }

    USER ||--o{ SCAN : "creates"
    USER ||--o{ SUPPRESSION : "creates"
    SCAN ||--o{ SUPPRESSION : "has"
```

---

## 3. Use Case Diagram

```mermaid
flowchart TD
    subgraph ACTORS["Actors"]
        DEV["Developer<br/>(CLI User)"]
        WEBUSER["Web User<br/>(Browser)"]
        GITSERVER["Git Server<br/>(GitHub/GitLab)"]
        SEMGREP_BIN["Semgrep<br/>(Optional Tool)"]
    end

    subgraph UC_CLI["CLI Use Cases"]
        UC1["UC1: Scan Files<br/>athena scan ./src"]
        UC2["UC2: Check Staged Files<br/>athena check (diff-aware)"]
        UC3["UC3: Install Pre-commit Hook<br/>athena init"]
        UC4["UC4: Remove Pre-commit Hook<br/>athena uninstall"]
        UC5["UC5: View Report<br/>athena report"]
        UC6["UC6: View Trend<br/>athena report --trend"]
        UC7["UC7: Suppress Finding<br/>athena suppress id"]
        UC8["UC8: Run Benchmark<br/>athena benchmark"]
        UC9["UC9: Configure Settings<br/>athena config"]
        UC10["UC10: Profile Performance<br/>athena scan --profile"]
    end

    subgraph UC_WEB["Web Use Cases"]
        UC11["UC11: Register Account"]
        UC12["UC12: Login"]
        UC13["UC13: Submit Repo URL for Scan"]
        UC14["UC14: View Live Scan Progress<br/>(Sandboxed Terminal)"]
        UC15["UC15: View Scan Report<br/>(Severity + AI Score)"]
        UC16["UC16: View Dashboard<br/>(History + Trends)"]
        UC17["UC17: View Risk Density"]
        UC18["UC18: Export Report<br/>(JSON / HTML / JSONL)"]
    end

    subgraph UC_CORE["Core Engine Use Cases (Internal)"]
        UC19["UC19: Parse AST<br/>Extract CodeUnits"]
        UC20["UC20: Score AI Likelihood<br/>11 Signals"]
        UC21["UC21: Run Security Analysis<br/>ESLint + Secrets"]
        UC22["UC22: Detect Hallucinated APIs"]
        UC23["UC23: Build Repo Baseline"]
        UC24["UC24: Classify Severity"]
        UC25["UC25: Generate Report"]
    end

    DEV --> UC1
    DEV --> UC2
    DEV --> UC3
    DEV --> UC4
    DEV --> UC5
    DEV --> UC6
    DEV --> UC7
    DEV --> UC8
    DEV --> UC9
    DEV --> UC10

    WEBUSER --> UC11
    WEBUSER --> UC12
    WEBUSER --> UC13
    WEBUSER --> UC14
    WEBUSER --> UC15
    WEBUSER --> UC16
    WEBUSER --> UC17
    WEBUSER --> UC18

    UC1 --> UC19
    UC2 --> UC19
    UC13 --> UC19
    UC19 --> UC20
    UC20 --> UC21
    UC21 --> UC24
    UC24 --> UC25

    UC13 -.->|"clone"| GITSERVER
    UC21 -.->|"optional"| SEMGREP_BIN
    UC22 -.-> UC21
    UC23 -.-> UC20
```

---

## 4. Sequence Diagrams

### 4.1 CLI Scan Flow

```mermaid
sequenceDiagram
    actor DEV as Developer
    participant CLI as CLI (Commander.js)
    participant ENGINE as Core Engine
    participant AST as AST Parser
    participant SCORER as Heuristic Scorer
    participant SEC as Security Analyzer
    participant ESLINT as ESLint
    participant SECRET as Secret Detector
    participant HALLUC as Hallucination Detector
    participant REPORT as Report Generator
    participant FS as File System (.athena/)

    DEV->>CLI: athena scan ./src --profile
    CLI->>CLI: Load .athena.config.json
    CLI->>CLI: Resolve file list (glob + filter)
    CLI->>ENGINE: scan(files, config)

    loop For each file
        ENGINE->>AST: parse(filePath)
        AST->>AST: ts.createSourceFile()
        AST->>AST: Extract functions, classes, methods
        AST-->>ENGINE: CodeUnit[]
    end

    ENGINE->>ENGINE: Load .athena/baseline.json (if exists)

    loop For each CodeUnit
        ENGINE->>SCORER: score(unit, baseline, weights)
        SCORER->>SCORER: Run 11 signals
        SCORER->>SCORER: Normalize 110 → 0-100
        SCORER->>SCORER: Assign confidence band
        SCORER->>SCORER: Compute top-3 signals
        SCORER-->>ENGINE: ScoredUnit
    end

    ENGINE->>ENGINE: Filter: score >= threshold

    loop For each flagged unit
        ENGINE->>SEC: analyze(flaggedUnit)
        SEC->>ESLINT: lintText(code)
        ESLINT-->>SEC: ESLint findings
        SEC->>SECRET: detect(code)
        SECRET-->>SEC: Secret findings
        SEC->>HALLUC: detect(code, imports)
        HALLUC-->>SEC: Hallucination findings
        SEC-->>ENGINE: ClassifiedFinding[]
    end

    ENGINE->>ENGINE: Load .athena/suppressions.json
    ENGINE->>ENGINE: Filter out suppressed findings
    ENGINE->>ENGINE: Compute risk density + AI percentage

    ENGINE->>REPORT: generate(results, format)
    REPORT-->>ENGINE: Formatted output

    ENGINE->>FS: Save to .athena/history/
    ENGINE->>FS: Update .athena/baseline.json (first run)
    ENGINE-->>CLI: ScanReport

    CLI->>CLI: Print terminal output
    CLI->>CLI: Print performance profile
    CLI-->>DEV: Report + exit code
```

### 4.2 Pre-commit Hook Flow

```mermaid
sequenceDiagram
    actor DEV as Developer
    participant GIT as Git
    participant HOOK as pre-commit hook
    participant CLI as athena check
    participant ENGINE as Core Engine
    participant DIFF as Diff Analyzer

    DEV->>GIT: git commit -m "feat: add utils"
    GIT->>HOOK: Execute .git/hooks/pre-commit

    HOOK->>GIT: git diff --cached --name-only --diff-filter=ACM
    GIT-->>HOOK: staged_files.ts, helper.ts

    HOOK->>HOOK: Filter: *.ts, *.js, *.tsx, *.jsx
    HOOK->>CLI: athena check staged_files.ts helper.ts

    CLI->>DIFF: Parse git diff --cached
    DIFF-->>CLI: Changed line ranges per file

    CLI->>ENGINE: scan(files, config, diffRanges)
    ENGINE->>ENGINE: Parse → Score → Analyze (diff-aware)
    ENGINE-->>CLI: ScanReport

    alt CRITICAL or HIGH findings
        CLI-->>HOOK: Exit code 1
        HOOK-->>GIT: Abort commit
        GIT-->>DEV: ❌ Commit blocked + report printed
    else No blocking findings
        CLI-->>HOOK: Exit code 0
        HOOK-->>GIT: Continue commit
        GIT-->>DEV: ✅ Commit proceeds
    end
```

### 4.3 Web Scan Flow

```mermaid
sequenceDiagram
    actor USER as Web User
    participant FE as Frontend (React)
    participant API as Backend API
    participant AUTH as Auth Middleware
    participant DB as PostgreSQL
    participant SANDBOX as Sandbox Manager
    participant ENGINE as Core Engine
    participant WS as WebSocket

    USER->>FE: Enter GitHub repo URL
    FE->>API: POST /api/scans { repoUrl }
    API->>AUTH: Verify JWT
    AUTH-->>API: User authenticated

    API->>API: Validate URL format
    API->>DB: INSERT Scan (status: PENDING)
    DB-->>API: scanId

    API-->>FE: { scanId, wsUrl }
    FE->>WS: Connect ws://host/ws/scan/:scanId

    par Async scan process
        API->>SANDBOX: createSandbox(scanId)
        SANDBOX-->>API: /tmp/athena-scanId/

        API->>WS: { type: "log", data: "Cloning repository..." }
        WS-->>FE: Display in xterm.js

        API->>API: git clone --depth 1 repoUrl
        API->>DB: UPDATE Scan (status: RUNNING)

        API->>SANDBOX: validateRepo(dir)
        
        alt Repo too large
            API->>WS: { type: "error", message: "Repo exceeds 100MB limit" }
            API->>SANDBOX: cleanup()
            API->>DB: UPDATE Scan (status: FAILED)
        else Valid
            API->>ENGINE: scan(files, config)
            
            loop Progress updates
                ENGINE-->>WS: { type: "progress", stage: "parsing", percent: 45 }
                WS-->>FE: Update progress bar
            end

            ENGINE-->>API: ScanReport

            API->>DB: UPDATE Scan (status: COMPLETED, result: report)
            API->>WS: { type: "result", report: ScanReport }
            WS-->>FE: Render ReportView + ScoreGauge

            API->>SANDBOX: cleanup()
        end
    end

    USER->>FE: View report details
    FE->>API: GET /api/scans/:id
    API->>DB: SELECT Scan
    DB-->>API: Scan + Report
    API-->>FE: Full report data
```

### 4.4 User Authentication Flow

```mermaid
sequenceDiagram
    actor USER as Web User
    participant FE as Frontend
    participant API as Backend
    participant DB as PostgreSQL

    Note over USER,DB: Registration Flow
    USER->>FE: Fill register form
    FE->>API: POST /api/auth/register { email, password }
    API->>API: Validate email format
    API->>DB: Check email uniqueness
    alt Email exists
        API-->>FE: 409 Conflict
        FE-->>USER: "Email already registered"
    else New email
        API->>API: bcrypt.hash(password, 12)
        API->>DB: INSERT User
        API->>API: jwt.sign({ userId }, secret, { expiresIn: "24h" })
        API-->>FE: { token, user: { id, email } }
        FE->>FE: Store token in localStorage
        FE-->>USER: Redirect to Dashboard
    end

    Note over USER,DB: Login Flow
    USER->>FE: Fill login form
    FE->>API: POST /api/auth/login { email, password }
    API->>DB: SELECT User by email
    alt User not found
        API-->>FE: 401 Unauthorized
    else User found
        API->>API: bcrypt.compare(password, hash)
        alt Password mismatch
            API-->>FE: 401 Unauthorized
        else Password matches
            API->>API: jwt.sign({ userId }, secret)
            API-->>FE: { token, user }
            FE->>FE: Store token
            FE-->>USER: Redirect to Dashboard
        end
    end
```

### 4.5 Suppression Flow

```mermaid
sequenceDiagram
    actor DEV as Developer
    participant CLI as Athena CLI
    participant ENGINE as Core Engine
    participant FS as suppressions.json

    DEV->>CLI: athena scan ./src
    CLI->>ENGINE: Run full analysis
    ENGINE-->>CLI: Report with Finding ABC123

    Note over DEV: Developer reviews finding,<br/>determines false positive

    DEV->>CLI: athena suppress ABC123 --reason "known pattern"
    CLI->>FS: Read existing suppressions
    CLI->>FS: Append { findingId: "ABC123", reason: "known pattern", ... }
    CLI-->>DEV: "Finding ABC123 suppressed"

    DEV->>CLI: athena scan ./src (next run)
    CLI->>ENGINE: Run analysis
    ENGINE->>FS: Load suppressions
    ENGINE->>ENGINE: Match findings against suppressions
    ENGINE->>ENGINE: Filter out ABC123
    ENGINE-->>CLI: Report WITHOUT ABC123
    CLI-->>DEV: Clean report
```

---

## 5. Activity Diagrams

### 5.1 Core Engine Pipeline Activity

```mermaid
flowchart TD
    START(("Start")) --> LOAD_CONFIG["Load Configuration<br/>.athena.config.json"]
    LOAD_CONFIG --> RESOLVE_FILES["Resolve File List<br/>Apply glob + exclude patterns"]
    RESOLVE_FILES --> DIFF_MODE{"Diff-Aware<br/>Mode?"}

    DIFF_MODE -->|Yes| PARSE_DIFF["Parse git diff<br/>Extract changed line ranges"]
    DIFF_MODE -->|No| PARSE_ALL["Use all files"]

    PARSE_DIFF --> PARSE_AST
    PARSE_ALL --> PARSE_AST

    PARSE_AST["Parse AST<br/>ts.createSourceFile()"]
    PARSE_AST --> EXTRACT["Extract CodeUnits<br/>Functions, Classes, Methods"]
    EXTRACT --> FILTER_SIZE{"LOC >= 3?"}
    FILTER_SIZE -->|No| SKIP_UNIT["Skip Unit"]
    FILTER_SIZE -->|Yes| CHECK_DIFF{"In diff<br/>range?"}

    CHECK_DIFF -->|"N/A (full mode)"| SCORE
    CHECK_DIFF -->|Yes| SCORE
    CHECK_DIFF -->|No| SKIP_UNIT

    SCORE["Run 11 Heuristic Signals"]
    SCORE --> NORMALIZE["Normalize Score<br/>110 → 0-100"]
    NORMALIZE --> BASELINE_CHECK{"Baseline<br/>exists?"}

    BASELINE_CHECK -->|Yes| DEVIATION["Compute Deviation<br/>from repo baseline"]
    BASELINE_CHECK -->|No| BAND

    DEVIATION --> BAND["Assign Confidence Band<br/>LOW | UNCERTAIN | HIGH"]
    BAND --> EXPLAIN["Compute Explainability<br/>Top 3 signals + % contribution"]
    EXPLAIN --> THRESHOLD{"Score >= Threshold?"}

    THRESHOLD -->|No| COLLECT_PASS["Add to unflagged results"]
    THRESHOLD -->|Yes| SECURITY_ANALYZE

    SECURITY_ANALYZE["Run Security Analysis"]
    SECURITY_ANALYZE --> ESLINT_RUN["ESLint Programmatic API"]
    SECURITY_ANALYZE --> SEMGREP_CHECK{"Semgrep<br/>installed?"}
    SECURITY_ANALYZE --> SECRET_RUN["Secret Detector<br/>Regex + Entropy"]
    SECURITY_ANALYZE --> HALLUC_RUN["Hallucination Detector<br/>Import/Call validation"]

    SEMGREP_CHECK -->|Yes| SEMGREP_RUN["Run Semgrep<br/>--config=auto"]
    SEMGREP_CHECK -->|No| SEMGREP_SKIP["Skip (graceful)"]

    ESLINT_RUN --> CLASSIFY
    SEMGREP_RUN --> CLASSIFY
    SEMGREP_SKIP --> CLASSIFY
    SECRET_RUN --> CLASSIFY
    HALLUC_RUN --> CLASSIFY

    CLASSIFY["Classify Severity<br/>Apply rule taxonomy"]
    CLASSIFY --> SUPPRESS_CHECK["Check Suppressions<br/>.athena/suppressions.json"]
    SUPPRESS_CHECK --> COLLECT_FLAGGED["Add to flagged results"]
    COLLECT_PASS --> AGGREGATE
    COLLECT_FLAGGED --> AGGREGATE
    SKIP_UNIT --> AGGREGATE

    AGGREGATE["Aggregate Results"]
    AGGREGATE --> COMPUTE_METRICS["Compute Metrics<br/>AI %, Risk Density,<br/>Confidence Distribution"]
    COMPUTE_METRICS --> TREND_CHECK{"History<br/>available?"}

    TREND_CHECK -->|Yes| COMPUTE_TREND["Compute Trend<br/>Direction + Change %"]
    TREND_CHECK -->|No| GENERATE_REPORT

    COMPUTE_TREND --> GENERATE_REPORT["Generate Report"]
    GENERATE_REPORT --> SAVE_HISTORY["Save to .athena/history/"]
    SAVE_HISTORY --> UPDATE_BASELINE["Update Baseline<br/>(first run only)"]
    UPDATE_BASELINE --> OUTPUT{"Output Format"}

    OUTPUT -->|Terminal| TERM_OUT["ANSI Terminal Output"]
    OUTPUT -->|JSON| JSON_OUT["JSON File"]
    OUTPUT -->|HTML| HTML_OUT["HTML Report"]
    OUTPUT -->|JSONL| JSONL_OUT["JSONL Export"]

    TERM_OUT --> DONE(("End"))
    JSON_OUT --> DONE
    HTML_OUT --> DONE
    JSONL_OUT --> DONE

    style START fill:#3b82f6,color:#fff
    style DONE fill:#3b82f6,color:#fff
    style SCORE fill:#8b5cf6,color:#fff
    style SECURITY_ANALYZE fill:#ef4444,color:#fff
    style CLASSIFY fill:#f97316,color:#fff
    style AGGREGATE fill:#06b6d4,color:#fff
```

### 5.2 Web Scan Activity

```mermaid
flowchart TD
    START(("Start")) --> LOGIN{"User<br/>logged in?"}
    LOGIN -->|No| AUTH["Login / Register"]
    AUTH --> DASHBOARD
    LOGIN -->|Yes| DASHBOARD["View Dashboard"]

    DASHBOARD --> NEW_SCAN["Click 'New Scan'"]
    NEW_SCAN --> ENTER_URL["Enter GitHub Repo URL"]
    ENTER_URL --> VALIDATE_URL{"Valid GitHub<br/>URL?"}

    VALIDATE_URL -->|No| ERROR_URL["Show validation error"]
    ERROR_URL --> ENTER_URL
    VALIDATE_URL -->|Yes| SUBMIT["Submit Scan Request"]

    SUBMIT --> CHECK_RATE{"Rate limit<br/>OK?"}
    CHECK_RATE -->|No| RATE_ERROR["429: Too many scans<br/>Wait and retry"]
    RATE_ERROR --> DASHBOARD

    CHECK_RATE -->|Yes| CHECK_CONCURRENT{"Concurrent<br/>scans < 3?"}
    CHECK_CONCURRENT -->|No| QUEUE["Queue request<br/>Show 'Waiting...'"]
    QUEUE --> CHECK_CONCURRENT

    CHECK_CONCURRENT -->|Yes| CREATE_SANDBOX["Create Sandbox<br/>/tmp/athena-scanId/"]
    CREATE_SANDBOX --> CONNECT_WS["Frontend connects WebSocket"]
    CONNECT_WS --> CLONE["git clone --depth 1"]

    CLONE --> CLONE_OK{"Clone<br/>success?"}
    CLONE_OK -->|No| CLONE_FAIL["Show error<br/>Private repo? Invalid URL?"]
    CLONE_FAIL --> CLEANUP

    CLONE_OK -->|Yes| CHECK_SIZE{"Repo size<br/>< 100MB?"}
    CHECK_SIZE -->|No| SIZE_FAIL["Show error<br/>Repo too large"]
    SIZE_FAIL --> CLEANUP

    CHECK_SIZE -->|Yes| RUN_ENGINE["Run Core Engine<br/>Stream progress via WS"]

    RUN_ENGINE --> TIMEOUT{"Timeout<br/>(120s)?"}
    TIMEOUT -->|Yes| TIMEOUT_FAIL["Show timeout error"]
    TIMEOUT_FAIL --> CLEANUP

    TIMEOUT -->|No| COMPLETE["Scan Complete"]
    COMPLETE --> SAVE_DB["Save results to PostgreSQL"]
    SAVE_DB --> SEND_REPORT["Send report via WebSocket"]
    SEND_REPORT --> RENDER["Render Report View<br/>Scores + Findings + Trends"]

    CLEANUP["Cleanup Sandbox<br/>rm -rf temp dir"]
    CLEANUP --> DONE(("End"))
    RENDER --> CLEANUP

    style START fill:#3b82f6,color:#fff
    style DONE fill:#3b82f6,color:#fff
    style CLONE_FAIL fill:#ef4444,color:#fff
    style SIZE_FAIL fill:#ef4444,color:#fff
    style TIMEOUT_FAIL fill:#ef4444,color:#fff
    style COMPLETE fill:#22c55e,color:#fff
    style RENDER fill:#06b6d4,color:#fff
```

### 5.3 Heuristic Scoring Activity

```mermaid
flowchart TD
    START(("Start")) --> RECEIVE["Receive CodeUnit"]
    RECEIVE --> EXTRACT_META["Extract Metadata<br/>identifiers, comments, nesting"]

    EXTRACT_META --> S1["Signal 1: Generic Names<br/>Match against wordlist<br/>data, result, temp, item, value"]
    S1 --> S2["Signal 2: Comment Ratio<br/>commentLines / totalLines"]
    S2 --> S3["Signal 3: Obvious Comments<br/>Comment before x = y or return x"]
    S3 --> S4["Signal 4: Empty Catch<br/>catch block empty or console.error only"]
    S4 --> S5["Signal 5: Null Checks<br/>Redundant optional chaining / typeof"]
    S5 --> S6["Signal 6: Formatting Uniformity<br/>Indentation stdDev == 0"]
    S6 --> S7["Signal 7: Universal JSDoc<br/>Every function has preceding comment"]
    S7 --> S8["Signal 8: Naming Entropy<br/>Shannon entropy of identifier set"]
    S8 --> S9["Signal 9: Boilerplate Patterns<br/>CRUD template matching"]
    S9 --> S10["Signal 10: Helper Ordering<br/>Helpers defined before use"]
    S10 --> S11["Signal 11: Emoji in Comments<br/>Detect emoji chars in source"]

    S11 --> SUM["Sum weighted scores<br/>Max possible: 110"]
    SUM --> NORMALIZE["Normalize to 0-100 scale<br/>score = raw * 100 / 110"]

    NORMALIZE --> APPLY_BASELINE{"Repo baseline<br/>loaded?"}
    APPLY_BASELINE -->|Yes| ADJUST["Adjust score by<br/>deviation from baseline"]
    APPLY_BASELINE -->|No| CLASSIFY_BAND

    ADJUST --> CLASSIFY_BAND{"Score range?"}
    CLASSIFY_BAND -->|"0–40"| LOW["Band: LOW<br/>Likely human"]
    CLASSIFY_BAND -->|"40–70"| UNCERTAIN["Band: UNCERTAIN<br/>Needs review"]
    CLASSIFY_BAND -->|"70–100"| HIGH["Band: HIGH<br/>Likely AI"]

    LOW --> TOP3["Compute top 3 signals<br/>by contribution %"]
    UNCERTAIN --> TOP3
    HIGH --> TOP3

    TOP3 --> OUTPUT["Output: ScoredUnit<br/>score + band + explanation"]
    OUTPUT --> DONE(("End"))

    style START fill:#3b82f6,color:#fff
    style DONE fill:#3b82f6,color:#fff
    style LOW fill:#22c55e,color:#fff
    style UNCERTAIN fill:#eab308,color:#000
    style HIGH fill:#ef4444,color:#fff
```

### 5.4 Security Analysis Activity

```mermaid
flowchart TD
    START(("Start")) --> RECEIVE["Receive Flagged CodeUnit<br/>score >= threshold"]

    RECEIVE --> WRITE_TEMP["Write code to temp file"]
    WRITE_TEMP --> FORK["Fork into parallel analyzers"]

    FORK --> ESLINT_START["ESLint Analysis"]
    FORK --> SEMGREP_START["Semgrep Analysis"]
    FORK --> SECRET_START["Secret Detection"]
    FORK --> HALLUC_START["Hallucination Detection"]

    subgraph ESLINT_PATH["ESLint Path"]
        ESLINT_START --> ESLINT_LOAD["Load eslint-plugin-security"]
        ESLINT_LOAD --> ESLINT_LINT["Run lintText(code)"]
        ESLINT_LINT --> ESLINT_PARSE["Parse messages<br/>ruleId, severity, line"]
    end

    subgraph SEMGREP_PATH["Semgrep Path"]
        SEMGREP_START --> SEMGREP_CHECK{"semgrep<br/>installed?"}
        SEMGREP_CHECK -->|No| SEMGREP_SKIP["Skip<br/>Log info"]
        SEMGREP_CHECK -->|Yes| SEMGREP_EXEC["exec: semgrep<br/>--json --config=auto"]
        SEMGREP_EXEC --> SEMGREP_PARSE["Parse JSON output"]
    end

    subgraph SECRET_PATH["Secret Detection Path"]
        SECRET_START --> REGEX_SCAN["Regex pattern matching<br/>AWS, GitHub, JWT, passwords"]
        REGEX_SCAN --> ENTROPY_SCAN["Shannon entropy check<br/>threshold: 4.5, minLen: 20"]
        ENTROPY_SCAN --> FALSE_POS["Exclude false positives<br/>URLs, paths, CSS colors"]
    end

    subgraph HALLUC_PATH["Hallucination Path"]
        HALLUC_START --> PARSE_IMPORTS["Parse import/require"]
        PARSE_IMPORTS --> CHECK_MODULES["Check against node_modules"]
        CHECK_MODULES --> CHECK_EXPORTS["Validate named exports"]
        CHECK_EXPORTS --> CHECK_METHODS["Validate method calls<br/>on imported modules"]
    end

    ESLINT_PARSE --> MERGE["Merge All Findings"]
    SEMGREP_PARSE --> MERGE
    SEMGREP_SKIP --> MERGE
    FALSE_POS --> MERGE
    CHECK_METHODS --> MERGE

    MERGE --> TAXONOMY["Apply Rule Taxonomy<br/>injection | credential-exposure<br/>unsafe-dynamic-exec | weak-crypto"]
    TAXONOMY --> SEVERITY["Classify Severity<br/>Finding type × AI score"]
    SEVERITY --> DONE(("End"))

    style START fill:#3b82f6,color:#fff
    style DONE fill:#3b82f6,color:#fff
    style MERGE fill:#f97316,color:#fff
    style SEVERITY fill:#ef4444,color:#fff
```

---

## 6. Diagram Index

| # | Diagram | Type | Section |
|---|---------|------|---------|
| 1 | System Architecture | Architecture | §1 |
| 2 | ER Diagram (User, Scan, Suppression) | ERD | §2 |
| 3 | Use Case Diagram | Use Case | §3 |
| 4 | CLI Scan Sequence | Sequence | §4.1 |
| 5 | Pre-commit Hook Sequence | Sequence | §4.2 |
| 6 | Web Scan Sequence | Sequence | §4.3 |
| 7 | User Authentication Sequence | Sequence | §4.4 |
| 8 | Suppression Flow Sequence | Sequence | §4.5 |
| 9 | Core Engine Pipeline Activity | Activity | §5.1 |
| 10 | Web Scan Activity | Activity | §5.2 |
| 11 | Heuristic Scoring Activity | Activity | §5.3 |
| 12 | Security Analysis Activity | Activity | §5.4 |
