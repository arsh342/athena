# SAST benchmark

`node --import tsx bench/sast/run.ts [--lang js|python] [--app id] [--write docs]`

Runs Athena's own rule packs, taint analysis and investigation over known-vulnerable apps pinned in `manifest.json` and scores recall against a hand-verified answer key. Results: `docs/athena-bench/SAST.md`.

To add an app: pin a commit, read the source, list only issues you verified. Languages beyond JS and Python (Java, C#, Go, PHP, C/C++) still need apps and answer keys; their fixtures are covered by `core/test/rules-fixtures.test.ts` but have no external benchmark yet. The retirement gate for external scanners (phase 8) needs Athena recall >= the external tool's recall and precision >= 0.70 per language; precision needs a full labelling of an app's findings, which is not done.
