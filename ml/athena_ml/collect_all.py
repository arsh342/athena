"""Run the full web collection into ml/data/ (gitignored). Resumable per language."""
from __future__ import annotations

import sys
import time
from pathlib import Path

from . import collect_ai_commits, collect_human
from .github import GitHub

DATA = Path(__file__).resolve().parents[1] / "data" / "raw"


def main(argv: list[str]) -> None:
    gh = GitHub()
    cfg = collect_human.load_yaml("languages.yaml")
    what = argv[0] if argv else "all"
    if what in ("ai", "all"):
        n = collect_ai_commits.collect(gh, DATA, max_repos=int(argv[1]) if len(argv) > 1 else 60)
        print(f"ai repos collected: {n}", flush=True)
    if what in ("human", "all"):
        for language in cfg["languages"]:
            target = DATA / f"human-{cfg['languages'][language]}.jsonl"
            if target.exists() and target.stat().st_size > 0:
                print(f"skip {language} (exists)", flush=True)
                continue
            t = time.time()
            n = collect_human.collect_language(gh, language, DATA, limit=int(argv[1]) if len(argv) > 1 else None)
            print(f"{language}: {n} repos in {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
