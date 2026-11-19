"""Wrapper around core's Node units extractor (core/dist/ml/units-cli.js)."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Iterator

REPO_ROOT = Path(__file__).resolve().parents[2]
UNITS_CLI = REPO_ROOT / "core" / "dist" / "ml" / "units-cli.js"
GIT_ENV = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}


def extract_units(repo: Path, ai: bool = False, max_units: int = 1_000_000) -> Iterator[dict]:
    if not UNITS_CLI.exists():
        raise FileNotFoundError(f"{UNITS_CLI} missing: run `npm run build -w @athena/core`")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "units.jsonl"
        cmd = ["node", str(UNITS_CLI), "--repo", str(repo), "--out", str(out), "--max-units", str(max_units)]
        if ai:
            cmd.append("--ai")
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=900, env={**os.environ, **GIT_ENV})
        if done.returncode != 0:
            raise RuntimeError(done.stderr.strip() or "units-cli failed")
        for line in out.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                yield json.loads(line)
