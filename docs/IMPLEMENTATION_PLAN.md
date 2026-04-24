# Athena — Implementation Plan

> **Version:** 1.0  
> **Date:** April 2026  
> **Status:** Approved  

---

## 1. Project Structure

```
athena/
├── core/                          # Shared analysis engine (standalone pkg)
│   ├── src/
│   │   ├── parser/
│   │   │   └── ast-parser.ts
│   │   ├── scorer/
│   │   │   ├── heuristic-scorer.ts
│   │   │   ├── signals/
│   │   │   │   ├── generic-names.ts
│   │   │   │   ├── comment-ratio.ts
│   │   │   │   ├── obvious-comments.ts
│   │   │   │   ├── empty-catch.ts
│   │   │   │   ├── null-checks.ts
│   │   │   │   ├── formatting-uniformity.ts
│   │   │   │   ├── universal-jsdoc.ts
│   │   │   │   ├── naming-entropy.ts
│   │   │   │   ├── boilerplate-patterns.ts
│   │   │   │   ├── helper-ordering.ts
│   │   │   │   └── emoji-comments.ts
│   │   │   └── stylometric-analyzer.ts
│   │   ├── analyzers/
│   │   │   ├── security-analyzer.ts
│   │   │   ├── semgrep-runner.ts
│   │   │   ├── eslint-runner.ts
│   │   │   ├── secret-detector.ts
│   │   │   └── hallucination-detector.ts   # NEW
│   │   ├── report/
│   │   │   ├── severity-classifier.ts
│   │   │   ├── report-generator.ts
│   │   │   ├── terminal-formatter.ts
│   │   │   ├── json-formatter.ts
│   │   │   ├── jsonl-formatter.ts          # NEW
│   │   │   └── html-formatter.ts
│   │   ├── diff/
│   │   │   └── diff-analyzer.ts            # NEW: diff-aware analysis
│   │   ├── baseline/
│   │   │   └── repo-fingerprint.ts         # NEW: repo baseline
│   │   ├── benchmark/
│   │   │   └── benchmark-runner.ts         # NEW: precision/recall/F1
│   │   ├── suppression/
│   │   │   └── suppression-manager.ts      # NEW
│   │   ├── engine.ts              # Main orchestrator
│   │   ├── config.ts              # Config loader
│   │   └── types.ts               # All shared types
│   ├── tests/
│   │   ├── ast-parser.test.ts
│   │   ├── heuristic-scorer.test.ts
│   │   ├── secret-detector.test.ts
│   │   ├── security-analyzer.test.ts
│   │   ├── engine.test.ts
│   │   └── fixtures/
│   │       ├── ai-generated/      # Known AI-generated samples
│   │       ├── human-written/     # Known human-written samples
│   │       └── secrets/           # Files with planted secrets
│   ├── package.json               # name: "@athena/core"
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   └── vitest.config.ts
│
├── cli/                           # CLI tool (npm package)
│   ├── src/
│   │   ├── commands/
│   │   │   ├── check.ts
│   │   │   ├── scan.ts
│   │   │   ├── init.ts
│   │   │   ├── uninstall.ts
│   │   │   ├── report.ts
│   │   │   ├── suppress.ts                # NEW
│   │   │   ├── benchmark.ts               # NEW
│   │   │   └── config.ts
│   │   ├── utils/
│   │   │   ├── git.ts             # Git operations (staged files)
│   │   │   ├── file-filter.ts     # Glob/extension filtering
│   │   │   └── logger.ts          # Structured logging
│   │   └── index.ts               # CLI entry point (Commander.js)
│   ├── tests/
│   │   ├── check.test.ts
│   │   └── init.test.ts
│   ├── package.json               # name: "@arsh342/athena", depends on @athena/core
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   └── vitest.config.ts
│
├── backend/                       # Web backend
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── scan.routes.ts
│   │   │   └── report.routes.ts
│   │   ├── services/
│   │   │   ├── scan.service.ts
│   │   │   ├── sandbox.service.ts
│   │   │   ├── auth.service.ts
│   │   │   └── websocket.service.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   └── error-handler.ts
│   │   └── prisma/
│   │       └── schema.prisma
│   ├── package.json               # depends on @athena/core
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── frontend/                      # Web frontend
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Landing.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── ScanPage.tsx
│   │   │   ├── ReportPage.tsx
│   │   │   ├── Login.tsx
│   │   │   └── Register.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx
│   │   │   ├── ReportView.tsx
│   │   │   ├── SeverityBadge.tsx
│   │   │   ├── ScoreGauge.tsx
│   │   │   ├── CodeBlock.tsx
│   │   │   ├── Navbar.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   └── useAuth.ts
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── styles/
│   │   │   └── index.css
│   │   └── types/
│   │       └── index.ts
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── docs/
│   ├── SYSTEM_DESIGN.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── athena_annexure1.docx
│   └── athena_synopsis_v2.docx
│
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── README.md
└── package.json                   # Root (npm workspaces: core, cli, backend, frontend)
```

