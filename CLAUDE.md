# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Athena is an AI Code Provenance Tracker — a developer security tool that detects likely AI-generated code sections in JavaScript/TypeScript codebases and runs targeted security analysis on flagged sections. It operates as both a CLI tool (pre-commit hook) and a web platform (GitHub repo scanner with live terminal streaming).

## Monorepo Structure

This is a npm workspace monorepo with four packages:

- **`core/`** — Shared analysis engine (AST parsing, scoring, security analysis, reporting). Zero CLI/web deps.
- **`cli/`** — npm-installable CLI tool with pre-commit hook. Imports `@athena/core`.
- **`backend/`** — Express + WebSocket server for web platform. Imports `@athena/core`.
- **`frontend/`** — React + Vite dashboard for repo scanning.

## Common Commands

### Building
```bash
# Build all packages
npm run build

# Build specific packages
npm run build:core
npm run build:cli
npm run build:backend
npm run build:frontend
```

### Development
```bash
# Run CLI in dev mode (tsx)
npm run scan

# Run backend dev server
npm run dev:backend

# Run frontend dev server
npm run dev:frontend

# Run both backend and frontend
npm run dev
```

### Testing
```bash
# Run tests for a specific workspace
npm test -w @athena/core
npm test -w @athena/backend
npm test -w @arsh342/athena

# Run single test file
node --import tsx --test core/test/secret-detector.test.ts
```

### CLI Usage
```bash
# Scan current directory
npm run scan

# Scan specific directory
npm run scan -- ./path/to/dir

# Check staged files (pre-commit)
npm run check

# Install pre-commit hook
npm run init

# Check toolchain health
npm run doctor
```

## Core Engine Architecture

The core engine (`core/`) is the shared analysis pipeline consumed by both CLI and web. Key components:

### Pipeline Flow
1. **AST Parser** (`core/src/parser/ast-parser.ts`) — Uses TypeScript Compiler API to parse JS/TS/JSX/TSX files into `CodeUnit` objects (functions, classes, methods, arrow functions).

2. **Heuristic Scorer** (`core/src/scorer/heuristic-scorer.ts`) — Scores each code unit using 13 weighted signals:
   - `genericNames`, `commentRatio`, `obviousComments`, `emptyCatch`, `nullChecks`
   - `formattingUniformity`, `universalJsdoc`, `namingEntropy`, `boilerplatePatterns`
   - `helperOrdering`, `emojiComments`, `perplexity`, `burstiness`

3. **Security Analyzers** (`core/src/analyzers/`) — Multiple analyzers for detecting security issues:
   - `secret-detector.ts` — Regex + Shannon entropy for hardcoded secrets
   - `security-analyzer.ts` — Pattern-based security issue detection
   - `hallucination-detector.ts` — Detects hallucinated API calls
   - `burstiness-analyzer.ts` — Text burstiness analysis
   - `perplexity-analyzer.ts` — Perplexity scoring

4. **Scanner Registry** (`core/src/scanner-registry.ts`) — Manages external security scanners:
   - `semgrep` — Static analysis via subprocess
   - `eslint` — Programmatic ESLint API with security rules
   - `npmAudit` — npm audit for dependency vulnerabilities
   - `nodejsscan` — Docker-based Node.js security scanner
   - `bearer` — SAST scanner

5. **Report Generator** (`core/src/report/report-generator.ts`) — Generates reports in multiple formats (terminal, JSON, JSONL).

### Key Types (`core/src/types.ts`)
- `CodeUnit` — Parsed code block with metadata
- `ScoredUnit` — Code unit with AI score and signal breakdown
- `ClassifiedFinding` — Security finding with severity and AI context
- `ScanReport` — Complete scan results with summary statistics

### Scanner Plugin Interface
External scanners implement the `ScannerPlugin` interface:
```typescript
interface ScannerPlugin {
  name: string;
  version: string;
  enabled: boolean;
  run: (filePaths: string[], projectRoot: string, config: any) => Promise<any[]>;
  checkAvailable: () => Promise<boolean>;
  normalize: (finding: any, config: AthenaConfig) => ClassifiedFinding;
}
```

## Important Implementation Notes

### ESLint v9 Compatibility
ESLint v9 removed the `useEslintrc` option and changed config loading. The ESLint adapter (`core/src/analyzers/eslint-adapter.ts`) uses:
- `@eslint/eslintrc` package's `FlatCompat` class to translate legacy configs
- Temporary config file creation in project directory
- `ignore: false` to prevent file ignoring issues

### Progress Hooks
The scan engine supports progress callbacks for real-time UI updates:
```typescript
interface ScanProgressEvent {
  filePath: string;
  index: number;
  total: number;
  status: 'scanning' | 'scanned' | 'skipped' | 'missing';
  findings: number;
}
```

### Configuration
Default config in `core/src/config.ts` with mergeable partial configs. Key settings:
- `threshold` — AI score threshold (default: 9)
- `blockOn` — Severities that block commits (default: ['CRITICAL', 'HIGH'])
- Scanner enable/disable flags

## CLI Architecture

The CLI (`cli/`) uses Commander.js with commands:
- `scan` — Full directory scan
- `check` — Staged files only (pre-commit)
- `init` — Install pre-commit hook
- `uninstall` — Remove pre-commit hook
- `doctor` — Toolchain health check
- `setup semgrep` — Install optional scanner
- `menu` — Interactive terminal selector

## Web Platform Architecture

### Backend (`backend/`)
- Express server with JWT auth
- WebSocket support for terminal streaming
- Repo cloning via `simple-git`
- Scan orchestration using `@athena/core`
- In-memory data store (PostgreSQL planned)

### Frontend (`frontend/`)
- React + Vite
- xterm.js for terminal emulation
- Protected routes with auth
- Dashboard and report views

## TypeScript Configuration

Base config in `tsconfig.base.json`:
- Target: ES2022
- Module: NodeNext
- Strict mode enabled
- All packages extend this base config

## Testing

Tests use Node.js native test runner with `tsx` for TypeScript support:
```bash
node --import tsx --test test/**/*.test.ts
```

## Known Issues

- ESLint v9 config loading requires temporary file creation
- tsx may have IPC pipe permission issues in some environments
- nodejsscan requires Docker to be running
- bearer requires separate installation
