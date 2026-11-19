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

Every file is parsed with [tree-sitter](https://tree-sitter.github.io/) (bundled, no install needed). Files with a syntax error are reported as `parse-failed` in coverage and their readable parts are still analyzed. Athena's own rules, taint analysis and secret scanning cover every language above. The optional external scanners (Semgrep, ESLint, NodeJSScan, Bearer) still cover JavaScript/TypeScript only.

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

## Dependency checks

Athena reads every manifest and lockfile it finds (npm, Yarn, pnpm, pip/poetry/uv/Pipenv, Maven/Gradle, NuGet, Go, Cargo, Composer, vcpkg, Conan) and reports, in a separate **Dependencies** section:

| Finding | Meaning | What to do |
|---|---|---|
| Vulnerable dependency | A known advisory (OSV.dev) affects the exact version. Severity comes from CVSS. If the advisory names the affected functions and your code never imports them, severity drops one level and the report says so. | Upgrade to the fixed version shown. |
| Malicious package | The version is a known malicious release (`MAL-` advisory). | Remove it and rotate any secrets it could read. |
| Package does not exist | A declared dependency, or an import that is declared nowhere, is not on the public registry. Often an AI-invented name that anyone could register. | Fix the name or remove it. |
| Possible typosquat | A direct dependency is one or two edits away from a popular package. | Check you meant the popular one. |
| Deprecated / yanked / abandoned | The registry says so. | Move to a maintained release or alternative. |
| Very new release | Published in the last 72 hours. | Wait out the cooldown or review it. |
| Install script | A direct npm dependency runs `preinstall`/`install`/`postinstall`. | Review it, or install with `--ignore-scripts`. |
| Hallucinated API call | You call a member that the installed package's type declarations do not contain (`axios.fetchData`). Only checked when the package is installed with types. | Use the real API. |

Private packages (`file:`, `git+`, workspace and scoped-registry packages) are never looked up. A registry outage or rate limit is reported as a coverage gap, never as "does not exist". Answers are cached for 24 hours (advisories 6 hours) under `~/.athena/cache/deps`; `--offline` uses only that cache (and reports the cache date or a gap), and `--no-deps` skips the checks. Athena sends package names and versions to OSV.dev and the package registries, never your code. `npm audit` was replaced by these checks; `--no-npm-audit` is accepted for one release and does nothing.

## Review, git gates and AI agents

- **`athena review`** reviews a change instead of the whole repository: `--staged` (default), `--uncommitted`, `--range origin/main..HEAD` or `--base main`. Only findings on changed lines count and block; issues elsewhere in a function you touched are listed separately as existing issues (not counted). Renames are followed, binary files are skipped with a note, and dependency checks run only when a manifest or lockfile changed. Formats: terminal, `json`, `sarif`, and `markdown` (a PR-comment-ready review, one section per file).
- **Git gates.** `athena init` installs a pre-commit hook (`athena check --staged`, about one second on a typical commit); `athena init --hooks pre-commit,pre-push` adds a pre-push hook that reviews `@{u}..HEAD`. Both honour `--fail-on` (or `failOn` in `athena.config.json`) and `core.hooksPath`. Husky, lefthook and the pre-commit framework are detected: Athena prints the snippet to add and changes no file. An existing hook that is not Athena's is never overwritten without `--force`. `ATHENA_SKIP=1 git commit` skips the hooks with a note; a missing Athena or a push-hook timeout never blocks. `athena uninstall` removes only Athena's hooks.
- **MCP server.** `athena mcp` serves Athena's tools over stdio to Claude Code, Cursor, Codex and other MCP clients: scan, check files, review, explain, provenance, dependencies, API existence, codebase map, taint paths, symbol and caller search, skills, and one write tool (`athena_add_learned_rule`, which needs `confirm: true`). Results are compact and paginated, secrets are redacted, paths outside the starting directory are refused, and no AI model is called, so no key is needed. Client setup: `docs/agents/mcp-clients.md`.
- **Claude Code plugin.** `plugins/athena` bundles the MCP server, the `athena-security` skill (map, trace, verify under reachability/defenses/impact), a researcher and a verifier agent, `/athena-scan` and `/athena-review`, and hooks that check each edited file and suggest a review after a commit. The same skill is published in the open Agent Skills format at `skills/athena-security` (`npx skills add arsh342/athena`); add `docs/agents/AGENTS.md` to your repository for other agents.

## Staying current

- **Advisory data.** `athena update` keeps a local, incrementally updated copy of the OSV vulnerability database (which includes the GitHub Advisory Database) for the ecosystems you use, plus CISA's Known Exploited Vulnerabilities list and FIRST's EPSS scores. The first sync of an ecosystem downloads its full export once (npm is about 220 MB); later syncs fetch only changed records, and withdrawn advisories disappear. Checks then run offline and fast; ecosystems without local data fall back to the OSV API.
- **Known exploited.** Findings for vulnerabilities that are being exploited in the wild are labelled, listed first, and block at any severity (`updates.blockKnownExploited`, default on). EPSS shows the probability of exploitation.
- **Automatic, never in your way.** After a scan, if local data is older than 24 hours (`updates.intervalHours`), a background update starts for ecosystems you already synced; the scan never waits for it, and `--offline` disables it. Data older than 7 days is shown as a coverage gap: `advisory data 9 days old — run athena update`.
- **Rule and skill packs.** `athena update` also fetches the newest signed pack from the project's GitHub releases. A pack is accepted only if its Ed25519 signature and SHA-256 verify, it contains data files only, and every rule passes its own fixtures; otherwise the previous pack stays active. `athena update --rollback` returns to the previous pack. Official packs need the maintainer's public key to be provisioned in the build (`PACK_PUBLIC_KEY`); until then every pack is refused.
- **New CVEs become rules.** A daily advisory-watch workflow (`.github/workflows/advisory-watch.yml`, off until `ADVISORY_WATCH_ENABLED` is set) turns new reviewed HIGH/CRITICAL advisories that link a fix commit into proposed rules, proven against the code before and after the fix, and opens a pull request for human review.
- **Alerts.** Each scan stores its dependency inventory. `athena alerts` re-checks the last scan against the current local data and lists vulnerabilities published since (exit 1 if any). `--format cyclonedx` exports the inventory as a CycloneDX 1.6 SBOM. The web dashboard shows "N new vulnerabilities affect <repo> since your last scan" with a re-scan button, from a daily backend job.
- **Privacy.** Syncing downloads public data only; nothing about your code or dependencies is sent. Data sources: OSV.dev (CC-BY 4.0, including the GitHub Advisory Database, CC BY 4.0), CISA KEV, FIRST EPSS.

## Skills

A skill is packaged expertise for a framework, language or bug class, in the open Agent Skills format (a `SKILL.md` with YAML frontmatter) plus declarative data. Athena loads only each skill's name and description, switches a skill on when the project actually uses it (a dependency in a manifest or an import — never free text in a README), and then adds its rules, sources, sinks and file checks to the scan. Findings name the skill that produced them (`skill: "express"`), and the terminal prints `Skills: express, auth-sessions, …`.

**Built in (39, MIT):** methodology (audit context, variant analysis, false-positive check, insecure defaults, sharp edges, differential review, spec vs code, lifecycles and races), frameworks (Express, Next.js, React, NestJS, Flask, Django, FastAPI, Spring, ASP.NET Core, Go web, Rust web, Laravel), ORMs (Prisma, SQLAlchemy, TypeORM, Hibernate, EF Core, GORM), languages (C/C++ memory safety, Rust unsafe/FFI, PHP, shell), and domains (authentication and sessions, file uploads, payment webhooks, GitHub Actions, Dockerfiles, LLM-app security, common AI-generated-code flaws, fail-open defaults).

```
athena skills list [path]            what is active for this project, and what is available
athena skills show <name> [--section "Verification checklist"]
athena skills new <name>             scaffold a skill with rules and fixtures (repo: .athena/skills/)
athena skills test [path]            validate a skill and run its vulnerable/safe fixtures
athena skills add <git-url>[#subdir][@commit] [--yes] [--repo]
athena skills remove <name>
athena variants <finding-id> [--save]  turn one confirmed finding into a rule and find its siblings
```

Skills are **data only**: rules (`rules.json`: a call, line or file pattern plus a fixed vocabulary of conditions such as `argIsConcat` or `fileTextNotMatches`), taint sources/sinks (`taint.json`) and guidance text. They contain no code. Every regular expression is checked before a skill loads (third-party patterns are limited to a few quantifiers and run under a time budget, and are switched off if they are slow); every built-in rule has a vulnerable and a safe fixture, and `athena skills test` runs them for yours. A skill cannot reuse a built-in rule id or take a built-in name (`taint`, `crypto`, `express`, …), cannot replace a built-in skill, and cannot declare sanitizers, so it cannot hide or re-grade built-in findings. Skills from `athena skills add` are pinned to a full commit SHA, show their licence and every file before installing, ask before replacing an installed skill, and are fetched into a temporary folder that is always removed. Precedence is repo (`.athena/skills`) over user (`~/.athena/skills`); built-in skills are always kept. Detection reads dependency names from manifests (package.json, requirements, pyproject, pom, go.mod, Cargo, …) and imports, never prose. Third-party skills such as Trail of Bits' (CC BY-SA 4.0) are not bundled; install them yourself and mind their licence.

**Variant analysis:** `athena variants <id>` generalises a confirmed finding (the sink call and the shape of its unsafe argument) into a rule, previews the other places that match, and with `--save` stores it in `.athena/learned-rules.json`, so every later scan finds those cousins for free. A rule that matches more than 50 places is refused without `--force`.

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
  - dependency intelligence — OSV advisories, registry checks, typosquats (replaces `npm audit`)
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
- `analyzers/` — security scanner adapters (Semgrep, ESLint, Bearer, NodeJSScan, secret detection); `deps/` — dependency intelligence
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