---

## 2. Implementation Phases

### Phase 1: Project Scaffolding (Day 1)

| # | Task | Output |
|---|------|--------|
| 1.1 | Create root `package.json` w/ npm workspaces (`core`, `cli`, `backend`, `frontend`) | Monorepo config |
| 1.2 | Create `tsconfig.base.json` | Shared TS strict config |
| 1.3 | Init `core/package.json` + `tsconfig.json` | Core package (`@athena/core`) |
| 1.4 | Init `cli/package.json` + `tsconfig.json` | CLI package (`@arsh342/athena`) |
| 1.5 | Init `backend/package.json` + `tsconfig.json` | Backend package |
| 1.6 | Init `frontend/` w/ Vite React TS template | Frontend package |
| 1.7 | Add `.gitignore`, `.eslintrc.json`, `.prettierrc` | Dev config |
| 1.8 | Configure tsup for core + CLI build | Build pipeline |
| 1.9 | Configure Vitest for core + CLI + backend | Test runner |

**Dependencies to install:**

Core:
```
typescript, eslint, eslint-plugin-security, tsup, vitest
```

CLI:
```
typescript, commander, chalk, ora, glob, tsup, vitest
```

Backend:
```
typescript, express, ws, prisma, @prisma/client, bcryptjs, jsonwebtoken, cors, helmet, express-rate-limit, tsx, vitest
```

Frontend:
```
(via create-vite) react, react-dom, react-router-dom, @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links
```

---

### Phase 2: Core Engine — Types + Parser (Day 1–2)

| # | Task | Details |
|---|------|---------|
| 2.1 | Define all types in `core/src/types.ts` | `CodeUnit`, `ScoredUnit`, `Finding`, `Severity`, etc. |
| 2.2 | Write parser tests (TDD) in `core/tests/` | Test against fixture files |
| 2.3 | Implement `core/src/parser/ast-parser.ts` | TS Compiler API, extract fns/classes/methods |
| 2.4 | Verify parser tests pass | All green |

**Parser test cases:**
- Parse file w/ 3 functions → returns 3 CodeUnits
- Extract correct line numbers, names, kinds
- Handle arrow functions, class methods, exported fns
- Handle JSX/TSX files
- Skip files w/ syntax errors (log warning, return empty)
- Minimum unit size filter (skip < 3 LOC)

---

### Phase 3: Core Engine — Heuristic Scorer (Day 2–3)

| # | Task | Details |
|---|------|---------|
| 3.1 | Write scorer tests (TDD) | Test each signal individually |
| 3.2 | Implement 11 signal detectors | One file per signal in `core/src/scorer/signals/` |
| 3.3 | Implement `heuristic-scorer.ts` | Aggregates signals, normalizes to 0–100, produces score |
| 3.4 | Implement `stylometric-analyzer.ts` | Repo baseline comparison |
| 3.5 | Verify scorer tests pass | All green |

