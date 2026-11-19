# SAST benchmark — Athena own analysis

Run: 2026-11-19. Apps are pinned to the commits in `bench/sast/manifest.json`. 
Recall is measured against a **hand-verified, partial** answer key (only issues confirmed by reading the source are listed), so precision is not measured here. "Non-secret findings" counts everything Athena reported at medium/high confidence besides secrets, for scale.

| App | Language | Found | Recall | Non-secret findings | Missed |
|---|---|---|---|---|---|
| nodegoat | js | 7/7 | 100% | 7 | — |
| vulnerable-flask-app | python | 4/5 | 80% | 6 | `app/app.py:281 taint.template-injection` |

Semgrep/Opengrep is not installed on this machine, so no side-by-side comparison was run.

Reproduce: `node --import tsx bench/sast/run.ts` (clones into `bench/sast/.cache`, which is git-ignored).
