from __future__ import annotations

import hashlib
from datetime import datetime

from .dedup import dedup

NEWEST_SHARE = 0.20


def split_of(repo: str) -> str:
    """Deterministic repo-level 80/10/10 split."""
    bucket = int(hashlib.sha256(repo.encode("utf-8")).hexdigest(), 16) % 100
    return "train" if bucket < 80 else "dev" if bucket < 90 else "test"


def assign(rows: list[dict], collected_at: datetime | None = None) -> dict[str, list[dict]]:
    """Repo-level splits with no repo and no normalised-code hash in two splits, plus `newest`.

    `newest` = the most recent 20% of AI/refined repos by HEAD commit date, held out of train/dev/test
    entirely so it is an extra held-out set of recently active repos (HEAD date is the last push, not when the AI code was written). (A fixed 60-day window put
    almost every active AI repo in it, leaving nothing to train on.)
    """
    dated = sorted({(r["commit_date"], r["repo"]) for r in rows if r["label"] != "human" and r.get("commit_date")})
    take = max(1, round(len(dated) * NEWEST_SHARE)) if dated else 0
    newest_repos = {repo for _, repo in dated[len(dated) - take:]} if take else set()
    out: dict[str, list[dict]] = {"train": [], "dev": [], "test": [], "newest": []}
    owner: dict[str, str] = {}
    for row in dedup(rows):
        name = "newest" if row["repo"] in newest_repos else split_of(row["repo"])
        first = owner.setdefault(row["sha256"], name)
        if first != name:
            continue  # same normalised code already lives in another split
        out[name].append({**row, "split": name})
    return out
