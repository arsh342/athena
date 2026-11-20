# Athena: Tech Stack

> Status: current as of release 0.3.0 of the CLI. Replaces the April 2026 version, which described the early prototype (TypeScript Compiler API, Semgrep).

## Language and tooling

| Component | Technology |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Node.js 18+ |
| Package manager | npm workspaces: `core`, `agents`, `cli`, `backend`, `frontend` |
| Tests | `node --test` with `tsx` in every workspace |
| Bundling | `tsup` (CLI, one CommonJS file), `tsc` (core, agents, backend), Vite (frontend) |

## Core engine (`core/`)

| Concern | Technology |
|---|---|
| Parsing | [tree-sitter](https://tree-sitter.github.io/) through bundled WASM grammars (`@vscode/tree-sitter-wasm`), nine language families, one parser pool |
| Rules and taint | Athena's own engine: rule packs, intra- and cross-file taint, sanitizer and defense checks |
| Secrets | Own detectors (60+ provider formats) with entropy scoring for generic credentials |
| Dependencies | Manifest and lockfile readers for npm/Yarn/pnpm, pip/poetry/uv/Pipenv, Maven/Gradle, NuGet, Go, Cargo, Composer, vcpkg, Conan; OSV advisories, registry lookups, typosquat lists |
| Advisory data | Local incrementally synced OSV copy, CISA KEV, FIRST EPSS; signed (Ed25519) rule and skill packs |
| AI provenance | Recorded lines from git history plus `athena-detect-fast` (a small pure-TypeScript classifier, under 2 MB) with a labelled style heuristic as fallback |
| Skills | Agent Skills format (`SKILL.md` + declarative `rules.json` / `taint.json`), 39 built in, activated by detected dependencies |
| Optional lint | ESLint 10 with `eslint-plugin-security` 4 (JavaScript/TypeScript only; needs Node 20.19+, skipped on older Node) |
| Output | Terminal, JSON, JSONL, SARIF, Markdown, CycloneDX 1.6 |

Semgrep, NodeJSScan, Bearer and `npm audit` were retired; nothing external is required.

## AI layer (`agents/`)

| Concern | Technology |
|---|---|
| Providers | Anthropic (`@anthropic-ai/sdk`) and OpenAI (`openai`), both bundled into the CLI; Google (`@google/genai`), an optional peer loaded on first use; and any OpenAI-compatible endpoint (OpenRouter, DeepSeek, Mistral, Groq, xAI, Together, Ollama, LM Studio) |
| Structured output | `zod` schemas; verdicts are accepted only from structured output |
| Cost control | Worst-case reservation per call, per-run and per-day caps, a daily ledger in `~/.athena/usage.json` |
| Cheaper paths | Prompt caching of the stable prefix, a per-candidate result cache, the Anthropic Message Batches API for non-interactive deep runs |
| Tools for agents | Eight read-only, path-confined tools (read file, list, grep, symbol and caller search, taint paths, offline findings, dependency findings) |

## CLI (`cli/`)

`commander` for commands, `@modelcontextprotocol/sdk` for `athena mcp`, tree-sitter WASM and the detector model bundled into `dist/`. Output follows the Claude Code look: `⏺` bullets, `⎿` detail lines, an orange spinner.

## Backend (`backend/`)

| Concern | Technology |
|---|---|
| API | Express 4, JSON and multipart (multer) |
| Live terminal | WebSocket (`ws`) with a command allowlist |
| Database | PostgreSQL through Supabase (`pg`); tables: `users`, `auth_sessions`, `scans`, `scan_findings`, `scan_reports`, `scan_inventories`, `scan_alerts`, `scan_terminal_lines`, `job_locks` |
| Auth | Supabase Auth (GitHub and Google OAuth) plus Bearer sessions |
| Scans | `simple-git` shallow clone or ZIP/folder upload into a temporary workspace, then `@athena/core` |
| Reports | Markdown and PDF (pdfkit) |
| Bring-your-own-key AI | `X-AI-*` request headers validated per request; key held in memory for one scan, never stored or logged |

## Frontend (`frontend/`)

React 19, Vite, React Router, xterm.js for the live terminal, Tailwind 4 plus a hand-written editorial theme (warm paper, Geist and Geist Mono, an ASCII canvas hero), DOMPurify and marked for report rendering.

## Agent integrations

MCP server (stdio), a Claude Code plugin (`plugins/athena`: skill, two agents, two commands, hooks), and the open Agent Skills package (`skills/athena-security`).

## Build versus buy

Everything analytical is custom: the scorer, rules, taint engine, secret detector, investigation engine, dependency intelligence and the AI layer's budgeting. Third-party components are the parser (tree-sitter), data sources (OSV, CISA KEV, EPSS, package registries), the AI provider SDKs, and the web stack above.
