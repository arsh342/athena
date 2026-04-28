# Test Vulnerability Fixtures Design

## Goal

Create intentionally vulnerable sample files inside the existing root `test/` directory so Athena CLI can be exercised against realistic findings. The fixture set should light up multiple Athena scanners and categories without touching production app code.

## Scope

Add a self-contained fake project under `test/` with:

- JavaScript and TypeScript source files containing common app-layer vulnerabilities.
- Configuration and infrastructure files containing obvious leaked secrets and insecure defaults.
- A small `package.json` with intentionally vulnerable dependencies to trigger `npm audit`.
- Minimal documentation explaining that fixtures are intentionally unsafe and only for scanner evaluation.

Out of scope:

- Fixing Athena detection logic.
- Adding live exploit scripts or runnable malware.
- Modifying existing product source outside `test/`.

## Recommended Structure

`test/` will contain:

- `README.md` explaining purpose, expected finding classes, and safety notes.
- `package.json` for isolated vulnerable dependencies.
- `app/`
- `config/`
- `infra/`

Suggested files:

- `app/server.js`: SQL injection, command injection, path traversal, SSRF-like unsafe URL fetch.
- `app/auth.ts`: hardcoded JWT secret, weak password reset token generation, weak crypto.
- `app/template.tsx`: XSS sink via `dangerouslySetInnerHTML`.
- `app/runner.ts`: unsafe `eval` / dynamic code execution.
- `config/.env.example` or `.env.test`: fake AWS key, GitHub token, API key, weak credentials.
- `config/private.pem`: dummy private key block for secret detector coverage.
- `infra/Dockerfile`: insecure base image usage, root user, copied secret file patterns.
- `infra/workflow.yml`: risky CI usage such as plaintext token env and unpinned third-party action.

## Detection Targets

Fixtures should aim to trigger these Athena paths:

- Secret detector: hardcoded passwords, API keys, JWTs, GitHub tokens, AWS-style keys, private key material.
- ESLint security plugin: `eval`, dynamic child process execution, non-literal filesystem/process usage.
- Semgrep / nodejsscan / Bearer: injection, XSS, weak cryptography, dangerous command execution, insecure deserialization-like patterns where practical.
- `npm audit`: vulnerable dependency graph from `test/package.json`.

## Design Choices

### Single isolated fixture repo

Keep all vulnerable material inside `test/` so scans can target one path cleanly with commands like `athena scan test`.

### Obvious, labeled fixtures

Each file should include a short top comment like `INTENTIONALLY VULNERABLE TEST FIXTURE` so future contributors do not mistake these files for real app code.

### Realistic but bounded samples

Examples should look like code Athena users might actually scan, but remain short and readable so findings can be mapped back to ground truth fast.

### Fake secrets only

Use dummy tokens shaped like real secrets. Never include real credentials or valid private infrastructure details.

## Data Flow

1. User runs Athena against `test/`.
2. Athena parses JS/TS files in `test/app/`.
3. Secret detection inspects code and config fixture content.
4. External scanners inspect same tree when installed.
5. `npm audit` reads `test/package.json` if scan enters that folder.
6. User compares Athena output against known expected vulnerable patterns.

## Error Handling / Safety

- Fixtures should avoid importing repo internals.
- Files should be syntactically valid where possible so scanners parse them reliably.
- Dummy secrets should be clearly fake but still match Athena regex patterns.
- No commands should execute automatically on install or import.

## Testing Plan

Manual validation after implementation:

- Run `athena scan test`.
- Confirm at least one finding appears for secrets, injection, XSS or unsafe execution, and weak crypto.
- If optional scanners are installed, confirm additional findings from Semgrep / nodejsscan / Bearer.
- Run `npm audit` within `test/` to confirm vulnerable dependency signal exists.

## Success Criteria

- `test/` contains multi-file fixtures across app code, config, infra, and dependency metadata.
- Athena reports diverse findings when scanning `test/`.
- Fixture set is isolated, documented, and safe for local scanner benchmarking.
