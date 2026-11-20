# Athena CLI

Find out what AI wrote in your repository, and whether it is safe to ship. Athena scans JavaScript/TypeScript, Python, Java, C#, C/C++, Go, Rust, PHP and Shell for security problems and estimates how much of the code was written by AI. It runs offline, needs no account, and works as a CLI, a git hook, an MCP server and a Claude Code plugin.

## Install

Requires Node.js 18 or newer. The optional ESLint scanner needs Node 20.19 or newer; on older Node it is skipped and Athena's own engine does the work.

```bash
npm i -g @arsh342/athena@latest
# or run without installing
npx @arsh342/athena scan .
```

Run the same command again to update. `athena --version` shows what you have.

## Quick start

```bash
athena scan .                  # scan the current project
athena review                  # review only your staged changes
athena explain <finding-id>    # why it matters and how to fix it (id from the report, 4+ characters)
athena provenance .            # per-file AI provenance (athena provenance --about explains the method)
athena init                    # install the pre-commit hook (athena uninstall removes it)
athena doctor                  # check Node, npm, git and ESLint
```

Running `athena` with no arguments opens an interactive menu. On a tall terminal (52 rows or more) it opens with the Athena owl, drawn in braille dots; on a shorter one it shows the compact name instead.

## Commands

| Command | What it does |
|---|---|
| `scan [path]` | Scan a project. |
| `check [files]` | Scan staged files (what the pre-commit hook runs). |
| `review` | Review a change: `--staged` (default), `--uncommitted`, `--range a..b`, `--base main`. Only findings on changed lines block. |
| `explain <id>` | Explain a finding from the last scan. |
| `provenance [path]` | How much code looks AI-written, per file. |
| `provenance mark <file[:line]> <human\|ai\|mixed>` | Tell Athena who wrote a function (stored by code hash). Athena learns from marks. |
| `models reset [--repo]` | Forget what Athena learned from labels and marks (this repository with `--repo`, otherwise all). |
| `variants <id> [--save]` | Turn a confirmed finding into a rule and find its look-alikes. |
| `skills list\|show\|new\|test\|add\|remove` | Work with skills (see below). |
| `keys set\|status\|remove <provider>` | Manage API keys for the optional AI layer. The provider is `anthropic`, `openai`, `google`, `openai-compatible`, or a hosted service such as `groq`, `openrouter`, `deepseek`, `mistral`, `xai` or `together`. |
| `mcp` | Serve Athena's tools to MCP clients over stdio. |
| `update` | Refresh advisory data and signed rule packs (`--rollback` restores the previous pack). |
| `alerts` | New vulnerabilities since your last scan (exit 1 if any). |
| `init` / `uninstall` | Install or remove git hooks (`init --hooks pre-commit,pre-push`). |
| `setup`, `doctor`, `menu` | Configuration, health check, interactive menu. |

## Options (scan, check and review)

| Flag | Meaning |
|---|---|
| `-f, --format <terminal\|json\|jsonl\|sarif\|markdown\|cyclonedx>` | Output format. `json` and `sarif` print only that document on stdout; `cyclonedx` prints the dependency inventory as a CycloneDX 1.6 SBOM; `markdown` is PR-comment ready. |
| `-o, --output <file>` | Write the report to a file instead of stdout. |
| `--fail-on <critical\|high\|medium\|low\|none>` | Block on findings at or above this level (default `high`). |
| `--strict` | Exit 3 when the scan was incomplete (files or checks skipped). |
| `-q, --quiet` / `-v, --verbose` | No progress / also print scanner notes. |
| `--no-color` | Disable colour (also off for `NO_COLOR` and non-TTY output). |
| `-m, --max-findings <n\|all>`, `--show-low` | Control how many findings are listed. |
| `--no-eslint` | Skip the optional ESLint scanner. |
| `--no-deps` | Skip dependency checks. |
| `--no-learning` | Do not train on or apply this repository's trusted labels (also `"learning": false` in the project config). |
| `--offline` | Dependency checks use only cached data (a cold cache is reported as a gap). |

Deprecated and ignored: `--no-semgrep`, `--no-nodejsscan`, `--no-bearer`, `--no-npm-audit` (those tools were retired), and `-t, --threshold`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Pass |
| 1 | Blocked by findings at or above `--fail-on` |
| 2 | Usage or internal error |
| 3 | Incomplete scan, only with `--strict` |

