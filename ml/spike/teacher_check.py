import json, random, time, sys
from pathlib import Path
import numpy as np, torch
from athena_ml.teacher import load_teacher, label
from athena_ml.evaluate import binary_metrics

random.seed(7)
raw = Path("data/raw")
def read(p, n):
    rows = []
    for l in open(p):
        try: rows.append(json.loads(l))
        except json.JSONDecodeError: pass
    if not rows: return []
    random.shuffle(rows); return rows[:n]
human = [r for p in sorted(raw.glob("human-*.jsonl")) for r in read(p, 60)]
ai = read(raw / "ai.jsonl", 1000)
human = human[:1000]
units = [(r["code"], "human") for r in human] + [(r["code"], "ai") for r in ai]
t = time.time()
m, tok = load_teacher()
print("loaded", round(time.time() - t, 1), "s", flush=True)
t = time.time()
logits = label(m, tok, [c for c, _ in units])
dt = time.time() - t
print(f"labelled {len(units)} in {dt:.0f}s ({dt / len(units) * 1000:.0f} ms/unit)")
p_ai = 1 - torch.softmax(logits, -1)[:, 0].numpy()
y = [l for _, l in units]
for th in (0.5, 0.7, 0.9):
    print(th, {k: round(v, 3) for k, v in binary_metrics(y, p_ai, th).items() if k in ("precision", "recall", "f1", "fpr")})
