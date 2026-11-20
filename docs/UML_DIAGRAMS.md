# Athena: UML Diagrams

> Current as of CLI release 0.3.0. The earlier set (Semgrep paths, TypeScript Compiler API parser) was removed. Prose is in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

## 1. Package dependencies

```mermaid
flowchart LR
  cli --> core
  cli --> agents
  agents --> core
  backend --> core
  backend --> agents
  frontend -. "HTTP + WebSocket" .-> backend
  plugin["plugins/athena"] -. "runs" .-> cli
  skillpkg["skills/athena-security"]
```

`core` depends on nothing in the repository. `agents` is optional for every client: the CLI loads it only when `--ai` is used.

## 2. Use cases

```mermaid
flowchart LR
  Dev(("Developer"))
  Agent(("Coding agent"))
  CI(("CI system"))
  Dev --- U1["Scan a project"]
  Dev --- U2["Review staged changes"]
  Dev --- U3["Explain a finding"]
  Dev --- U4["Estimate AI provenance"]
  Dev --- U5["Write or install a skill"]
  Dev --- U6["Verify findings with own AI key"]
  Dev --- U7["Scan a repo or upload in the web app"]
  Agent --- U8["Call Athena tools over MCP"]
  Agent --- U9["Use the plugin workflow"]
  CI --- U10["Gate a build with SARIF and exit codes"]
  U6 -. includes .-> U11["Set a spend cap"]
  U6 -. includes .-> U12["Accept what is sent"]
```

## 3. Core types

```mermaid
classDiagram
  class ScanReport {
    files: FileReport[]
    summary: ScanSummary
    inventory
    review?
  }
  class FileReport { path; units: ScoredUnit[]; findings: ClassifiedFinding[] }
  class ClassifiedFinding {
    id; ruleId; severity; source
    confidence: high|medium|low
    evidence[]; trace[]; priority
    aiVerdict?
  }
  class ScoredUnit { unit: CodeUnit; score; provenance; recorded }
  class ScanSummary {
    findings by severity; blocked; needsReview
    aiProvenance; coverage; delta?; ai?
  }
  class AiVerdict { verdict; reachability; defenses; impact; citations; votes? }
  ScanReport "1" o-- "*" FileReport
  FileReport "1" o-- "*" ScoredUnit
  FileReport "1" o-- "*" ClassifiedFinding
  ScanReport "1" *-- "1" ScanSummary
  ClassifiedFinding "0..1" o-- "1" AiVerdict
```

## 4. AI layer types

```mermaid
classDiagram
  class ModelProvider {
    <<interface>>
    chat(request) ChatResponse
    countTokens(request)
    capabilities()
    chatBatch(requests)?
  }
  class AnthropicProvider
  class OpenAIProvider
  class GoogleProvider
  class SpendGuard {
    <<interface>>
    beforeCall(request)
    afterCall(usage, model, request)
    release(request)?
  }
  class BudgetTracker { caps; reserved; spent; summary() }
  class VerifyInput { candidates; guard; cache; voter?; useBatch? }
  ModelProvider <|.. AnthropicProvider
  ModelProvider <|.. OpenAIProvider
  ModelProvider <|.. GoogleProvider
  SpendGuard <|.. BudgetTracker
  VerifyInput --> ModelProvider
  VerifyInput --> SpendGuard
```

OpenAI-compatible services reuse `OpenAIProvider` with a different base URL.

## 5. Sequence: scan from the CLI

```mermaid
sequenceDiagram
  actor Dev
  participant CLI as athena scan
  participant Core as core engine
  participant Net as OSV / registries
  Dev->>CLI: athena scan .
  CLI->>Core: scanFiles(files, config)
  Core->>Core: parse, provenance, rules, taint, secrets
  Core->>Net: dependency lookups (cached, optional)
  Net-->>Core: advisories, existence
  Core->>Core: investigate, verify, score
  Core-->>CLI: ScanReport
  CLI->>CLI: save last scan, start background update if stale
  CLI-->>Dev: report, exit code 0 / 1 / 3
```

