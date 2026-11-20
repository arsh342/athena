# Athena

**Find out what AI wrote in your repository, and whether it is safe to ship.**

Athena scans your code for security problems and estimates how much of it was written by AI tools. It runs on your machine, needs no account or API key, and works as a command-line tool, a git hook, an MCP server for coding agents, and a Claude Code plugin.

Supports JavaScript/TypeScript, Python, Java, C#, C/C++, Go, Rust, PHP and Shell.

## Install

Requires Node.js 18 or newer.

```bash
npm install -g @arsh342/athena
```

Or run it without installing:

```bash
npx @arsh342/athena scan .
```

## Use it

```bash
athena scan .                  # scan the current project
athena review                  # review only your staged changes
athena explain <finding-id>    # why a finding matters and how to fix it
athena provenance .            # how much of each file looks AI-written
athena init                    # block risky commits with a pre-commit hook
```

A scan prints findings with the file and line, the path from user input to the dangerous call, and a confidence level. Findings Athena cannot confirm are listed as "needs review" and never block.

**In CI**, write SARIF or JSON and fail the build on high-severity issues:

```bash
athena scan . --format sarif --output athena.sarif --fail-on high
```

Exit codes: `0` pass, `1` blocked by findings, `3` incomplete scan (with `--strict`). All options are in [cli/README.md](cli/README.md).

## What it checks

- **Code security.** Injection, path traversal, SSRF, XSS, unsafe deserialization, weak crypto, risky cookies and CORS, memory-unsafe C, shell pitfalls, and more. Athena follows user input through variables, helpers and (for JS/TS and Python) across files, and checks each finding for reachability and defenses.
- **Secrets.** 60+ provider key formats, private keys and connection strings, in source and config files. Reports never contain the secret itself.
- **Dependencies.** Known vulnerabilities (OSV), malicious packages, packages that do not exist (often AI-invented names), typosquats, and risky install scripts.
- **AI provenance.** Lines credited to AI tools in git history, plus a style-based estimate, always shown as a range with its method.

Everything above runs offline. Benchmarks and limits: [docs/athena-bench](docs/athena-bench/SAST.md).

## Claude Code plugin

The plugin gives Claude Code Athena's tools and a security-review workflow.

```bash
git clone https://github.com/arsh342/athena.git
claude plugin install ./athena/plugins/athena
```

It adds:

- **`/athena-scan`** to scan the project and triage the findings.
- **`/athena-review`** to review staged or uncommitted changes.
- **The `athena-security` skill**, which maps the code, traces input to dangerous calls, and verifies each candidate for reachability, defenses and impact.
- **A researcher and a verifier agent** for deeper investigation.
- **Hooks** that check each file Claude edits and suggest a review after a commit.

## MCP server

`athena mcp` serves Athena's tools to any MCP client. It never calls an AI model and needs no key.

```bash
claude mcp add athena -- npx -y @arsh342/athena mcp      # Claude Code
```

Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "athena": { "command": "npx", "args": ["-y", "@arsh342/athena", "mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.athena]
command = "npx"
args = ["-y", "@arsh342/athena", "mcp"]
```

Tools include scan, review, explain, dependencies, codebase map, taint paths and symbol search. Paths are confined to the project, results are paginated, and secrets are redacted. Details: [docs/agents/mcp-clients.md](docs/agents/mcp-clients.md).

## Skills

A skill is packaged expertise for a framework, language or bug class. Athena turns one on only when your project uses it (a dependency or an import), then applies its rules and guidance. 39 skills are built in: methodology, frameworks (Express, Next.js, Django, Spring, Laravel, ...), ORMs, languages and deployment files.

```bash
athena skills list             # what is active for this project
athena skills show express     # read a skill
athena skills new my-skill     # scaffold your own, with test fixtures
athena skills test             # validate it against its fixtures
athena skills add <git-url>    # install a third-party skill
```

Skills are data only (rules, taint sources and sinks, guidance text) and contain no code, so installing one cannot run anything. The same security skill is published in the open Agent Skills format for other agents:

```bash
npx skills add arsh342/athena
```

`athena variants <finding-id> --save` turns one confirmed finding into a rule that finds its look-alikes in every later scan.

## Optional AI verification

Off by default. With your own provider key, an AI model double-checks the findings Athena was unsure about.

```bash
athena keys set anthropic            # or openai, google, openrouter, ...
athena scan . --ai verify            # verify uncertain findings
athena scan . --ai deep --budget 1   # deeper review with a three-voter panel
```

- **You set the limit.** Spend is capped at $0.25 per run and $1 per day by default, and Athena stops before a call could exceed it. Deep mode requires an explicit `--budget`.
- **You see what is sent.** The first time in a repository, Athena shows exactly what leaves your machine and asks. Secrets and dependency findings are never sent.
- **Your key stays yours.** It is read from the environment or a private file, and is never printed or logged.
- Works with Anthropic, OpenAI, Google, any OpenAI-compatible service, and local models (Ollama, LM Studio). Google needs a one-time `npm install -g @google/genai`; the others are built in.

## Keeping current

```bash
athena update      # refresh advisory data and signed rule packs
athena alerts      # new vulnerabilities since your last scan
```

Updates download public data only. Nothing about your code is sent.

## Configuration

Add `athena.config.json` to your project to set the failure threshold, exclude paths, list intentionally public routes, and tune AI limits. `athena setup` walks you through it. Reference: [cli/README.md](cli/README.md).

## Web app

This repository also contains a web version that scans public GitHub repositories or uploaded folders with a live terminal. To run it locally you need a [Supabase](https://supabase.com/) project:

```bash
cp backend/.env.example backend/.env   # add SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm run dev                            # API on :8787, site on :5173
```

## Develop

```bash
git clone https://github.com/arsh342/athena.git
cd athena
npm install
npm run build
npm test --workspaces --if-present
```

| Folder | Contents |
|---|---|
| `core/` | Analysis engine |
| `cli/` | The `athena` command (published to npm) |
| `agents/` | Optional AI layer |
| `plugins/athena/` | Claude Code plugin |
| `skills/` | Agent Skills package |
| `backend/`, `frontend/` | Web app |

## License

MIT. Built by [Arshdeep Singh](https://github.com/arsh342).
