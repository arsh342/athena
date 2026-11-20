"""Assemble splits from ml/data/raw, train, calibrate, tune per-language thresholds, gate, export, write RESULTS.md."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import bench
from .evaluate import binary_metrics
from .export_fast import write_model
from .features_io import extract, to_matrix
from .split import assign
from .train_fast import p_ai, per_language, train
from .export_fast import load_model, predict_proba

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "ml" / "data" / "raw"
OUT_MODEL = ROOT / "core" / "models" / "fast"


def load_rows() -> list[dict]:
    rows = []
    for path in sorted(RAW.glob("*.jsonl")):
        for line in path.read_text().split("\n"):
            if line.strip():
                rows.append(json.loads(line))
    return rows


def matrix(rows: list[dict]):
    eras = [(r.get("era") or "2021") if r["label"] == "human" else "-" for r in rows]
    return to_matrix(extract(rows)), [r["label"] for r in rows], [r["language"] for r in rows], [r["repo"] for r in rows], eras


def main(version: str) -> None:
    now = datetime.now(timezone.utc)
    splits = assign(load_rows(), now)
    stats = bench.write_stats(splits, ROOT / "ml" / "bench" / "stats.json")
    bench.write_manifest(splits, ROOT / "ml" / "bench" / "manifest.jsonl.gz")
    print(json.dumps({k: sum(sum(c.values()) for c in v.values()) for k, v in stats.items()}), flush=True)
    data = {name: matrix(rows) for name, rows in splits.items() if rows}
    for need in ("train", "dev", "test"):
        if need not in data:
            raise SystemExit(f"no {need} data; collect more first")
    x_tr, y_tr = data["train"][:2]
    x_dev, y_dev = data["dev"][:2]
    model = train(x_tr, y_tr, x_dev, y_dev)
    stem = write_model(OUT_MODEL, version, model["classes"], model["weights"], model["biases"], model["temperature"], {}, {})
    ref = load_model(stem)  # evaluate exactly what ships (float16 weights)
    predict = lambda x: predict_proba(ref, x)
    langs = per_language(model, data, predict)
    newest = {}
    if "newest" in data:
        xn, yn, ln = data["newest"][:3]
        pn = p_ai(predict(xn), model["classes"])
        for lang in sorted(set(ln)):
            keep = [i for i, v in enumerate(ln) if v == lang]
            cfg = langs.get(lang, {"threshold": 0.5})
            newest[lang] = {"n": len(keep), "ai_recall": float(np.mean([pn[i] >= cfg["threshold"] for i in keep]))}
    benchmark = {"collected": now.isoformat(), "split_sizes": {k: len(v) for k, v in splits.items()}, "newest": newest,
                 "C": model["C"], "classes": model["classes"]}
    write_model(OUT_MODEL, version, model["classes"], model["weights"], model["biases"], model["temperature"],
                {k: {kk: vv for kk, vv in v.items()} for k, v in langs.items()}, benchmark)
    write_results(ROOT / "docs" / "athena-bench" / "RESULTS.md", version, langs, benchmark, stats)
    print("exported", stem, flush=True)


def write_results(path: Path, version: str, langs: dict, benchmark: dict, stats: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# athena-detect-fast {version} — Athena-Bench results", "",
             f"Trained {benchmark['collected']}. Human = permissively licensed repos checked out before 2021-06; "
             "AI = units whose lines git blame credits to AI-assisted commits (>= 95% recorded) from 2025 onward; "
             "refined = units with 30-80% of their lines blamed on AI commits. Splits are by repository; refined units are excluded from the binary metrics. "
             "The `adversarial` class is not present: no real-world source for it was found without generating data locally.", "",
             "**Read these numbers with three caveats.** (1) *Era:* the first human pool is code from before 2021-06 and the AI code is from 2025 onward, so a classifier can score well by recognising newer syntax (optional chaining, type annotations, f-strings) and small-project style rather than authorship. A second human pool (code as of 2022-06-21, Copilot's general release) narrows the gap and feeds an **era-robustness check**: a language is enabled only if its human false-positive rate on 2022-era human test units is also <= 5%. Neither pool can show that code written today by a human is classified as human; no verified-human recent code exists to test with. "
             "(2) *Few repositories:* each language's test split has only a handful of distinct repositories, so figures are noisy; the release gate therefore also requires at least 5 distinct repositories per class. "
             "(3) *Contamination:* 2022-era human code may include a little Copilot-preview-assisted code.", "",
             "Release targets per language (test split): human false-positive rate <= 5% and F1 >= 0.85. A language that misses them, or has "
             "too little data, is **disabled**: Athena then uses the labelled style heuristic for it.", "",
             "| Language | Enabled | Threshold | Test human units | Test AI units | Precision | Recall | F1 | Human FPR | 2022-era human FPR | Note |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for lang, v in sorted(langs.items()):
        t = v["test"]
        lines.append(f"| {lang} | {'yes' if v['enabled'] else 'no'} | {v['threshold']:.2f} | {t['humans']} | {t['ais']} | {t['precision']:.2f} | "
                     f"{t['recall']:.2f} | {t['f1']:.2f} | {t['fpr']:.1%} | {('%.1f%% (n=%d)' % (100 * t['late_fpr'], t['late_humans'])) if t.get('late_fpr') is not None else 'n/a (n=%d)' % t.get('late_humans', 0)} | {v['reason']} |")
    if benchmark["newest"]:
        lines += ["", "## Newest split (the most recent 20% of AI repos by commit date, held out of training)", "", "| Language | Units | AI recall |", "|---|---|---|"]
        for lang, v in sorted(benchmark["newest"].items()):
            lines.append(f"| {lang} | {v['n']} | {v['ai_recall']:.2f} |")
    lines += ["", "## Dataset sizes", "", "```json", json.dumps(stats, indent=1, sort_keys=True), "```", "",
              "Reproduce: `npm run build -w @athena/core && cd ml && uv run python -m athena_ml.collect_all all 20` (the published run used about 70 AI repos over several resumed runs; GitHub search results change, so rerunning will not reproduce these exact numbers) then `uv run python -m athena_ml.run_train " + version + "`", ""]
    path.write_text("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "0.1.0")
