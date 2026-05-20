# Athena

**AI Code Provenance Tracker** — detect AI-generated code and run targeted security analysis on JavaScript and TypeScript repositories.

Athena identifies likely AI-generated sections in your codebase using an 11-signal heuristic scorer and runs multi-engine security analysis on flagged code. It operates as both a **CLI tool** (pre-commit scanning) and a **web platform** (GitHub repo scanner with live terminal streaming).

---

## Why Athena?

AI-generated code is increasingly committed to production without adequate review. This code frequently contains:

- Hardcoded secrets and leaked credentials
- Hallucinated API calls that don't exist
- Injection vectors and insecure defaults
- Deprecated patterns that pass syntax checks but fail semantically

Athena specifically targets these risks by identifying AI-generated code sections and applying elevated security scrutiny before they enter version control.

---

## Features

### Core Analysis Engine
- **11-signal heuristic scorer** — detects AI-generated code using naming entropy, comment patterns, boilerplate detection, perplexity analysis, burstiness scoring, and more
- **AST parsing** via the TypeScript Compiler API — no Babel dependency
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
```

---

## Project Structure

### `core/` — Analysis Engine

The shared scanning library used by both the CLI and backend.

- `engine.ts` — orchestrates the full scan pipeline
- `scorer/heuristic-scorer.ts` — 11-signal AI detection scorer
- `parser/ast-parser.ts` — TypeScript AST code unit extraction
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