Blocked wins over incomplete.

## Optional AI layer

Off unless you pass `--ai`. It only checks what the offline analyzers were unsure about, with your own key and a hard spend cap.

| Flag | Meaning |
|---|---|
| `--ai [verify\|hunt\|deep]` | `verify` (default) settles uncertain findings. `hunt` also explores the riskiest components. `deep` adds a threat model, a three-voter panel and learned rules, and needs `--budget`. |
| `--provider <name>` | `anthropic` (default), `openai`, `google`, `openai-compatible`. |
| `--model <id>` | Model to use. Anthropic default is `claude-sonnet-5-5`; other providers need `--model`. |
| `--quality <economy\|high>` | Anthropic only: Haiku 5.5 or Opus 5.5 instead of Sonnet 5.5. |
| `--budget <usd>`, `--budget-tokens <n>` | Spend cap for this run (default $0.25 per run, $1.00 per day). Deep mode requires one. |
| `--preset <name>`, `--base-url <url>` | For openai-compatible: `openrouter`, `deepseek`, `mistral`, `groq`, `xai`, `together`, `ollama`, `lmstudio`, or an https endpoint. |
| `--suggest-fixes` | With `deep`: write reviewed patch suggestions to `.athena/patches/`. They are never applied. |
| `-y, --yes` | Agree to send code excerpts without asking (needed for non-interactive runs). |

```bash
athena keys set anthropic
athena scan . --ai verify
athena scan . --ai deep --budget 1 --suggest-fixes

# a free hosted model, for example Groq's gpt-oss
athena keys set groq
athena scan . --ai --provider openai-compatible --preset groq --model openai/gpt-oss-120b

# AI-check only the lines a change touched; a real flaw the change did not introduce is listed as an existing issue
athena review --ai
```

