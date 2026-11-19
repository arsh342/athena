from __future__ import annotations

import hashlib
import re

MIN_CODE_LINES = 5


def norm_hash(code: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", "", code).encode("utf-8")).hexdigest()


def code_lines(code: str) -> int:
    return sum(1 for line in code.splitlines() if line.strip())


def dedup(rows: list[dict]) -> list[dict]:
    """Drop units under 5 code lines and duplicates (whitespace-normalised hash); the first row wins."""
    seen: set[str] = set()
    out = []
    for row in rows:
        if code_lines(row["code"]) < MIN_CODE_LINES:
            continue
        h = norm_hash(row["code"])
        if h in seen:
            continue
        seen.add(h)
        out.append({**row, "sha256": h})
    return out
