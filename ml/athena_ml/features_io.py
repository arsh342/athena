"""Feature extraction via core's Node CLI (TypeScript is the single source of truth) and sparse assembly."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy import sparse

REPO_ROOT = Path(__file__).resolve().parents[2]
EXTRACT_CLI = REPO_ROOT / "core" / "dist" / "ml" / "extract-cli.js"
HASH_BUCKETS = 1 << 18
N_DENSE = 35
N_FAMILY = 9
N_FEATURES = HASH_BUCKETS + N_DENSE + N_FAMILY


def extract(rows: list[dict]) -> list[dict]:
    """rows need id, language, code. Returns one feature record per row, in order."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "in.jsonl", Path(tmp) / "out.jsonl"
        src.write_text("".join(json.dumps({"id": str(i), "language": r["language"], "code": r["code"]}) + "\n" for i, r in enumerate(rows)))
        done = subprocess.run(["node", str(EXTRACT_CLI), "--in", str(src), "--out", str(dst)], capture_output=True, text=True, timeout=3600)
        if done.returncode != 0:
            raise RuntimeError(done.stderr.strip())
        return [json.loads(line) for line in dst.read_text().splitlines() if line.strip()]


def to_matrix(features: list[dict]) -> sparse.csr_matrix:
    indptr, indices, data = [0], [], []
    for f in features:
        idx = list(f["idx"]) + [HASH_BUCKETS + i for i in range(N_DENSE)] + [HASH_BUCKETS + N_DENSE + i for i in range(N_FAMILY)]
        val = list(f["val"]) + list(f["dense"]) + list(f["family"])
        indices.extend(idx)
        data.extend(val)
        indptr.append(len(indices))
    return sparse.csr_matrix((np.array(data, dtype=np.float64), np.array(indices), np.array(indptr)), shape=(len(features), N_FEATURES))
