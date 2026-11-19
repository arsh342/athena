import json
import os
import subprocess
from pathlib import Path

import pytest

from athena_ml import collect_ai_commits as ai
from athena_ml import collect_human as human
from athena_ml.github import GitHub

CFG = human.load_yaml("languages.yaml")

FUNC = """def {name}(items):
    total = 0
    for item in items:
        if item > 0:
            total += item
    return total
"""


def run(cwd: Path, *args: str, env: dict | None = None) -> str:
    e = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_AUTHOR_DATE": "2021-01-01T00:00:00", "GIT_COMMITTER_DATE": "2021-01-01T00:00:00", **(env or {})}
    return subprocess.run(["git", *args], cwd=cwd, env=e, capture_output=True, text=True, check=True).stdout


def commit(repo: Path, message: str, date: str, author: str = "Dev One <dev@example.com>") -> None:
    name, email = author.split(" <")
    env = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date, "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email[:-1],
           "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email[:-1]}
    run(repo, "add", "-A")
    run(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message, env=env)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    run(tmp_path, "init", "-q", "-b", "main")
    return tmp_path


def test_licence_gate_rejects_gpl_and_accepts_mit():
    assert human.licence_ok({"license": {"spdx_id": "MIT"}})
    assert not human.licence_ok({"license": {"spdx_id": "GPL-3.0"}})
    assert not human.licence_ok({"license": None})
    assert not human.licence_ok({"license": {"spdx_id": "NOASSERTION"}})


def test_human_collector_uses_commit_before_cutoff(repo: Path):
    (repo / "old.py").write_text(FUNC.format(name="old_total"))
    commit(repo, "old", "2020-01-01T00:00:00")
    (repo / "new.py").write_text(FUNC.format(name="new_total"))
    commit(repo, "new", "2023-01-01T00:00:00")
    rows = human.collect_repo(repo, "o/r", CFG)
    assert [r["name"] for r in rows] == ["old_total"]
    assert rows[0]["label"] == "human" and rows[0]["repo"] == "o/r" and rows[0]["language"] == "python"


def test_ai_collector_labels_ai_refined_and_excludes_human_coauthor(repo: Path):
    (repo / "ai_fn.py").write_text(FUNC.format(name="ai_total"))
    commit(repo, "feat: add\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "2025-03-01T00:00:00", "Dev One <dev@example.com>")
    mixed = FUNC.format(name="mixed_total")
    (repo / "mixed.py").write_text(mixed)
    commit(repo, "feat: mixed\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "2025-03-02T00:00:00")
    # a human rewrites ~half of the lines of mixed_total
    (repo / "mixed.py").write_text(mixed.replace("total = 0", "total = 0  # human").replace("if item > 0:", "if item >= 1:").replace("total += item", "total = total + item"))
    commit(repo, "tweak by hand", "2025-03-03T00:00:00")
    (repo / "pair.py").write_text(FUNC.format(name="pair_total"))
    commit(repo, "feat: pair\n\nCo-authored-by: Jules Martin <jules@corp.fr>", "2025-03-04T00:00:00")
    rows = {r["name"]: r for r in ai.collect_repo(repo, "o/ai", CFG)}
    assert rows["ai_total"]["label"] == "ai"
    assert rows["mixed_total"]["label"] == "refined"
    assert "pair_total" not in rows


def test_github_client_retries_after_rate_limit():
    import io
    import urllib.error

    calls = {"n": 0}
    sleeps: list[float] = []

    class Resp:
        headers = {"X-RateLimit-Remaining": "50"}
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'

    def opener(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(req.full_url, 403, "rate", {"Retry-After": "3"}, io.BytesIO(b"{}"))  # type: ignore[arg-type]
        return Resp()

    gh = GitHub(token="x", opener=opener, sleep=sleeps.append)
    assert gh.get("/x") == {"ok": True}
    assert calls["n"] == 2 and sleeps == [3.0]


def test_month_windows_are_newest_first_and_cover_the_range():
    w = ai.month_windows("2025-11-01", "2026-02-10")
    assert w == ["2026-02-01..2026-02-28", "2026-01-01..2026-01-28", "2025-12-01..2025-12-28", "2025-11-01..2025-11-28"]


def test_units_extractor_ignores_symlinks_that_leave_the_repo(repo: Path, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside")
    (outside / "secret.py").write_text(FUNC.format(name="outside_secret"))
    (repo / "real.py").write_text(FUNC.format(name="real_total"))
    os.symlink(outside / "secret.py", repo / "leak.py")
    commit(repo, "add", "2020-01-01T00:00:00")
    names = [u["name"] for u in human.extract_units(repo)]
    assert names == ["real_total"]
