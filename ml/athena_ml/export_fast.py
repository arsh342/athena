"""float16 export + a pure-numpy reference predictor the TypeScript inference must match."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import sparse

from .features_io import N_FEATURES


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def write_model(out_dir: Path, version: str, classes: list[str], weights: np.ndarray, biases: np.ndarray,
                temperature: float, languages: dict[str, dict], benchmark: dict, feature_spec: str = "fs1") -> Path:
    """Layout of `<name>.bin`: float16 LE weights [classes x N_FEATURES] row-major, then float32 LE biases [classes]."""
    assert weights.shape == (len(classes), N_FEATURES)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"athena-detect-fast-{version}"
    (out_dir / f"{name}.bin").write_bytes(weights.astype("<f2").tobytes() + biases.astype("<f4").tobytes())
    meta = {"version": version, "featureSpec": feature_spec, "classes": classes, "temperature": float(temperature),
            "nFeatures": N_FEATURES, "layout": "f16 weights [class][feature] then f32 biases[class]",
            "languages": languages, "benchmark": benchmark}
    (out_dir / f"{name}.json").write_text(json.dumps(meta, indent=1, sort_keys=True) + "\n")
    return out_dir / name


def load_model(stem: Path) -> dict:
    meta = json.loads(Path(f"{stem}.json").read_text())
    raw = Path(f"{stem}.bin").read_bytes()
    c, d = len(meta["classes"]), meta["nFeatures"]
    w = np.frombuffer(raw[: c * d * 2], dtype="<f2").reshape(c, d).astype(np.float64)
    b = np.frombuffer(raw[c * d * 2:], dtype="<f4").astype(np.float64)
    return {**meta, "W": w, "b": b}


def predict_proba(model: dict, x: sparse.spmatrix) -> np.ndarray:
    logits = np.asarray(x @ model["W"].T) + model["b"]
    return softmax(logits / model["temperature"])
