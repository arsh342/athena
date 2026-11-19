from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.optimize import minimize_scalar
from sklearn.linear_model import LogisticRegression

from .evaluate import binary_metrics, gate, tune_threshold
from .export_fast import softmax

CLASSES = ["human", "ai", "refined", "adversarial"]


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    def nll(t: float) -> float:
        p = softmax(logits / t)
        return float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1)).mean())
    return float(minimize_scalar(nll, bounds=(0.25, 8.0), method="bounded").x)


def train(x_train: sparse.spmatrix, y_train: list[str], x_dev: sparse.spmatrix, y_dev: list[str],
          c_grid: tuple[float, ...] = (0.5, 2.0, 8.0)) -> dict:
    classes = [c for c in CLASSES if c in set(y_train)]
    idx = {c: i for i, c in enumerate(classes)}
    yt = np.array([idx[y] for y in y_train])
    dev_keep = [i for i, y in enumerate(y_dev) if y in idx]
    yd = np.array([idx[y_dev[i]] for i in dev_keep])
    xd = x_dev[dev_keep]
    best = None
    for c in c_grid:
        model = LogisticRegression(C=c, max_iter=300, solver="lbfgs")
        model.fit(x_train, yt)
        p = model.predict_proba(xd)
        loss = float(-np.log(np.clip(p[np.arange(len(yd)), yd], 1e-12, 1)).mean())
        if best is None or loss < best[0]:
            best = (loss, c, model)
    _, c, model = best
    weights = np.zeros((len(classes), x_train.shape[1]))
    biases = np.zeros(len(classes))
    if len(classes) == 2:  # sklearn stores one row for binary problems
        weights[1], weights[0] = model.coef_[0], -model.coef_[0]
        biases[1], biases[0] = model.intercept_[0], -model.intercept_[0]
    else:
        weights[:], biases[:] = model.coef_, model.intercept_
    logits = np.asarray(xd @ weights.T) + biases
    return {"classes": classes, "weights": weights, "biases": biases, "C": c,
            "temperature": fit_temperature(logits, yd)}


def p_ai(probs: np.ndarray, classes: list[str]) -> np.ndarray:
    return sum(probs[:, i] for i, c in enumerate(classes) if c in ("ai", "adversarial"))


def per_language(model: dict, data: dict[str, tuple[sparse.spmatrix, list[str], list[str]]], predict) -> dict:
    """data[split] = (x, labels, languages, repos). Thresholds are tuned on dev, release gate is applied on test."""
    languages = sorted(set(data["dev"][2]) | set(data["test"][2]))
    out = {}
    for lang in languages:
        def sel(split: str):
            x, y, l = data[split][:3]
            keep = [i for i, v in enumerate(l) if v == lang]
            return (x[keep], [y[i] for i in keep]) if keep else (None, [])
        xd, yd = sel("dev")
        xt, yt = sel("test")
        threshold = tune_threshold(yd, p_ai(predict(xd), model["classes"])) if xd is not None and len(yd) else 0.5
        test_metrics = binary_metrics(yt, p_ai(predict(xt), model["classes"]), threshold) if xt is not None else \
            {"n": 0, "humans": 0, "ais": 0, "precision": 0, "recall": 0, "f1": 0, "fpr": 0}
        test_repos = data["test"][3] if len(data["test"]) > 3 else None
        if test_repos is not None:
            idx = [i for i, v in enumerate(data["test"][2]) if v == lang]
            test_metrics["human_repos"] = len({test_repos[i] for i in idx if data["test"][1][i] == "human"})
            test_metrics["ai_repos"] = len({test_repos[i] for i in idx if data["test"][1][i] in ("ai", "adversarial")})
        enabled, reason = gate(test_metrics)
        out[lang] = {"enabled": enabled, "threshold": threshold, "reason": reason, "test": test_metrics}
    return out
