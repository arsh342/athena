"""Re-score a saved student on the logit scale: per-language threshold = lowest logit giving dev human FPR <= 5%, applied unchanged to test."""
import json, sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np, torch
from sklearn.metrics import roc_auc_score
from transformers import AutoTokenizer
from .run_train import load_rows
from .split import assign
from .student import Student
from .teacher import TEACHER_DIR
from .train_student import batches, POS

def logits(model, rows, tok, max_len):
    model.eval(); out = np.zeros(len(rows))
    with torch.no_grad():
        for b, ids, mask, _ in batches(rows, tok, 64, max_len, "mps", False, None):
            out[b] = model(ids, mask).float().cpu().numpy()
    return out

def main(path, max_len=512):
    splits = assign(load_rows(), datetime.now(timezone.utc))
    tok = AutoTokenizer.from_pretrained(str(TEACHER_DIR))
    model = Student().to("mps"); model.load_state_dict(torch.load(Path(path) / "student.pt", weights_only=True))
    data = {}
    for name in ("dev", "test"):
        rows = [r for r in splits[name] if r["label"] != "refined"]
        data[name] = (rows, logits(model, rows, tok, max_len))
    res = {}
    print("lang   n_test  AUC   thr(logit)  recall  F1    FPR   | dev FPR")
    for lang in sorted({r["language"] for r in data["test"][0]}):
        def sel(name):
            rows, z = data[name]; ix = [i for i, r in enumerate(rows) if r["language"] == lang]
            return np.array([rows[i]["label"] in POS for i in ix]), z[ix]
        yd, zd = sel("dev"); yt, zt = sel("test")
        if min(yd.sum(), (~yd).sum(), yt.sum(), (~yt).sum()) < 10: continue
        cands = np.sort(np.unique(zd[~yd]))
        thr = next((t for t in np.append(cands, cands[-1] + 1e-3) if (zd[~yd] >= t).mean() <= 0.05), cands[-1] + 1e-3)
        pred = zt >= thr; tp = (pred & yt).sum(); fp = (pred & ~yt).sum()
        prec = tp / max(tp + fp, 1); rec = tp / yt.sum(); f1 = 2 * prec * rec / max(prec + rec, 1e-9)
        res[lang] = dict(n=int(len(yt)), auc=float(roc_auc_score(yt, zt)), thr=float(thr), recall=float(rec), f1=float(f1), fpr=float(fp / (~yt).sum()), dev_fpr=float((zd[~yd] >= thr).mean()))
        r = res[lang]; print(f"{lang:9} {r['n']:5} {r['auc']:.3f} {r['thr']:9.2f}  {r['recall']:.2f}  {r['f1']:.2f}  {r['fpr']:.3f} | {r['dev_fpr']:.3f}")
    (Path(path) / "metrics-logit.json").write_text(json.dumps(res, indent=1))

main(sys.argv[1])
