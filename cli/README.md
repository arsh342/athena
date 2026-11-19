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
| `--no-eslint`, `--no-npm-audit`, `--no-nodejsscan`, `--no-bearer`, `--no-semgrep` | Skip a scanner. |
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
| JavaScript / TypeScript (JSX, TSX) | `.js .mjs .cjs .ts .mts .cts .jsx .tsx` | units, AI provenance, secrets (inside functions and classes), hallucinated APIs, external scanners |
| Python | `.py .pyi`, `#!…python` scripts | units, AI provenance, secrets (inside functions and classes) |
| Java | `.java` | units, AI provenance, secrets (inside functions and classes) |
| C# | `.cs` | units, AI provenance, secrets (inside functions and classes) |
| C / C++ | `.c .h` / `.cc .cpp .cxx .hpp .hh .hxx` | units, AI provenance, secrets (inside functions and classes) (C is parsed with the C++ grammar) |
| Go | `.go` | units, AI provenance, secrets (inside functions and classes) |
| Rust | `.rs` | units, AI provenance, secrets (inside functions and classes) |
| PHP | `.php .phtml` | units, AI provenance, secrets (inside functions and classes) |
| Shell | `.sh .bash .zsh`, `#!…sh/bash/zsh` scripts | units, AI provenance, secrets (inside functions and classes) |

Every file is parsed with [tree-sitter](https://tree-sitter.github.io/) (bundled, no install needed). Files with a syntax error are reported as `parse-failed` in coverage and their readable parts are still analyzed. The external scanners (Semgrep, ESLint, npm audit, NodeJSScan, Bearer) still cover JavaScript/TypeScript only; Athena's own rules for every language arrive in later releases.

The report header shows files per language, e.g. `12 files (js 3 · py 2 · go 1)`.

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
