"""
Train the student directly on Athena's hard labels (git-recorded AI vs pre-2021 / later-era human code). No teacher.
  python -m athena_ml.train_student --train-units 40000 --epochs 1 --max-len 256 --out data/student/pilot
"""
from __future__ import annotations

import argparse, json, random, time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import roc_auc_score
from transformers import AutoTokenizer

from .evaluate import binary_metrics, tune_threshold
from .run_train import load_rows
from .split import assign
from .student import Student
from .teacher import TEACHER_DIR

POS = ("ai", "adversarial")


def batches(rows, tok, bs, max_len, device, shuffle, rng):
    idx = list(range(len(rows)))
    if shuffle:
        rng.shuffle(idx)
        chunks = [sorted(idx[i:i + bs * 50], key=lambda j: len(rows[j]["code"])) for i in range(0, len(idx), bs * 50)]
        order = [c[k:k + bs] for c in chunks for k in range(0, len(c), bs)]
        rng.shuffle(order)
    else:
        idx.sort(key=lambda j: len(rows[j]["code"]))
        order = [idx[k:k + bs] for k in range(0, len(idx), bs)]
    for b in order:
        enc = tok([rows[j]["code"] for j in b], truncation=True, max_length=max_len, padding=True, return_tensors="pt")
        y = torch.tensor([1.0 if rows[j]["label"] in POS else 0.0 for j in b])
        yield b, enc["input_ids"].to(device), enc["attention_mask"].to(device), y.to(device)


@torch.no_grad()
def predict(model, rows, tok, max_len, device):
    model.eval()
    out = np.zeros(len(rows))
    for b, ids, mask, _ in batches(rows, tok, 64, max_len, device, False, None):
        out[b] = torch.sigmoid(model(ids, mask)).float().cpu().numpy()
    return out


def evaluate(model, rows, tok, max_len, device, label, thresholds=None):
    rows = [r for r in rows if r["label"] != "refined"]
    p = predict(model, rows, tok, max_len, device)
    y = [r["label"] for r in rows]
    res = {"all": {"auc": float(roc_auc_score([v in POS for v in y], p)), **binary_metrics(y, p, 0.5)}}
    by = defaultdict(list)
    for i, r in enumerate(rows):
        by[r["language"]].append(i)
    for lang, ix in sorted(by.items()):
        yy = [y[i] for i in ix]
        if len({v in POS for v in yy}) < 2 or len(ix) < 40:
            continue
        pp = p[ix]
        thr = tune_threshold(yy, pp) if thresholds is None else thresholds.get(lang, 0.5)
        res[lang] = {"n": len(ix), "auc": float(roc_auc_score([v in POS for v in yy], pp)), "thr": thr, **binary_metrics(yy, pp, thr)}
    print(f"[{label}]", {k: {m: round(v[m], 3) for m in ("auc", "f1", "fpr") if m in v} | ({"n": v["n"]} if "n" in v else {}) for k, v in res.items()}, flush=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-units", type=int, default=40000)
    ap.add_argument("--epochs", type=float, default=1)
    ap.add_argument("--max-len", type=int, default=256)
    ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--out", default="data/student/pilot")
    a = ap.parse_args()
    rng = random.Random(1); torch.manual_seed(1)
    device = "mps"
    splits = assign(load_rows(), datetime.now(timezone.utc))
    train = [r for r in splits["train"] if r["label"] != "refined"]
    hum = [r for r in train if r["label"] == "human"]; ai = [r for r in train if r["label"] != "human"]
    n = min(a.train_units // 2, len(hum), len(ai))  # balanced classes
    rng.shuffle(hum); rng.shuffle(ai)
    train = hum[:n] + ai[:n]
    print({k: len(v) for k, v in splits.items()}, "training on", len(train), flush=True)
    tok = AutoTokenizer.from_pretrained(str(TEACHER_DIR))
    model = Student().to(device)
    print("params (M):", round(sum(p.numel() for p in model.parameters()) / 1e6, 1), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    steps = int(a.epochs * len(train) / a.bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.1)
    step, t0 = 0, time.time()
    while step < steps:
        model.train()
        for _, ids, mask, y in batches(train, tok, a.bs, a.max_len, device, True, rng):
            loss = F.binary_cross_entropy_with_logits(model(ids, mask), y)
            opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
            step += 1
            if step % 50 == 0:
                print(f"step {step}/{steps} loss {loss.item():.3f} {step * a.bs / (time.time() - t0):.0f} units/s", flush=True)
            if step >= steps:
                break
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "student.pt")
    dev = evaluate(model, splits["dev"], tok, a.max_len, device, "dev")
    thr = {k: v["thr"] for k, v in dev.items() if "thr" in v}  # thresholds are tuned on dev only and applied unchanged to test
    res = {"dev": dev, "thresholds": thr, "test": evaluate(model, splits["test"], tok, a.max_len, device, "test", thr)}
    (out / "metrics.json").write_text(json.dumps(res, indent=1))
    print("done in", round((time.time() - t0) / 60, 1), "min")


if __name__ == "__main__":
    main()
