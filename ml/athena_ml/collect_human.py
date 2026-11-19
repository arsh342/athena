"""Human-written code: permissively licensed repos created before 2020-06, checked out before 2021-06."""
from __future__ import annotations

import json
import random
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import yaml

from .github import GitHub
from .units_cli import GIT_ENV, extract_units

CONFIG = Path(__file__).resolve().parents[1] / "config"


def load_yaml(name: str) -> dict[str, Any]:
    return yaml.safe_load((CONFIG / name).read_text())


def licence_ok(repo: dict[str, Any], allowed: list[str] | None = None) -> bool:
    allowed = allowed if allowed is not None else load_yaml("licences.yaml")["allowed"]
    spdx = ((repo.get("license") or {}).get("spdx_id") or "").lower()
    return spdx in allowed


def git(args: list[str], cwd: Path | None = None, timeout: int = 900) -> str:
    import os
    env = {**os.environ, **GIT_ENV}
    done = subprocess.run(["git", "-c", "log.showSignature=false", *args], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=timeout)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip())
    return done.stdout


def checkout_before(repo_dir: Path, date: str) -> str | None:
    sha = git(["rev-list", "-1", f"--before={date}", "HEAD"], cwd=repo_dir).strip()
    if not sha:
        return None
    git(["checkout", "-q", sha], cwd=repo_dir)
    return sha


def collect_repo(repo_dir: Path, repo_name: str, cfg: dict[str, Any], seed: int = 7) -> list[dict]:
    """Units from one already-cloned repo, capped and labelled human."""
    sha = checkout_before(repo_dir, cfg["human"]["checkout_before"])
    if sha is None:
        return []
    units = list(extract_units(repo_dir))
    random.Random(seed).shuffle(units)
    out = []
    for unit in units[: cfg["human"]["max_units_per_repo"]]:
        out.append({**unit, "label": "human", "repo": repo_name, "commit": sha, "commit_date": "", "source": "github-human"})
    return out


def search_repos(gh: "GitHub", language: str, cfg: dict[str, Any], limit: int) -> list[dict]:
    found: dict[str, dict] = {}
    for spdx in load_yaml("licences.yaml")["allowed"][:5]:
        q = (f"language:{language} stars:>={cfg['human']['min_stars']} created:<{cfg['human']['created_before']} "
             f"license:{spdx} fork:false archived:false")
        data = gh.get("/search/repositories", {"q": q, "sort": "stars", "per_page": 30})
        for item in data.get("items", []):
            if licence_ok(item) and item.get("size", 0) < 200_000:
                found[item["full_name"]] = item
        if len(found) >= limit * 2:
            break
    return list(found.values())[: limit * 2]


def collect_language(gh: "GitHub", language: str, out_dir: Path, limit: int | None = None) -> int:
    cfg = load_yaml("languages.yaml")
    limit = limit or cfg["human"]["repos_per_language"]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"human-{cfg['languages'][language]}.jsonl"
    done = 0
    with target.open("a", encoding="utf-8") as sink:
        for repo in search_repos(gh, language, cfg, limit):
            if done >= limit:
                break
            with tempfile.TemporaryDirectory() as tmp:
                dest = Path(tmp) / "r"
                try:
                    git(["clone", "-q", "--filter=blob:none", "--no-checkout", repo["clone_url"], str(dest)])
                    rows = collect_repo(dest, repo["full_name"], cfg)
                except (RuntimeError, subprocess.TimeoutExpired):
                    continue
            for row in rows:
                row["licence"] = (repo.get("license") or {}).get("spdx_id")
                sink.write(json.dumps(row) + "\n")
            done += 1 if rows else 0
    return done
