# Athena

**AI Code Provenance Tracker** — detect AI-generated code and run targeted security analysis on repositories in JavaScript/TypeScript, Python, Java, C#, C/C++, Go, Rust, PHP and Shell.

Athena identifies likely AI-generated sections in your codebase using git history and a style heuristic (labelled low confidence) and runs multi-engine security analysis on flagged code. It operates as both a **CLI tool** (pre-commit scanning) and a **web platform** (GitHub repo scanner with live terminal streaming).

---

## Why Athena?

AI-generated code is increasingly committed to production without adequate review. This code frequently contains:

- Hardcoded secrets and leaked credentials
- Hallucinated API calls that don't exist
- Injection vectors and insecure defaults
- Deprecated patterns that pass syntax checks but fail semantically

Athena specifically targets these risks by identifying AI-generated code sections and applying elevated security scrutiny before they enter version control.

---

## Supported languages

| Language | Extensions | Today |
|---|---|---|
| JavaScript / TypeScript (JSX, TSX) | `.js .mjs .cjs .ts .mts .cts .jsx .tsx` | own rules + taint, secrets, units, AI provenance , hallucinated APIs, external scanners |
| Python | `.py .pyi`, `#!…python` scripts | own rules + taint, secrets, units, AI provenance  |
| Java | `.java` | own rules + taint, secrets, units, AI provenance  |
| C# | `.cs` | own rules + taint, secrets, units, AI provenance  |
| C / C++ | `.c .h` / `.cc .cpp .cxx .hpp .hh .hxx` | own rules + taint, secrets, units, AI provenance  (C is parsed with the C++ grammar) |
| Go | `.go` | own rules + taint, secrets, units, AI provenance  |
| Rust | `.rs` | own rules + taint, secrets, units, AI provenance  |
| PHP | `.php .phtml` | own rules + taint, secrets, units, AI provenance  |
| Shell | `.sh .bash .zsh`, `#!…sh/bash/zsh` scripts | own rules + taint, secrets, units, AI provenance  |

