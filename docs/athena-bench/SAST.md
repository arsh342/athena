# SAST benchmark — Athena own analysis

Run: 2026-11-19. Apps are pinned to the commits in `bench/sast/manifest.json`. 
Recall is measured against a **hand-verified, partial** answer key (only issues confirmed by reading the source are listed), so precision is not measured here. "Non-secret findings" counts everything Athena reported at medium/high confidence besides secrets, for scale.

| App | Language | Found | Recall | Non-secret findings | Missed |
|---|---|---|---|---|---|
| nodegoat | js | 7/7 | 100% | 7 | — |
| vulnerable-flask-app | python | 4/5 | 80% | 6 | `app/app.py:281 taint.template-injection` |

Semgrep/Opengrep is not installed on this machine, so no side-by-side comparison was run.

Reproduce: `node --import tsx bench/sast/run.ts` (clones into `bench/sast/.cache`, which is git-ignored).

## Scanner retirement ruling (phase 8)

The retirement gate is: Athena recall >= the external tool's recall **and** precision >= 0.70 on the benchmark for that language.

| Adapter | Ruling | Why |
|---|---|---|
| npm audit | **Retired** | Replaced by dependency intelligence (OSV advisories for every ecosystem, reachability, registry checks). `--no-npm-audit` is a deprecated no-op for one release. |
| Semgrep / Opengrep | Kept (optional) | Not installed here, so recall could not be compared; Athena's recall on its own benchmark is JS 7/7 and Python 4/5, and precision is not measured (partial answer key). The gate cannot be shown to pass. |
| ESLint security | Kept (optional) | Not installed here; JS only. Gate not measurable. |
| NodeJSScan | Kept (optional) | Needs Docker, not installed here. Gate not measurable. |
| Bearer | Kept (optional) | Not installed here. Gate not measurable. |

Re-run the gate with the tools installed (`node --import tsx bench/sast/run.ts` runs Semgrep when present) before retiring the rest. The benchmark only covers JavaScript and Python so far; the other languages have no answer key yet.