Keys come from the environment, then `~/.athena/credentials.json` (mode 0600), and are never printed or logged. Athena reserves the worst-case cost before every call and stops when the next call could exceed a cap; the report lists what was not checked. The first time in a repository it shows exactly what is sent and asks. Secrets and dependency findings are never sent, and repository text is treated as data, never as instructions. Local models (Ollama, LM Studio) cost nothing and send nothing off your machine. On the repository's 14-snippet verification benchmark, Groq's `openai/gpt-oss-120b` and `openai/gpt-oss-20b` both scored 100% precision and recall and resisted the planted prompt injections ([results](https://github.com/arsh342/athena/blob/main/docs/athena-bench/AI-VERIFY.md)); that is a small sample, not a guarantee.

The Anthropic and OpenAI SDKs are built in. Google's is large, so it is not installed by default: for `--provider google`, run `npm install -g @google/genai` once.

## Local learning

Athena can tune its AI-code estimate to a repository, locally, from trusted labels only: lines git credits to AI-assisted commits (AI), code whose every line was last changed before 2021-06-01 (human), and your own `athena provenance mark` entries. It activates at 30 labels with at least 10 of each class, shifts an estimate by at most 0.25, and is adopted only if it lowers log-loss on a held-out 20% of the labels and does not reduce AI recall or raise the human false-positive rate by more than one point on a bundled check set. State is in `~/.athena/learning/` (mode 0600) and holds hashes and style numbers, never code. A mark applies only while the code is unchanged. The report line reads `learning: tuned with N labels from this repo (changed X of Y units)` or `learning: global model`.

The trained detector is enabled only for JavaScript and TypeScript so far; every other language uses the style heuristic, which rarely scores near the decision boundary, so tuning there seldom changes a result. The report shows how many units tuning changed.

## What Athena checks

- **Code security:** rule packs for injection, path traversal, SSRF, XSS, unsafe deserialization, open redirect, weak crypto, disabled TLS verification, JWT misuse, risky cookies/CORS, ReDoS, mass assignment, memory-unsafe C, `unsafe` Rust/Go and shell pitfalls. Taint analysis follows user input through variables, helpers and (JS/TS and Python) across files, and shows the path.
- **Investigation:** entry points and their auth guards, sibling comparison (the one route missing the check its neighbours have), intent versus code, lifecycles, error paths and races. Every finding is checked for reachability, defenses and impact; `low` confidence findings are listed as **needs review** and never block.
- **Secrets:** 60+ provider formats, connection strings and private keys in source and config files. Findings never contain the secret.
- **Dependencies:** known vulnerabilities (OSV, with CVSS, EPSS and CISA KEV), malicious packages, non-existent packages, typosquats, deprecated or very new releases, install scripts, and hallucinated API calls. Private packages are never looked up, and a registry outage is a coverage gap, not "does not exist".
- **AI provenance:** lines credited to AI tools in git history (a floor) plus a style-based estimate, shown as a range with its method. The trained detector (`athena-detect-fast`) is enabled for a language only when it meets its release targets on a held-out benchmark (human false-positive rate <= 5%, F1 >= 0.85, and the same false-positive limit on 2022-era human code); today that is JavaScript and TypeScript, and every other language uses a labelled style heuristic. Results: [docs/athena-bench/RESULTS.md](https://github.com/arsh342/athena/blob/main/docs/athena-bench/RESULTS.md).

Syntax-error files are reported as `parse-failed` in coverage and their readable parts are still analyzed.

## Supported languages

JavaScript/TypeScript (`.js .mjs .cjs .ts .mts .cts .jsx .tsx`), Python (`.py .pyi`), Java (`.java`), C# (`.cs`), C/C++ (`.c .h .cc .cpp .cxx .hpp .hh .hxx`), Go (`.go`), Rust (`.rs`), PHP (`.php .phtml`) and Shell (`.sh .bash .zsh`, shebang scripts). Everything is parsed with bundled [tree-sitter](https://tree-sitter.github.io/) grammars; nothing extra to install. The ESLint scanner is optional and covers JavaScript/TypeScript only.

## Skills

A skill is packaged expertise for a framework, language or bug class in the open Agent Skills format (a `SKILL.md` plus declarative `rules.json` and `taint.json`). Athena turns one on only when your project uses it (a dependency or an import), then applies its rules and guidance. 39 are built in: methodology, frameworks, ORMs, languages and deployment files.

```bash
athena skills list             # what is active for this project
athena skills show express
athena skills new my-skill     # scaffold with fixtures (repo: .athena/skills/)
athena skills test
athena skills add <git-url>[#subdir][@commit]
```

Skills are data only and contain no code. Regular expressions are checked before a skill loads and run under a time budget. `athena variants <id> --save` stores a learned rule in `.athena/learned-rules.json`, which every later scan applies.

## Git gates, MCP and the Claude Code plugin

- **Hooks.** `athena init` installs a pre-commit hook (`athena check --staged`, about a second on a typical commit); `--hooks pre-commit,pre-push` adds a pre-push review of `@{u}..HEAD`. Husky, lefthook and the pre-commit framework are detected and a snippet is printed instead of changing files. `ATHENA_SKIP=1 git commit` skips the hooks.
- **MCP server.** `claude mcp add athena -- npx -y @arsh342/athena mcp`. Other clients: [MCP client setup](https://github.com/arsh342/athena/blob/main/docs/agents/mcp-clients.md). No AI model is called and no key is needed.
- **Claude Code plugin.** `claude plugin marketplace add arsh342/athena` then `claude plugin install athena@athena` (or, from a clone, `claude plugin install ./plugins/athena`) for `/athena-scan`, `/athena-review`, the `athena-security` skill, a researcher and a verifier agent, and hooks. Other agents: `npx skills add arsh342/athena`.

## Staying current

`athena update` keeps a local, incrementally updated copy of the OSV database for the ecosystems you use, plus CISA KEV and EPSS, and fetches the newest signed rule and skill pack (accepted only if its Ed25519 signature and SHA-256 verify and every rule passes its own fixtures). After a scan, data older than 24 hours is refreshed in the background; `--offline` disables that. Only public data is downloaded; nothing about your code is sent. `athena alerts` re-checks your last scan against current data.

## Project config

Optional `athena.config.json` at the scanned root. Flags override it.

```json
{ "failOn": "high", "exclude": ["generated/"], "strict": false, "publicRoutes": ["/health"] }
```

## Develop

```bash
npm run build -w @arsh342/athena
npm test -w @arsh342/athena
```

MIT licence. More: [project README](https://github.com/arsh342/athena#readme).