Every file is parsed with [tree-sitter](https://tree-sitter.github.io/) (bundled, no install needed). Files with a syntax error are reported as `parse-failed` in coverage and their readable parts are still analyzed. Athena's own rules, taint analysis and secret scanning cover every language above. The optional external scanners (Semgrep, ESLint, npm audit, NodeJSScan, Bearer) still cover JavaScript/TypeScript only.

## How the AI-code estimate is made

- **Recorded** (a floor): lines git history credits to AI tools (co-author trailers, agent bot authors).
- **Estimated**: Athena's own detector, `athena-detect-fast` — style statistics plus hashed token and character n-grams into a calibrated classifier (under 2 MB, pure TypeScript, runs on any machine). It is enabled **per language, only where it meets the release targets** on Athena-Bench (human false-positive rate <= 5%, F1 >= 0.85). Every other language uses the labelled style heuristic.
- **Current status (v0.1.0):** trained only on real commits from GitHub (permissively licensed human code from before 2021; AI code from commits that agents marked). No language meets the targets yet — see [`docs/athena-bench/RESULTS.md`](docs/athena-bench/RESULTS.md) for the numbers — so all estimates still use the heuristic and say so. A language is enabled only when it passes the gate on at least 5 distinct test repositories per class; the human side of the current data is from an earlier era than the AI side (an era confound documented in RESULTS.md), so more of the *same* data would not be enough — era-matched human code is needed first. `athena provenance --about` prints the per-language status.
- **Reproduce:** `npm run build -w @athena/core && cd ml && uv sync && uv run python -m athena_ml.collect_all all 20 && uv run python -m athena_ml.run_train 0.1.0` (needs a GitHub token via `GITHUB_TOKEN` or `gh auth login`; about an hour of network time; results vary with GitHub search). `ml/data/` is not committed; `ml/bench/manifest.jsonl.gz` lists the benchmark units by repository and commit, without any third-party code.

## What Athena checks (its own analysis engine)

No external scanner is needed for these; they run offline on every supported language.

- **Rule packs** for each language family: injection, path traversal, SSRF, XSS, unsafe deserialization, open redirect, weak crypto, disabled TLS verification, JWT misuse, risky cookies/CORS, debug mode, stack-trace leaks, ReDoS, mass assignment, memory-unsafe C functions, `unsafe` Rust/Go, shell pitfalls (`curl | sh`, unquoted `rm -rf $VAR`).
- **Taint analysis**: follows user input (request parameters, command-line arguments, `$_GET`, ...) through variables, helper functions and — for JS/TS and Python — across files, to dangerous calls. A finding shows the path, e.g. `path: app.py:3 → app.py:3 → app.py:4`. Sanitizers, parameterised queries, argument vectors and path-prefix checks stop a flow.
- **Secrets**: 60+ provider formats (AWS, GitHub, Stripe, OpenAI, Anthropic, ...), connection strings, private keys and generic random-looking credentials, in source files and in config files (`.env`, YAML, JSON, TOML, Dockerfiles). Findings never contain the secret itself; placeholders and `.env.example` files are ignored. Detected keys are not verified with their provider (nothing is sent anywhere).
- **Investigation engine** — the way a reviewer works, offline:
  - *Entry points*: finds routes (Express, Fastify, NestJS, Next.js, Flask, FastAPI, Django, Spring, ASP.NET, gin/net/http, actix/axum, Laravel), CLI commands, queue consumers, uploads and websockets, with their authentication guards.
  - *Siblings*: if 5 of 6 routes in a router require authentication, or 5 of 6 queries on a table filter by `user_id`, the odd one out is reported with two conforming examples cited (needs at least 4 siblings and 75% agreement; test files are ignored; list intentional public routes in `athena.config.json` as `"publicRoutes": ["/health"]`).
  - *Intent vs code*: validators that can never fail, comments that promise sanitizing/validation the next lines do not do, security TODOs, tests without assertions.
  - *Lifecycles, error paths and races*: resources never released, cleanup attached only after an `await`, success status written but not the failure status, errors turned into success-looking values, read-then-write races, floating promises, unreachable states.
- **Confidence**: every finding is checked for reachability from an entry point, defenses on the path and impact (exposure, sensitive data). `high`/`medium` findings count toward the gate; `low` ones are listed as **needs review** and never block. Findings are ordered by severity × exposure × confidence.

Benchmarks against known-vulnerable apps: [`docs/athena-bench/SAST.md`](docs/athena-bench/SAST.md) (recall against a hand-verified, partial answer key; precision is not yet measured).

---

## Features

### Core Analysis Engine
- **AI provenance by lines** — *recorded* (git co-author trailers and agent authors, a floor) plus a *heuristic estimate* from style signals, always reported as a range with its method
- **One parser for nine language families** via tree-sitter (bundled WASM grammars) — see [Supported languages](#supported-languages)
- **Multi-engine security scanning:**
  - Secret detection (regex + Shannon entropy)
  - Hallucination detection (invalid API call validation)
  - [Semgrep](https://semgrep.dev/) — SAST rule-based scanning
  - [ESLint](https://eslint.org/) + `eslint-plugin-security`
  - `npm audit` — dependency vulnerability scanning
  - [NodeJSScan](https://github.com/ajinabraham/nodejsscan) — Node.js security scanner (Docker)
  - [Bearer](https://www.bearer.com/) — data flow security analysis

### Web Platform
- **Live terminal** — real-time scan output streamed via WebSocket
- **GitHub repo scanning** — paste a public repo URL and scan instantly
- **Local upload scanning** — upload a folder or ZIP archive for analysis
- **Interactive reports** — findings grouped by severity with code snippets, redacted secrets, and AI confidence scores
- **PDF & Markdown export** — download scan reports
- **Dashboard** — scan history with risk metrics and trend visualization
- **OAuth authentication** — Supabase Auth with GitHub/Google providers

### CLI
- **Pre-commit integration** — scan staged files before committing
- **Delta scanning** — only scan changed files for speed
- **Terminal UI** — colored output with progress indicators
- **npm package** — `npx @arsh342/athena scan .`

---

## Architecture

```
athena/
├── core/          # Shared analysis engine (scanners, scorer, parsers)
├── cli/           # Terminal CLI — pre-commit hook & local scanning
├── backend/       # Express API + WebSocket terminal server
├── frontend/      # React SPA — brutalist-style web interface
└── docs/          # System design, tech stack, and planning docs
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 18+ |
| Frontend | React 19, Vite, xterm.js |
| Backend | Express, WebSocket (ws) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (OAuth) |
| Package Manager | npm workspaces |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A [Supabase](https://supabase.com/) project (for the web platform)

Optional (for extended scanning):
- [Semgrep](https://semgrep.dev/docs/getting-started/) — `pip install semgrep`
- [Docker](https://www.docker.com/) — for NodeJSScan
- [Bearer](https://docs.bearer.com/reference/installation/) — `brew install bearer/tap/bearer`

### Installation

```bash
# Clone the repository
git clone https://github.com/arsh342/athena.git
cd athena

# Install all workspace dependencies
npm install

# Build all packages (core → cli → backend → frontend)
npm run build
```

### Environment Setup

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

Fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Running Locally

```bash
# Start both backend and frontend dev servers
npm run dev

# Or start them individually:
npm run dev:backend    # Express API on http://localhost:8787
npm run dev:frontend   # Vite dev server on http://localhost:5173
```

### CLI Usage

```bash
# Scan a local directory
npx @arsh342/athena scan .

# Or install globally
npm install -g @arsh342/athena
athena scan /path/to/repo

# CI-friendly: JSON or SARIF on stdout, exit codes 0 pass / 1 blocked / 3 incomplete (--strict)
athena scan . --format sarif --output athena.sarif --fail-on high --strict

athena explain <finding-id>    # why it matters and how to fix
athena provenance .            # how much code was written by AI, per file
```

See [cli/README.md](cli/README.md) for all options.

---

## Project Structure

### `core/` — Analysis Engine

The shared scanning library used by both the CLI and backend.

- `engine.ts` — orchestrates the full scan pipeline
- `scorer/heuristic-scorer.ts` — heuristic style scorer (fallback estimate)
- `provenance/` — recorded AI provenance from git and line-based aggregation
- `lang/` — language detection, tree-sitter parser loading and per-language code unit extraction
- `parser/ast-parser.ts` — reads a file, rejects binary content and hands it to `lang/`
- `analyzers/` — security scanner adapters (Semgrep, ESLint, npm audit, Bearer, NodeJSScan, secret detection, hallucination detection)
- `scanner-registry.ts` — plugin registry for external scanners
- `report/` — report generation (terminal, JSON)

### `backend/` — API Server

Express server with WebSocket terminal streaming.

- `server.ts` — HTTP API routes (scans, reports, auth, uploads)
- `scanner.ts` — scan orchestration (git clone, file collection, analysis)
- `pty-handler.ts` — WebSocket terminal connection handler
- `terminal-router.ts` — safe command routing (help, scan, scans, findings)
- `data.ts` — Supabase data access layer
- `auth.ts` / `auth-supabase.ts` — OAuth authentication

### `frontend/` — Web Interface

React SPA with a brutalist design aesthetic.

- `pages/` — Landing, Dashboard, ScanPage, ReportPage, Login, Register
- `components/` — WebTerminal, ReportView, CodeBlock, SeverityBadge, Navbar
- `auth/` — auth store and OAuth flow
- `services/api.ts` — backend API client
- `styles/` — CSS with brutalist design tokens

### `cli/` — Command Line Tool

Published as `@arsh342/athena` on npm.

- `commands/scan.ts` — main scan command
- `commands/doctor.ts` — environment health check
- `commands/setup.ts` — interactive configuration
- `utils/` — terminal UI, colors, progress, git helpers

---

## License

MIT — see [cli/LICENSE](cli/LICENSE) for details.

---

**Built by [Arshdeep Singh](https://github.com/arsh342)**
