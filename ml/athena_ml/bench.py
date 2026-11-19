"""Athena-Bench: a manifest of references (no third-party code) plus per-language class counts."""
from __future__ import annotations

import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

MANIFEST_FIELDS = ["repo", "commit", "path", "startLine", "endLine", "sha256", "label", "language", "source", "split", "licence"]


def write_manifest(splits: dict[str, list[dict]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt", encoding="utf-8") as f:  # the manifest is large: ship it gzipped
        for name in ("train", "dev", "test", "newest"):
            for row in splits[name]:
                f.write(json.dumps({k: row.get(k) for k in MANIFEST_FIELDS}) + "\n")


def stats(splits: dict[str, list[dict]]) -> dict:
    out: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
    for name, rows in splits.items():
        counts: dict[str, Counter] = defaultdict(Counter)
        for row in rows:
            counts[row["language"]][row["label"]] += 1
        for lang, c in counts.items():
            out[name][lang] = dict(c)
    return {k: dict(v) for k, v in out.items()}


def write_stats(splits: dict[str, list[dict]], path: Path) -> dict:
    s = stats(splits)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(s, indent=1, sort_keys=True) + "\n")
    return s
