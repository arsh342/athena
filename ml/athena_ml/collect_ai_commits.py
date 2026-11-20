"""Real-world AI code: units whose lines git blame credits to AI-assisted commits (core isAiCommit)."""
from __future__ import annotations

import json
import random
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .collect_human import git, licence_ok, load_yaml
from .github import GitHub
from .units_cli import extract_units

# Text markers agents leave in commit messages. Core's isAiCommit makes the final call per commit.
COMMIT_QUERIES = [
    '"Co-authored-by: Claude" noreply@anthropic.com',
    '"Generated with Claude Code"',
    '"Co-authored-by: Copilot"',
    '"Co-authored-by: cursoragent"',
    '"Co-authored-by: Codex"',
    '"Co-authored-by: Devin"',
    '"aider:"',
    '"Co-authored-by: Jules"',
]


def label_for(fraction: float, cfg: dict[str, Any]) -> str | None:
    if fraction >= cfg["ai"]["min_ai_fraction"]:
        return "ai"
    lo, hi = cfg["ai"]["refined_range"]
    if lo <= fraction <= hi:
        return "refined"
    return None


def collect_repo(repo_dir: Path, repo_name: str, cfg: dict[str, Any], seed: int = 7) -> list[dict]:
    head = git(["rev-parse", "HEAD"], cwd=repo_dir).strip()
    head_date = git(["log", "-1", "--format=%cI", "HEAD"], cwd=repo_dir).strip()
    units = [u for u in extract_units(repo_dir, ai=True) if "aiFraction" in u]
    random.Random(seed).shuffle(units)
    rows = []
    for unit in units:
        label = label_for(unit["aiFraction"], cfg)
        if label is None:
            continue
        rows.append({**unit, "label": label, "repo": repo_name, "commit": head, "commit_date": head_date, "source": "github-ai-commit"})
        if len(rows) >= cfg["ai"]["max_units_per_repo"]:
            break
    return rows


def month_windows(since: str, until: str) -> list[str]:
    """`YYYY-MM-01..YYYY-MM-28` windows, newest first, so results are spread over time instead of all recent."""
    y, m = int(since[:4]), int(since[5:7])
    uy, um = int(until[:4]), int(until[5:7])
    out = []
    while (y, m) <= (uy, um):
        out.append(f"{y:04d}-{m:02d}-01..{y:04d}-{m:02d}-28")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out[::-1]


def search_ai_repos(gh: GitHub, cfg: dict[str, Any], until: str | None = None, want: int = 400) -> dict[str, dict]:
    """Unique public non-fork repos with AI-marked commits, one search per marker query and month."""
    from datetime import date
    repos: dict[str, dict] = {}
    until = until or date.today().isoformat()
    for window in month_windows(cfg["ai"]["committed_since"], until):
        for query in COMMIT_QUERIES:
            try:
                data = gh.get("/search/commits", {"q": f"{query} committer-date:{window}", "sort": "committer-date",
                                                  "order": "desc", "per_page": 100})
            except Exception:  # a failed query must not end the collection
                continue
            for item in data.get("items", []):
                repo = item.get("repository") or {}
                if repo.get("full_name") and not repo.get("fork") and not repo.get("private"):
                    repos.setdefault(repo["full_name"], repo)
        if len(repos) >= want:
            break
    return repos


def collect(gh: GitHub, out_dir: Path, max_repos: int = 60, languages: set[str] | None = None, want: int = 400) -> int:
    """`languages`: only repos whose GitHub primary language is in this set (saves cloning repos we do not need)."""
    cfg = load_yaml("languages.yaml")
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "ai.jsonl"
    seen = {json.loads(l)["repo"] for l in target.read_text().split("\n") if l.strip()} if target.exists() else set()
    done = 0
    with target.open("a", encoding="utf-8") as sink:
        for name in search_ai_repos(gh, cfg, want=want):
            if done >= max_repos:
                break
            if name in seen:
                continue
            try:
                info = gh.get(f"/repos/{name}")
            except Exception:  # repo vanished or API error: skip it
                continue
            print(f"  {name}: licence={(info.get('license') or {}).get('spdx_id')} size_kb={info.get('size')}", flush=True)
            if languages and (info.get("language") or "") not in languages:
                continue
            if not licence_ok(info) or info.get("size", 0) > cfg["ai"]["max_repo_kb"]:
                continue
            with tempfile.TemporaryDirectory() as tmp:
                dest = Path(tmp) / "r"
                try:
                    git(["clone", "-q", "--no-tags", info["clone_url"], str(dest)], timeout=1200)
                    rows = collect_repo(dest, name, cfg)
                except (RuntimeError, subprocess.TimeoutExpired):
                    continue
            for row in rows:
                row["licence"] = (info.get("license") or {}).get("spdx_id")
                sink.write(json.dumps(row) + "\n")
            done += 1
    return done
