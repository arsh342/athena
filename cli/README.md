# Athena CLI

AI code provenance tracker and security scanner for JavaScript/TypeScript, Python, Java, C#, C/C++, Go, Rust, PHP and Shell.

Athena scans JS/TS/JSX/TSX files, extracts function-level code units, scores AI-origin likelihood with local heuristics, and runs targeted security checks.

## Install

```bash
npm install -g @arsh342/athena
```

## Quick Start

Open interactive selector:

```bash
athena
# or
athena menu
```

Scan current directory:

```bash
athena scan .
```

Check staged files (what the pre-commit hook runs):

```bash
athena check
```

Explain one finding from the last scan, and see how much code was AI-written:

```bash
athena explain 3f9a2c          # id shown in the report (at least 4 characters)
athena provenance .            # per-file AI provenance
athena provenance --about      # how it is measured
```

Install or remove the pre-commit hook:

```bash
athena init
athena uninstall
```

Setup scanner dependencies:

```bash
athena setup all
athena setup semgrep --auto
```

## Options (scan and check)

| Flag | Meaning |
|---|---|
| `-f, --format <terminal\|json\|jsonl\|sarif>` | Output format. `json` and `sarif` print only that document on stdout. |
| `-o, --output <file>` | Write the report to a file instead of stdout. |
| `--fail-on <critical\|high\|medium\|low\|none>` | Block on findings at or above this level (default `high`). |
| `--strict` | Exit 3 when the scan was incomplete (files or checks skipped). |
| `-q, --quiet` / `-v, --verbose` | No progress / also print scanner notes. |
| `--no-color` | Disable colour (also off for `NO_COLOR` and non-TTY output). |
| `-m, --max-findings <n\|all>`, `--show-low` | Control how many findings are listed. |
| `--no-eslint`, `--no-nodejsscan`, `--no-bearer`, `--no-semgrep` | Skip a scanner. |
| `--no-deps` | Skip dependency checks. |
| `--format markdown` | PR-comment-ready output (used by `athena review`). |
| `--format cyclonedx` | Print the dependency inventory as a CycloneDX 1.6 SBOM. |
| `--offline` | Dependency checks use only cached data (a cold cache is reported as a gap). |
| `--no-npm-audit` | Deprecated, does nothing (replaced by dependency checks). |
| `-t, --threshold <n>` | Deprecated: only affects the heuristic AI fallback. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Pass |
| 1 | Blocked by findings at or above `--fail-on` |
| 2 | Usage or internal error |
| 3 | Incomplete scan, only with `--strict` |

Blocked wins over incomplete.

## Project config

Optional `athena.config.json` at the scanned root. Flags override it.

```json
{ "failOn": "high", "exclude": ["generated/"], "strict": false }
```

## Supported languages

| Language | Extensions | Today |
|---|---|---|
| JavaScript / TypeScript (JSX, TSX) | `.js .mjs .cjs .ts .mts .cts .jsx .tsx` | own rules + taint (cross-file), secrets, hallucinated APIs, units, AI provenance, external scanners |
| Python | `.py .pyi`, `#!…python` scripts | own rules + taint, secrets, units, AI provenance |
| Java | `.java` | own rules + taint, secrets, units, AI provenance |
| C# | `.cs` | own rules + taint, secrets, units, AI provenance |
| C / C++ | `.c .h` / `.cc .cpp .cxx .hpp .hh .hxx` | own rules + taint, memory-safety checks, secrets, units, AI provenance (C is parsed with the C++ grammar) |
| Go | `.go` | own rules + taint, secrets, units, AI provenance |
| Rust | `.rs` | own rules + taint, secrets, units, AI provenance |
| PHP | `.php .phtml` | own rules + taint, secrets, units, AI provenance |
| Shell | `.sh .bash .zsh`, `#!…sh/bash/zsh` scripts | own rules + taint, secrets, units, AI provenance |