**Signal implementation order (dependencies):**
1. `generic-names.ts` — simplest, regex list match
2. `comment-ratio.ts` — line counting
3. `obvious-comments.ts` — pattern matching on adjacent lines
4. `empty-catch.ts` — AST node check
5. `naming-entropy.ts` — Shannon entropy calculation
6. `null-checks.ts` — AST pattern matching
7. `formatting-uniformity.ts` — indentation analysis
8. `universal-jsdoc.ts` — comment adjacency check
9. `boilerplate-patterns.ts` — template matching
10. `helper-ordering.ts` — call graph analysis
11. `emoji-comments.ts` — detect emoji (✅🔥📝⚡🚀💡🎉✨💪🏆) in comments/strings, strong AI signal

**Test fixtures needed:**
```
tests/fixtures/ai-generated/
  ├── crud-api.ts          # Classic AI CRUD boilerplate
  ├── react-component.tsx  # Over-commented React component
  ├── utility-functions.ts # Generic naming, excessive helpers
  └── error-handling.ts    # Empty catches, unnecessary null checks

tests/fixtures/human-written/
  ├── domain-logic.ts      # Domain-specific naming, sparse comments
  ├── custom-hook.tsx      # Idiomatic React patterns
  ├── algorithm.ts         # Complex logic, minimal comments
  └── config-parser.ts     # Inconsistent formatting, domain names
```

---

### Phase 4: Core Engine — Security Analyzers (Day 3–4)

| # | Task | Details |
|---|------|---------|
| 4.1 | Write secret detector tests | Planted secrets, false positives |
| 4.2 | Implement `secret-detector.ts` | Regex patterns + Shannon entropy |
| 4.3 | Write ESLint runner tests | Mock ESLint output |
| 4.4 | Implement `eslint-runner.ts` | Programmatic ESLint w/ security plugin |
| 4.5 | Implement `semgrep-runner.ts` | Subprocess, graceful degradation |
| 4.6 | Implement `security-analyzer.ts` | Orchestrates all three |
| 4.7 | Verify all security tests pass | All green |

