import json
from datetime import datetime, timezone

from athena_ml import bench
from athena_ml.split import assign, split_of

NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)


def row(repo, code, label="human", lang="python", date="", **kw):
    return {"repo": repo, "code": code, "label": label, "language": lang, "commit_date": date, "path": "a.py",
            "startLine": 1, "endLine": 6, "commit": "abc", "source": "t", **kw}


def body(tag):
    return "\n".join(f"line_{tag}_{i} = {i}" for i in range(6))


def make_rows():
    rows = []
    for i in range(60):
        rows.append(row(f"o/h{i}", body(f"h{i}"), "human"))
        rows.append(row(f"o/a{i}", body(f"a{i}"), "ai", date="2025-06-01T00:00:00+00:00"))
    rows.append(row("o/fresh", body("fresh"), "ai", date="2026-11-01T00:00:00+00:00"))
    rows.append(row("o/short", "x = 1\ny = 2", "human"))
    rows.append(row("o/dupA", body("same"), "human"))
    rows.append(row("o/dupB", "\n".join(f"  line_same_{i}   =  {i}" for i in range(6)), "human"))
    return rows


def test_no_repo_or_hash_in_two_splits_and_short_units_dropped():
    splits = assign(make_rows(), NOW)
    repo_split, hash_split = {}, {}
    for name, rows in splits.items():
        for r in rows:
            assert repo_split.setdefault(r["repo"], name) == name
            assert hash_split.setdefault(r["sha256"], name) == name
    assert all(r["repo"] != "o/short" for rows in splits.values() for r in rows)
    dups = [r for rows in splits.values() for r in rows if r["repo"] in ("o/dupA", "o/dupB")]
    assert len(dups) == 1
    newest = {r["repo"] for r in splits["newest"]}
    assert "o/fresh" in newest and len(newest) <= 14  # the newest ~20% of the 61 AI repos
    assert all(r["label"] != "human" for r in splits["newest"])
    assert split_of("o/h1") == split_of("o/h1")
    assert len(splits["train"]) > len(splits["dev"]) and len(splits["train"]) > len(splits["test"])


def test_manifest_has_no_code_and_stats_count_per_language(tmp_path):
    splits = assign(make_rows(), NOW)
    bench.write_manifest(splits, tmp_path / "manifest.jsonl.gz")
    import gzip
    first = json.loads(gzip.open(tmp_path / "manifest.jsonl.gz", "rt").readline())
    assert "code" not in first and first["sha256"] and first["repo"]
    stats = bench.write_stats(splits, tmp_path / "stats.json")
    assert sum(stats["newest"]["python"].values()) >= 1
    assert json.loads((tmp_path / "stats.json").read_text()) == stats