Every file is parsed with [tree-sitter](https://tree-sitter.github.io/) (bundled, no install needed). Files with a syntax error are reported as `parse-failed` in coverage and their readable parts are still analyzed. Athena's own rules, taint analysis and secret scanning cover every language above. The optional external scanners (Semgrep, ESLint, NodeJSScan, Bearer) still cover JavaScript/TypeScript only.

The report header shows files per language, e.g. `12 files (js 3 · py 2 · go 1)`.

## What Athena checks

Athena's own offline engine covers all supported languages: rule packs, taint analysis with source-to-sink paths, 60+ secret formats (also in `.env`, YAML and JSON files), and an investigation engine that finds routes missing the authentication or owner filter their siblings use, validators that never fail, error paths that report success, read-then-write races and more. Each finding carries a confidence; `low` ones appear under **needs review** and never block. Mark routes that are public on purpose in `athena.config.json`: `{ "publicRoutes": ["/health"] }`. See the main README for details.

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
- **Rule and skill packs.** `athena update` also fetches the newest signed pack from the project's GitHub releases. A pack is accepted only if its Ed25519 signature and SHA-256 verify, it contains data files only, and every rule passes its own fixtures; otherwise the previous pack stays active. `athena update --rollback` returns to the previous pack. The public key that official packs are verified against ships in the CLI (`PACK_PUBLIC_KEY`); packs are built and signed by the maintainer with `scripts/build-pack.ts`.
- **New CVEs become rules.** A daily advisory-watch workflow (`.github/workflows/advisory-watch.yml`, off until `ADVISORY_WATCH_ENABLED` is set) turns new reviewed HIGH/CRITICAL advisories that link a fix commit into proposed rules, proven against the code before and after the fix, and opens a pull request for human review.
- **Alerts.** Each scan stores its dependency inventory. `athena alerts` re-checks the last scan against the current local data and lists vulnerabilities published since (exit 1 if any). `--format cyclonedx` exports the inventory as a CycloneDX 1.6 SBOM. The web dashboard shows "N new vulnerabilities affect <repo> since your last scan" with a re-scan button, from a daily backend job.
- **Privacy.** Syncing downloads public data only; nothing about your code or dependencies is sent. Data sources: OSV.dev (CC-BY 4.0, including the GitHub Advisory Database, CC BY 4.0), CISA KEV, FIRST EPSS.

## Skills and variants

Skills add framework- and domain-specific rules and guidance (39 built in). `athena skills list` shows which ones apply to a project; `athena skills new/test/add/remove` write, prove and install them (data only, pinned to a commit, licence shown). `athena variants <finding-id> [--save]` turns one confirmed finding into a rule and finds its siblings. See the main README for the skill format.

## How AI-written code is estimated

`recorded` comes from git history (a floor). `estimated` uses Athena's own detector where it meets the published release targets for that language, and a labelled style heuristic elsewhere. Run `athena provenance --about` to see which languages use which, with benchmark numbers.

## What the report tells you

- **Gate**: `BLOCKED`, `PASS`, or `PASS (incomplete)`. A scan never reads as a plain pass when files could not be parsed, were too large, or a scanner was unavailable.
- **Findings**: grouped by severity with a code frame. Secrets are redacted. LOW findings are collapsed unless `--show-low`.
- **AI provenance** (by lines): *recorded* is what git history credits to AI tools (co-author trailers, agent bot authors). It is a floor, and unavailable outside git or in shallow clones. *estimated* is a style heuristic with no measured accuracy yet, labelled low confidence. Uncertain is shown separately.
- **Coverage**: which files and checks ran, and what was skipped.

Results go to stdout; progress and warnings go to stderr, so `athena scan --format json | jq .` works.

## Development

Run from source:

```bash
npm run dev -w @arsh342/athena -- menu
```

Quiet npm wrapper output:

```bash
npm run -s dev -w @arsh342/athena -- menu
```

Build:

```bash
npm run build -w @arsh342/athena
```

## Notes

- Runs fully local (no external AI service required).
- Supports JavaScript/TypeScript (JSX, TSX), Python, Java, C#, C/C++, Go, Rust, PHP and Shell (see Supported languages).
- Requires Node.js 18 or newer.
- ESLint scanner support is included via optional package dependencies.
- Semgrep, Docker (for nodejsscan), and Bearer CLI remain external optional tools.
