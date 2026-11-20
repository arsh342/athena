from __future__ import annotations

import numpy as np

POSITIVE = ("ai", "adversarial")


def binary_metrics(y_true: list[str], p_ai: np.ndarray, threshold: float) -> dict:
    """Human vs AI(+adversarial); refined units are excluded from the binary metrics."""
    keep = [i for i, y in enumerate(y_true) if y != "refined"]
    truth = np.array([y_true[i] in POSITIVE for i in keep])
    pred = np.array([p_ai[i] >= threshold for i in keep])
    tp, fp = int((truth & pred).sum()), int((~truth & pred).sum())
    fn, tn = int((truth & ~pred).sum()), int((~truth & ~pred).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"n": len(keep), "humans": tn + fp, "ais": tp + fn, "precision": precision, "recall": recall, "f1": f1,
            "fpr": fp / (fp + tn) if fp + tn else 0.0}


def tune_threshold(y_true: list[str], p_ai: np.ndarray, max_fpr: float = 0.05, floor: float = 0.50) -> float:
    """Lowest threshold >= floor whose human false-positive rate on this data is <= max_fpr (maximises recall)."""
    best = 1.0
    for t in np.arange(floor, 1.0001, 0.01):
        if binary_metrics(y_true, p_ai, float(t))["fpr"] <= max_fpr:
            best = float(t)
            break
    return round(max(best, floor), 2)


def gate(metrics: dict, min_samples: int = 50, min_each: int = 10, max_fpr: float = 0.05, min_f1: float = 0.85,
         min_repos: int = 5, min_late: int = 20) -> tuple[bool, str]:
    if metrics["n"] < min_samples or metrics["humans"] < min_each or metrics["ais"] < min_each:
        return False, f"too little test data ({metrics['humans']} human / {metrics['ais']} ai)"
    hr, ar = metrics.get("human_repos"), metrics.get("ai_repos")
    if hr is None or ar is None or hr < min_repos or ar < min_repos:
        return False, f"too few distinct repositories in the test split ({hr} human / {ar} ai, need {min_repos} each)"
    if metrics["fpr"] > max_fpr:
        return False, f"human false-positive rate {metrics['fpr']:.1%} > {max_fpr:.0%}"
    if metrics["f1"] < min_f1:
        return False, f"F1 {metrics['f1']:.2f} < {min_f1}"
    # Era robustness: the model must not flag human code from the later (2022) era either, or it may only be recognising newer syntax.
    late_n, late_fpr = metrics.get("late_humans"), metrics.get("late_fpr")
    if late_n is None or late_n < min_late:
        return False, f"no era-robustness evidence ({late_n or 0} later-era human test units, need {min_late})"
    if late_fpr > max_fpr:
        return False, f"later-era (2022) human false-positive rate {late_fpr:.1%} > {max_fpr:.0%}"
    return True, "meets release targets"
