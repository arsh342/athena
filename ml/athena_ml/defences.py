"""
Defences for shared labels. Records come from strangers' machines, so every defence assumes some of them are wrong or hostile.

Weights (spec section 4b):
  - git-recorded and pre-2021 labels count fully (1.0);
  - a user correction counts 0.25, and only when at least 3 different install ids agree on it
    (same language and label, style vectors with cosine similarity >= 0.95);
  - at most 2,000 records per install id per 30 days count at all;
  - records far from the distribution of their label and language (robust z-score) are dropped.
Nothing here changes a live model: the output feeds the release pipeline, and a release must still pass the benchmark (see `release_allowed`).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np

FULL_SOURCES = {"git-recorded", "pre-2021"}
USER_WEIGHT = 0.25
MIN_AGREEING_INSTALLS = 3
COSINE_AGREEMENT = 0.95
MAX_PER_INSTALL = 2000
WINDOW_DAYS = 30
OUTLIER_Z = 4.0
MIN_GROUP_FOR_OUTLIERS = 20


@dataclass
class Result:
    records: list[dict]
    dropped: dict[str, int] = field(default_factory=dict)


def _parse(ts: str | None) -> datetime:
    if not ts:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def cap_per_install(rows: list[dict], max_per: int = MAX_PER_INSTALL, window_days: int = WINDOW_DAYS) -> tuple[list[dict], int]:
    """Keep at most `max_per` records per install id in any `window_days` window (the earliest ones; a flood cannot crowd out others)."""
    kept: list[dict] = []
    dropped = 0
    by_install: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_install[r["record"]["installId"]].append(r)
    for rs in by_install.values():
        rs.sort(key=lambda r: _parse(r.get("received_at")))
        window: list[datetime] = []
        for r in rs:
            t = _parse(r.get("received_at"))
            window = [w for w in window if t - w < timedelta(days=window_days)]
            if len(window) >= max_per:
                dropped += 1
                continue
            window.append(t)
            kept.append(r)
    return kept, dropped


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def corroborated(rows: list[dict], candidate: dict, min_installs: int = MIN_AGREEING_INSTALLS, cosine: float = COSINE_AGREEMENT) -> bool:
    """At least `min_installs` different install ids (the candidate's own included) hold a record with the same language and label and a similar style."""
    rec = candidate["record"]
    mine = _unit(np.asarray(rec["style"], dtype=float))
    installs = {rec["installId"]}
    for other in rows:
        o = other["record"]
        if o["installId"] in installs or o["language"] != rec["language"] or o["label"] != rec["label"] or len(o["style"]) != len(rec["style"]):
            continue
        if float(np.dot(mine, _unit(np.asarray(o["style"], dtype=float)))) >= cosine:
            installs.add(o["installId"])
            if len(installs) >= min_installs:
                return True
    return len(installs) >= min_installs


def drop_outliers(rows: list[dict], z_limit: float = OUTLIER_Z, min_group: int = MIN_GROUP_FOR_OUTLIERS) -> tuple[list[dict], int]:
    """Per (label, language) group, drop records whose style is far from the group's median (root-mean-square robust z above `z_limit`)."""
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["record"]["label"], r["record"]["language"])].append(r)
    kept: list[dict] = []
    dropped = 0
    for rs in groups.values():
        if len(rs) < min_group:
            kept.extend(rs)
            continue
        m = np.asarray([r["record"]["style"] for r in rs], dtype=float)
        med = np.median(m, axis=0)
        mad = np.median(np.abs(m - med), axis=0) * 1.4826
        ok = mad > 1e-9
        if not ok.any():
            kept.extend(rs)
            continue
        z = (m[:, ok] - med[ok]) / mad[ok]
        score = np.sqrt(np.mean(z ** 2, axis=1))
        for r, s in zip(rs, score):
            if s > z_limit:
                dropped += 1
            else:
                kept.append(r)
    return kept, dropped


def apply_defences(rows: list[dict]) -> Result:
    """`rows`: {"record": <contribution>, "received_at": iso}. Returns the surviving records with a `weight`, and why others were dropped."""
    dropped: dict[str, int] = {}
    rows, n = cap_per_install(rows)
    dropped["over the per-install cap"] = n
    rows, n = drop_outliers(rows)
    dropped["outlier"] = n
    out: list[dict] = []
    uncorroborated = 0
    for r in rows:
        src = r["record"]["labelSource"]
        if src in FULL_SOURCES:
            out.append({**r, "weight": 1.0})
        elif src == "user-correction":
            if corroborated(rows, r):
                out.append({**r, "weight": USER_WEIGHT})
            else:
                uncorroborated += 1
        # an unknown source is never trusted
    dropped["user correction without 3 agreeing installs"] = uncorroborated
    return Result(records=out, dropped={k: v for k, v in dropped.items() if v})


def recalibrate_threshold(records: list[dict], language: str, max_fpr: float = 0.05, floor: float = 0.5) -> float | None:
    """The lowest decision threshold (at least `floor`) whose weighted human false-positive rate on shared data is within `max_fpr`. None if there is too little data."""
    rs = [r for r in records if r["record"]["language"] == language]
    humans = [(r["record"]["probabilities"]["ai"], r["weight"]) for r in rs if r["record"]["label"] == "human"]
    ais = [r for r in rs if r["record"]["label"] == "ai"]
    if sum(w for _, w in humans) < 50 or len(ais) < 50:
        return None
    total = sum(w for _, w in humans)
    for t in np.arange(floor, 0.99, 0.01):
        fp = sum(w for p, w in humans if p >= t)
        if fp / total <= max_fpr:
            return round(float(t), 2)
    return None


def release_allowed(before: dict[str, dict], after: dict[str, dict], max_fpr: float = 0.05, min_f1: float = 0.85, tolerance: float = 0.005) -> tuple[bool, list[str]]:
    """
    The release gate for anything learned with shared data. `before` and `after` are per-language benchmark metrics (f1, fpr, recall) on Athena-Bench,
    which contains no shared data. Every language that was enabled must still meet the targets and must not lose AI recall.
    """
    reasons: list[str] = []
    for lang, b in before.items():
        a = after.get(lang)
        if a is None:
            reasons.append(f"{lang}: missing from the new benchmark run")
            continue
        if a["fpr"] > max_fpr:
            reasons.append(f"{lang}: human false-positive rate {a['fpr']:.1%} > {max_fpr:.0%}")
        if a["f1"] < min_f1:
            reasons.append(f"{lang}: F1 {a['f1']:.2f} < {min_f1}")
        if a["recall"] < b["recall"] - tolerance:
            reasons.append(f"{lang}: AI recall fell from {b['recall']:.1%} to {a['recall']:.1%}")
    return (not reasons), reasons
