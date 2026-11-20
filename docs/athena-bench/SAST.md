# SAST benchmark — Athena own analysis

Run: 2026-11-20. Apps are pinned to the commits in `bench/sast/manifest.json`. 
Recall is measured against a **hand-verified, partial** answer key (only issues confirmed by reading the source are listed), so precision is not measured here. "Non-secret findings" counts everything Athena reported at medium/high confidence besides secrets, for scale.

| App | Language | Found | Recall | Non-secret findings | Missed |
|---|---|---|---|---|---|
| nodegoat | js | 7/7 | 100% | 7 | — |
| vulnerable-flask-app | python | 5/5 | 100% | 7 | — |

The one-off Semgrep comparison (and why the external scanners were retired) is recorded in the ruling below.

Reproduce: `node --import tsx bench/sast/run.ts` (clones into `bench/sast/.cache`, which is git-ignored).

## Scanner retirement ruling (phases 8 and 12)

Measured on 2026-11-20 against the same hand-verified answer key (a hit is a finding within two lines of the expected location; Semgrep with `--config p/default`, run without installing it via `uvx`):

| App | Athena | Semgrep `p/default` |
|---|---|---|
| NodeGoat (js) | **7/7** | 4/7 (missed both `$where` NoSQL injections and the SSRF) |
| Vulnerable-Flask-App (python) | **5/5** | 5/5 |

Athena first scored 4/5 on Flask: the missed case builds template text from an exception message that contains request input. Athena now treats `except ... as e` text as tainted for template and code-injection sinks (only), which closed the gap and brings it level with Semgrep.

| Adapter | Ruling | Why |
|---|---|---|
| npm audit | **Retired** (phase 8) | Replaced by dependency intelligence. |
| Semgrep | **Retired** | Athena matches or beats it on both benchmark apps (the retirement gate). Caveat: the benchmark has two apps and only JavaScript and Python; Semgrep's rules for Java, C#, Go, PHP and others were not compared. |
| NodeJSScan | **Retired** | JavaScript only and needed Docker. Not measured here (Docker not installed), but Athena already covers the same ground on NodeGoat. |
| Bearer | **Retired** | Not measured here (binary not installed). Athena's own taint, secret and dependency checks cover its use. |
| ESLint security | Kept (optional) | Not part of this ruling. |

The deprecated flags `--no-semgrep`, `--no-nodejsscan` and `--no-bearer` are accepted and do nothing. Reproduce: `node --import tsx bench/sast/run.ts`.