**Secret detector test cases:**
- Detect AWS access key: `AKIA1234567890ABCDEF`
- Detect GitHub token: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- Detect JWT: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.xxx`
- Detect password in string: `const password = "superSecret123!"`
- Detect high-entropy string (random 40-char hex)
- **No false positive** on: URLs, file paths, error messages, CSS hex colors

---

### Phase 5: Core Engine — Report + Engine + Advanced Features (Day 4–6)

| # | Task | Details |
|---|------|---------|
| 5.1 | Implement `severity-classifier.ts` | Cross-ref matrix + rule taxonomy |
| 5.2 | Implement `report-generator.ts` | Struct output builder w/ repo-level AI score |
| 5.3 | Implement `terminal-formatter.ts` | Chalk + box drawing + confidence bands |
| 5.4 | Implement `json-formatter.ts` | Structured JSON w/ explainability |
| 5.5 | Implement `jsonl-formatter.ts` | One JSON per line, research-ready |
| 5.6 | Implement `html-formatter.ts` | Standalone HTML report |
| 5.7 | Implement `diff-analyzer.ts` | Parse git diff → map changed ranges to CodeUnits |
| 5.8 | Implement `repo-fingerprint.ts` | Build baseline from all units, store `.athena/baseline.json` |
| 5.9 | Implement `hallucination-detector.ts` | AST import/call analysis vs known API surfaces |
| 5.10 | Implement `suppression-manager.ts` | Read/write `.athena/suppressions.json` |
| 5.11 | Implement `benchmark-runner.ts` | Precision/recall/F1 on labeled fixtures |
| 5.12 | Implement `engine.ts` | Main pipeline orchestrator w/ perf profiling |
| 5.13 | Add confidence bands + explainability | Score → band mapping, top-3 signal contribution |
| 5.14 | Add risk density metrics | Findings/1k LOC, flagged ratio, critical/file |
| 5.15 | Add temporal trend analysis | Read history, compute direction |
| 5.16 | Write engine integration test | Full pipeline on fixture files |
| 5.17 | Verify integration tests pass | All green |

---

### Phase 6: CLI Commands (Day 6–7)

| # | Task | Details |
|---|------|---------|
| 6.1 | Implement `index.ts` | Commander.js program setup |
| 6.2 | Implement `check.ts` | Scan staged/specified files (diff-aware by default) |
| 6.3 | Implement `scan.ts` | Full directory scan |
| 6.4 | Implement `init.ts` | Pre-commit hook installer |
| 6.5 | Implement `uninstall.ts` | Hook remover |
| 6.6 | Implement `report.ts` | History reader + report gen + `--trend` flag |
| 6.7 | Implement `suppress.ts` | Suppress finding by ID |
| 6.8 | Implement `benchmark.ts` | Run benchmark against fixtures |
| 6.9 | Implement `config.ts` | Config viewer/editor (incl. weights) |
| 6.10 | Implement `git.ts` utility | Staged files, git root, diff parsing |
| 6.11 | Implement `file-filter.ts` | Extension + glob filtering |
| 6.12 | Implement `logger.ts` | Structured logging |
| 6.13 | Add `--profile` flag | Perf timing per phase |
| 6.14 | Add `--format jsonl` | JSONL output support |
| 6.15 | Configure tsup build | Single binary output |
| 6.16 | Test CLI end-to-end | Run against test repo |

**CLI build config (tsup):**
```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
```

---

### Phase 7: Web Backend (Day 7–9)

| # | Task | Details |
|---|------|---------|
| 7.1 | Setup Express + middleware | CORS, helmet, rate limit, error handler |
| 7.2 | Setup Prisma schema + migrations | User + Scan models |
| 7.3 | Implement auth service + routes | Register, login, JWT |
| 7.4 | Implement sandbox service | Temp dir, limits, cleanup |
| 7.5 | Implement scan service | Clone → analyze → stream |
| 7.6 | Implement WebSocket service | WS connection, message protocol |
| 7.7 | Implement scan routes | POST/GET endpoints |
| 7.8 | Integration test: full scan flow | Clone test repo → analyze → verify DB |

**Backend imports core engine via workspace link:**
```json
// backend/package.json
{
  "dependencies": {
    "@athena/core": "file:../core"
  }
}
```

```json
// cli/package.json  
{
  "dependencies": {
    "@athena/core": "file:../core"
  }
}
```

Both CLI and backend import `@athena/core`. Core has zero knowledge of consumers. No code duplication.

---

### Phase 8: Web Frontend (Day 9–12)

| # | Task | Details |
|---|------|---------|
| 8.1 | Setup Vite + React Router | Route config for all pages |
| 8.2 | Design system + global CSS | Dark theme, colors, typography |
| 8.3 | Implement auth (Login/Register) | Forms + JWT storage |
| 8.4 | Implement Landing page | Hero, features, CTA |
| 8.5 | Implement Terminal component | xterm.js + WebSocket (read-only, sandboxed) |
| 8.6 | Implement ScanPage | URL input → live terminal |
| 8.7 | Implement ReportView component | Severity cards, code blocks, AI scores, confidence bands |
| 8.8 | Implement ScoreGauge | Repo-level AI percentage visualization |
| 8.9 | Implement ReportPage | Full report display w/ explainability |
| 8.10 | Implement Dashboard | Scan history, stats, **trend chart** (line chart) |
| 8.11 | Implement Risk Density cards | findings/1k LOC, flagged ratio |
| 8.12 | Implement Navbar + ProtectedRoute | Navigation + auth guard |
| 8.13 | Polish: animations, responsiveness | Micro-interactions, mobile |

**Design tokens:**
```css
:root {
  /* Background */
  --bg-primary: #0a0e1a;
  --bg-secondary: #111827;
  --bg-card: #1a1f2e;
  --bg-elevated: #242937;
  
  /* Text */
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  
  /* Accent */
  --accent-blue: #3b82f6;
  --accent-cyan: #06b6d4;
  --accent-purple: #8b5cf6;
  
  /* Severity */
  --severity-critical: #ef4444;
  --severity-high: #f97316;
  --severity-medium: #eab308;
  --severity-low: #3b82f6;
  
  /* Typography */
  --font-ui: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

---

### Phase 9: Testing + Benchmarks + Polish (Day 12–14)

| # | Task | Details |
|---|------|---------|
| 9.1 | Run full test suite | All packages |
| 9.2 | Test CLI on real repos | 3+ open-source repos |
| 9.3 | Test pre-commit hook | Init → commit AI code → verify block |
| 9.4 | Test web flow end-to-end | Paste URL → scan → view report |
| 9.5 | Run `athena benchmark` | Verify precision/recall/F1 on labeled corpus |
| 9.6 | Test diff-aware mode | Commit changed file → verify only changed units scanned |
| 9.7 | Test suppression | Suppress finding → verify skip on rescan |
| 9.8 | Test hallucination detection | File w/ `axios.fetchData()` → verify flagged |
| 9.9 | Performance benchmarking | Verify < 10s for 50 files, verify `--profile` output |
| 9.10 | Test trend analysis | Multiple scans → verify `--trend` output |
| 9.11 | README w/ install + usage | Badges, examples, architecture, CI snippet |
| 9.12 | Record demo | CLI + web terminal recording |

---

### Phase 10: Publishing (Day 14)

| # | Task | Details |
|---|------|---------|
| 10.1 | Create benchmark corpus | `/benchmarks/ai/` + `/benchmarks/human/` |
| 10.2 | npm publish CLI | `@arsh342/athena` on npmjs.com |
| 10.3 | Verify install | `npm install -g @arsh342/athena` on clean machine |
| 10.4 | Deploy web backend | Railway / Render |
| 10.5 | Deploy web frontend | Vercel / Netlify |
| 10.6 | Final smoke test | Full flow on deployed env |

---

## 3. Dependency Decisions

| Choice | Selected | Alternative 1 | Alternative 2 | Reason |
|--------|----------|---------------|---------------|--------|
| CLI framework | **Commander.js** | yargs | citty | Mature, 0 deps, best TS support, most stars |
| Build tool | **tsup** | tsc | esbuild direct | esbuild speed + DTS generation, single config |
| Test framework | **Vitest** | Jest | node:test | Fast, Vite-native, Jest-compatible API |
| Web framework | **Vite + React** | Next.js | Astro | SPA sufficient, no SSR needed, lighter |
| Backend | **Express** | Fastify | Hono | Most ecosystem support, WS integration proven |
| ORM | **Prisma** | Drizzle | TypeORM | Best DX, typed queries, migration system |
| WebSocket | **ws** | Socket.io | µWebSockets | Lightweight, no protocol overhead, standard WS |
| Terminal emulator | **xterm.js** | react-terminal | custom | Industry standard (VS Code uses it), full ANSI |
| Secret detection | **Native impl** | detect-secrets | trufflehog | Zero external dep, full control, simpler install |

---

## 4. Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI detection accuracy low | Medium | High | Frame as "flags for review", not "detects AI". Lead w/ pipeline engineering. |
| Semgrep binary not installed | Low | Medium | Graceful degradation. ESLint + secrets still run. Clear docs. |
| Large repos timeout web scan | Medium | Medium | 100MB limit, 120s timeout, depth-1 clone, file count cap |
| npm name conflicts | Low | Low | Scoped package `@arsh342/athena` = guaranteed |
| PostgreSQL setup complexity | Medium | Low | Provide Docker compose. SQLite fallback documented. |
| xterm.js ANSI rendering issues | Low | Medium | Test w/ chalk output early. Use `--color=always` flag. |

---

## 5. Team Workload Distribution

| Member | Responsibility | Phases |
|--------|---------------|--------|
| **Member 1** | AST parser + heuristic scorer + 11 signals + confidence bands | Phase 2, 3 |
| **Member 2** | Security analyzers + secret detector + hallucination detector | Phase 4 |
| **Member 3** | CLI commands + diff-aware + suppress + benchmark + config | Phase 6 |
| **Member 4** | Web backend + frontend + trend charts + deployment | Phase 7, 8 |
| **All** | Scaffolding, engine integration, report gen, testing, docs | Phase 1, 5, 9, 10 |

---

## 6. Verification Checklist

### Core Engine
- [ ] AST parser extracts correct CodeUnits from 10+ test files
- [ ] Scorer flags ≥7/10 AI-generated test files above threshold
- [ ] Scorer does NOT flag ≥7/10 human-written test files
- [ ] Confidence bands classify correctly (LOW/UNCERTAIN/HIGH)
- [ ] Explainability: top-3 signals w/ percentage contribution
- [ ] Secret detector catches all 7 planted secret types
- [ ] Secret detector has zero false positives on non-secret strings
- [ ] ESLint runner detects `eval`, object injection, unsafe regex
- [ ] Hallucination detector flags `axios.fetchData()` style calls
- [ ] Diff-aware mode only scans changed CodeUnits
- [ ] Repo fingerprint computes and stores baseline
- [ ] Suppression skips suppressed findings on rescan
- [ ] Risk density metrics computed correctly
- [ ] Temporal trend analysis computes direction from history
- [ ] Benchmark outputs precision/recall/F1
- [ ] Performance profiling reports ms per phase
- [ ] Full pipeline produces valid ScanReport JSON w/ all new fields

### CLI
- [ ] `athena check` scans staged files (diff-aware), exits 1 on CRITICAL/HIGH
- [ ] `athena scan ./src` scans directory recursively w/ repo AI percentage
- [ ] `athena init` installs working pre-commit hook
- [ ] `athena uninstall` removes hook cleanly
- [ ] `athena report` generates HTML report
- [ ] `athena report --trend` shows trend analysis
- [ ] `athena suppress <id>` adds to suppressions.json
- [ ] `athena benchmark` outputs precision/recall/F1
- [ ] `athena scan --profile` shows timing per phase
- [ ] `athena scan --format jsonl` outputs JSONL
- [ ] Config file respected (threshold, excludes, blockOn, **weights**)
- [ ] Colored terminal output renders correctly

### Web Platform
- [ ] User can register + login
- [ ] Paste GitHub URL → live terminal shows progress
- [ ] Terminal is **read-only** — no user input accepted (sandboxed)
- [ ] Scan completes → report displayed w/ severity cards
- [ ] Repo-level AI percentage displayed (ScoreGauge)
- [ ] Confidence band distribution visualized
- [ ] Risk density metrics displayed
- [ ] Dashboard shows scan history w/ **trend chart**
- [ ] Past reports viewable
- [ ] Rate limiting works (rejects > 10 scans/hour)
- [ ] Concurrent scan limit works (queues at 3)
- [ ] Sandbox cleanup verified — no temp dirs left after scan

### Integration
- [ ] CLI installs globally via `npm install -g`
- [ ] Pre-commit hook blocks commit w/ CRITICAL finding
- [ ] Web platform clones real GitHub repo and produces report
- [ ] Performance: 50-file repo < 10s (CLI), < 30s (web)
- [ ] Emoji signal fires on AI-generated test fixtures w/ emoji comments
- [ ] CI snippet in README works in GitHub Actions
