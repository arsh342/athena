# Synopsis v3: what is out of date and what to say instead

`docs/athena_synopsis_v3.docx` and `.pdf` describe the early prototype. Paste the replacements below into the matching sections.

## Stale statements

| Synopsis says | Now |
|---|---|
| "11-signal heuristic scoring, static analysis via ESLint and Semgrep" | Athena has its own analysis engine (tree-sitter, 9 language families, taint tracking, 62 secret detectors). Semgrep, NodeJSScan and Bearer were retired after a measured comparison (Athena 7/7 on NodeGoat and 5/5 on Flask; Semgrep 4/7 and 5/5). |
| AI-code detection by heuristic only | Athena has its own fast detector (athena-detect-fast 0.2.0). JavaScript passes the release gate (F1 0.93, false-positive rate 3.2%, 4.8% on 2022-era human code); other languages fall back to the heuristic and say so. |
| Provenance is a single score | Provenance reports two numbers: *recorded* (what git history credits to AI tools, a floor) and *estimated* (a model, low confidence). |
| JavaScript and TypeScript only | Nine language families. |
| Pre-commit gate only | `athena review` (staged, uncommitted, range, base), pre-commit and pre-push gates, an MCP server (14 tools) and a Claude Code plugin. |
| No dependency checks | Vulnerable, missing and typosquatted package checks for 10 ecosystems, a local OSV database, CISA KEV and EPSS, CycloneDX SBOM output. |
| No AI use | Optional bring-your-own-key AI layer (verify, hunt, deep) with hard spend caps ($0.25 per run, $1 per day by default). The offline engine finds and grades candidates; the AI only settles the uncertain ones. Web scans can use it too, and the results are saved with the scan. |
| Web platform shows a plain report | Editorial site theme; findings show the AI verdict; the report shows what the AI step checked and spent. |

## Replacement for "Advantages"

- Runs entirely on the developer's machine. No account or API key is needed.
- Reviews a change rather than the whole repository, so only what the change introduced blocks a commit.
- Cheap by construction: AI is optional, capped, cached and used only for findings the offline engine could not settle.
- Honest about what it does not know: each language reports whether its detector passed the release gate, and provenance separates recorded evidence from estimates.

## Replacement for "Disadvantages and future work"

- Only JavaScript passes the AI-code detector gate. Python and TypeScript need more distinct AI-written repositories in the test split (at least 5 per class).
- The AI layer has been tested against fakes, not against a live provider with a measured benchmark.
- Opt-in label sharing and a neural detector are not built.
- Field sensitivity and default-import resolution are missing from taint analysis.

## References to add

- CISA Known Exploited Vulnerabilities catalogue; FIRST EPSS; OSV schema; CycloneDX 1.x; Model Context Protocol; Agent Skills format.
