# Athena — Complete Tech Stack

> **Version:** 1.0  
> **Date:** April 2026  
> **Status:** Finalized  

---

## 1. Core Language + Tooling

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js (v18+) |
| Package Manager | npm (workspaces) |

---

## 2. Core Engine (`core/`)

### Parsing / Analysis

* **TypeScript Compiler API**
  * AST parsing (`ts.createSourceFile`)
  * No Babel, no external parser

### Static Analysis

* **ESLint (programmatic API)**
* **eslint-plugin-security**

### External Security Tool (optional)

* **Semgrep** (CLI subprocess)

### Custom Analysis (Native Implementations)

* Secret detection (regex + Shannon entropy)
* Heuristic scorer (11 weighted signals)
* Stylometric analyzer (repo baseline)
* Diff analyzer (change-focused scanning)
* Hallucination detector (API call validation)
* Suppression manager (human-in-the-loop)
* Benchmark runner (precision/recall/F1)

### Utilities

* **glob** — file matching
* **fs/promises** — native file system
* **child_process** — Semgrep execution

---

## 3. CLI (`cli/`)

| Component | Technology |
|-----------|-----------|
| CLI Framework | **commander** |
| Color Output | **chalk** |
| Spinners | **ora** |
| Git Integration | Native `git` via `child_process.execSync` |
| Build | **tsup** (bundling + DTS) |

---

## 4. Backend (`backend/`)

| Component | Technology |
|-----------|-----------|
| Server | **express** |
| WebSocket | **ws** |
| Security | **helmet**, **cors**, **express-rate-limit** |
| Auth | **jsonwebtoken**, **bcryptjs** |
| ORM | **prisma**, **@prisma/client** |
| Dev Runtime | **tsx** |

---

## 5. Database

* **PostgreSQL**

---

## 6. Frontend (`frontend/`)

| Component | Technology |
|-----------|-----------|
| Framework | **react** |
| Build Tool | **vite** |
| Routing | **react-router-dom** |
| Terminal Emulator | **@xterm/xterm**, **@xterm/addon-fit**, **@xterm/addon-web-links** |
| State / API | Native React hooks + fetch (no Redux) |

---

## 7. Testing

* **vitest** (core, CLI, backend)

---

## 8. Build + Packaging

| Component | Technology |
|-----------|-----------|
| Monorepo | npm workspaces |
| Core + CLI Bundling | **tsup** |
| Frontend Build | **vite build** |

---

## 9. Dev Tooling

* **eslint** + **eslint-plugin-security**
* **prettier**
* **tsconfig (strict)**

---

## 10. Deployment

| Surface | Platform |
|---------|----------|
| CLI Distribution | **npm registry** (`@arsh342/athena`) |
| Backend Hosting | **Railway** or **Render** |
| Frontend Hosting | **Vercel** or **Netlify** |
| Database Hosting | **Railway PostgreSQL** or **Supabase** |

---

## 11. OS / System Dependencies

* **git** — repo cloning, diff analysis
* **node >= 18** — runtime
* **semgrep** — optional binary (graceful degradation if missing)

---

## 12. Data Storage (CLI Side)

JSON files:
* `.athena/history/` — scan history
* `.athena/baseline.json` — repo fingerprint
* `.athena/suppressions.json` — suppressed findings

---

## 13. Communication Protocols

* **HTTP (REST API)** — frontend ↔ backend
* **WebSocket (ws)** — live terminal streaming

---

## 14. Output Formats

* Terminal (ANSI-colored)
* JSON (structured)
* HTML (standalone)
* JSONL (research mode)

---

## 15. Architecture Patterns

* Monorepo (npm workspaces)
* Modular core engine (framework-agnostic)
* Client-server (web)
* Streaming architecture (WebSocket)
* CLI-first tooling with web wrapper

---

## Viva One-Liner

> TypeScript + Node.js, TypeScript Compiler API for AST parsing, ESLint + Semgrep for security analysis, Commander-based CLI, Express + WebSocket backend, React + Vite frontend, PostgreSQL with Prisma, deployed via Vercel and Railway.

---

## Positioning

**Do NOT say:** "We used many libraries"

**Say:** "Core logic is custom; external tools are only used for standard static analysis"

Core detection engine, heuristic scorer, secret detector, hallucination detector, diff analyzer, and benchmark system are all **custom implementations**. ESLint and Semgrep are integrated as standard analysis tools, not as the core intelligence of the system.
