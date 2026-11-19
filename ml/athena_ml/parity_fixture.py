"""Write core/test/fixtures/fast-parity.json: 200 feature vectors (no code) + reference probabilities."""
from __future__ import annotations

import gzip
import json
import random
from pathlib import Path

import numpy as np

from .export_fast import load_model, predict_proba
from .features_io import extract, to_matrix
from .run_train import OUT_MODEL, RAW

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    rows = [json.loads(l) for p in sorted(RAW.glob("*.jsonl")) for l in p.read_text().split("\n") if l.strip()]
    random.Random(3).shuffle(rows)
    rows = rows[:200]
    feats = extract(rows)
    stem = sorted(OUT_MODEL.glob("*.json"))[-1].with_suffix("")
    model = load_model(stem)
    probs = predict_proba(model, to_matrix(feats))
    out = [{"language": r["language"], "dense": f["dense"], "family": f["family"], "idx": f["idx"], "val": f["val"],
            "probs": dict(zip(model["classes"], map(float, p)))} for r, f, p in zip(rows, feats, probs)]
    path = ROOT / "core" / "test" / "fixtures" / "fast-parity.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(json.dumps({"model": stem.name, "vectors": out}) + "\n")
    print("wrote", path, len(out))


if __name__ == "__main__":
    main()
