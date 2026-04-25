# Athena CLI

AI code provenance tracker for JavaScript and TypeScript repositories.

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

Check staged files:

```bash
athena check
```

Install pre-commit hook:

```bash
athena init
```

Remove pre-commit hook:

```bash
athena uninstall
```

Setup scanner dependencies:

```bash
athena setup all
athena setup all --auto
athena setup semgrep
athena setup semgrep --auto
```

## Common Options

Set threshold (default is `9`):

```bash
athena scan . --threshold 9
athena check --threshold 9
```

Choose output format:

```bash
athena scan . --format terminal
athena scan . --format json
athena scan . --format jsonl
```

## Terminal UI Behavior

- Selector mode renders in-place and re-renders dynamically.
- Scan/check reports separate AI-origin confidence from security findings.
- Direct command runs clear the terminal before rendering report output.

## Report Highlights

Terminal reports include:

- Top-level metrics (`files`, `units`, `ai-flagged units`, `duration`)
- AI-origin confidence section
- Top weighted signals
- Security findings section
- Gate status and gate reason

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
- Supports JavaScript, TypeScript, JSX, and TSX.
- Requires Node.js 18 or newer.
- ESLint scanner support is included via optional package dependencies.
- Semgrep, Docker (for nodejsscan), and Bearer CLI remain external optional tools.