## 6. Sequence: AI verification

```mermaid
sequenceDiagram
  actor Dev
  participant CLI
  participant AI as runAiVerify
  participant Cache
  participant Budget as BudgetTracker
  participant LLM as Provider
  Dev->>CLI: athena scan . --ai verify
  CLI->>AI: report, options
  AI->>Dev: show what is sent (first time in this repo)
  Dev-->>AI: agree
  AI->>AI: select candidates, build context packs
  AI->>Cache: lookup per candidate
  loop each batch of 5 not cached
    AI->>Budget: reserve worst case
    alt over the cap
      Budget-->>AI: refuse
      AI->>AI: mark rest "not checked (budget)"
    else within the cap
      AI->>LLM: stable prefix + batch
      LLM-->>AI: structured verdicts
      AI->>Budget: settle with real usage
      AI->>Cache: store
    end
  end
  AI->>AI: apply verdicts, recompute gate
  AI-->>CLI: report with summary.ai
```

## 7. Sequence: deep mode

```mermaid
sequenceDiagram
  participant AI as deep orchestrator
  participant U as User
  participant LLM as Provider
  AI->>AI: require explicit --budget
  AI->>U: estimate and cap, ask to confirm (--yes if non-interactive)
  U-->>AI: confirm
  AI->>LLM: threat model
  loop weakness categories
    AI->>LLM: researcher (read-only tools) on top components
  end
  par three voters
    AI->>LLM: reachability-first
    AI->>LLM: defenses-first
    AI->>LLM: impact-first
  end
  AI->>AI: tally 2 of 3 in code
  AI->>AI: learn rules from confirmed findings
  opt --suggest-fixes
    AI->>LLM: write patch
    AI->>LLM: independent review of the patch
    AI->>AI: write .athena/patches (never applied)
  end
```

Non-interactive Anthropic runs send the voters through the Message Batches API.

## 8. Activity: review and pre-commit gate

```mermaid
flowchart TD
  A["git commit"] --> B{"ATHENA_SKIP set?"}
  B -->|yes| Z["allow, print note"]
  B -->|no| C["athena check --staged"]
  C --> D["scan staged files"]
  D --> E["keep findings on changed lines"]
  E --> F{"blocking findings at or above fail-on?"}
  F -->|yes| X["exit 1, commit blocked"]
  F -->|no| Y["exit 0, commit proceeds"]
```

`athena review` runs the same steps for `--uncommitted`, `--range` or `--base` and can print Markdown for a pull request.

## 9. Sequence: web scan with a bring-your-own key

```mermaid
sequenceDiagram
  actor U as User
  participant FE as Browser (sessionStorage)
  participant API as Backend
  participant SC as Scanner
  participant P as Provider
  U->>FE: Settings: key, model, spend cap
  FE->>API: POST /api/ai/consent (no key)
  API-->>FE: consent text
  U->>FE: accept
  U->>FE: start scan
  FE->>API: POST /api/scans with X-AI-* headers
  API->>API: validate headers, cap, host allowlist, one scan per user
  API->>SC: runScan(url, user, emit, ai)
  SC->>P: verification calls (key in memory only)
  P-->>SC: verdicts
  SC-->>API: result (key scrubbed from any error)
  API-->>FE: summary, findings
```

## 10. Deployment

```mermaid
flowchart LR
  subgraph Laptop_or_CI["Developer machine or CI"]
    A["athena CLI (npm package)"] --> L[("~/.athena")]
  end
  subgraph Hosted["Hosted web app"]
    F["Static frontend"] --> B["Express API + WebSocket"]
    B --> DB[("Supabase PostgreSQL")]
    B --> T["Temp workspaces (deleted after each scan)"]
  end
  A -. "optional AI call, user's key" .-> P["AI provider"]
  B -. "optional AI call, user's key" .-> P
  A -. "athena update (public data)" .-> G["OSV, CISA KEV, EPSS, GitHub releases"]
```
