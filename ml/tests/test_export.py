import numpy as np
from scipy import sparse

from athena_ml.evaluate import binary_metrics, gate, tune_threshold
from athena_ml.export_fast import load_model, predict_proba, write_model
from athena_ml.features_io import N_FEATURES
from athena_ml.train_fast import per_language, train


def synthetic(n, rng, shift):
    x = rng.normal(0, 0.05, size=(n, N_FEATURES)) * (rng.random((n, N_FEATURES)) < 0.0005)
    dense = rng.normal(shift, 0.3, size=(n, 3))
    x[:, -9:-6] = dense
    return sparse.csr_matrix(x)


def test_export_reload_reproduces_probabilities_from_float16(tmp_path):
    rng = np.random.default_rng(0)
    xs = sparse.vstack([synthetic(80, rng, 0.0), synthetic(80, rng, 1.5)]).tocsr()
    ys = ["human"] * 80 + ["ai"] * 80
    m = train(xs, ys, xs, ys, c_grid=(1.0,))
    stem = write_model(tmp_path, "t1", m["classes"], m["weights"], m["biases"], m["temperature"], {}, {})
    assert (tmp_path / "athena-detect-fast-t1.bin").stat().st_size == len(m["classes"]) * N_FEATURES * 2 + len(m["classes"]) * 4
    loaded = load_model(stem)
    probs = predict_proba(loaded, xs[:20])
    exact = predict_proba({**loaded, "W": m["weights"], "b": m["biases"]}, xs[:20])
    assert np.allclose(probs.sum(axis=1), 1.0)
    assert np.abs(probs - exact).max() < 5e-3  # float16 rounding only
    # reloading twice is bit-identical (the reference the TypeScript parity test uses)
    assert np.array_equal(probs, predict_proba(load_model(stem), xs[:20]))


def test_language_with_too_little_test_data_is_gated_off():
    tiny = {"n": 20, "humans": 10, "ais": 10, "precision": 1.0, "recall": 1.0, "f1": 1.0, "fpr": 0.0}
    ok, reason = gate(tiny)
    assert not ok and "too little" in reason
    big = {"n": 400, "humans": 200, "ais": 200, "precision": 0.9, "recall": 0.9, "f1": 0.9, "fpr": 0.04, "human_repos": 9, "ai_repos": 9}
    assert gate(big)[0]
    assert not gate({**big, "fpr": 0.08})[0]
    assert not gate({**big, "f1": 0.7})[0]


def test_thresholds_never_below_half_and_hold_the_fpr_budget():
    rng = np.random.default_rng(1)
    y = ["human"] * 200 + ["ai"] * 200
    p = np.concatenate([rng.beta(2, 5, 200), rng.beta(5, 2, 200)])
    t = tune_threshold(y, p)
    assert t >= 0.5
    assert binary_metrics(y, p, t)["fpr"] <= 0.05
    assert tune_threshold(y, np.full(400, 0.1)) >= 0.5


def test_per_language_applies_gate_on_test_split():
    rng = np.random.default_rng(2)
    def split(n_h, n_a, lang):
        x = sparse.vstack([synthetic(n_h, rng, 0.0), synthetic(n_a, rng, 1.5)]).tocsr()
        repos = [f"{lang}-h{i % 6}" for i in range(n_h)] + [f"{lang}-a{i % 6}" for i in range(n_a)]
        return x, ["human"] * n_h + ["ai"] * n_a, [lang] * (n_h + n_a), repos
    train_x, train_y = split(150, 150, "python")[:2]
    m = train(train_x, train_y, train_x, train_y, c_grid=(1.0,))
    py, rs = split(100, 100, "python"), split(8, 8, "rust")
    both = lambda i: (sparse.vstack([py[i], rs[i]]).tocsr() if i == 0 else py[i] + rs[i])
    data = {s: (both(0), both(1), both(2), both(3)) for s in ("dev", "test")}
    w = {"W": m["weights"], "b": m["biases"], "temperature": m["temperature"]}
    out = per_language(m, data, lambda x: predict_proba(w, x))
    assert out["python"]["enabled"] is True
    assert out["rust"]["enabled"] is False and "too little" in out["rust"]["reason"]


def test_gate_needs_enough_distinct_repos_per_class():
    from athena_ml.evaluate import gate
    strong = {"n": 400, "humans": 200, "ais": 200, "precision": 0.95, "recall": 0.95, "f1": 0.95, "fpr": 0.02}
    ok, _ = gate({**strong, "human_repos": 8, "ai_repos": 7})
    assert ok
    ok, reason = gate({**strong, "human_repos": 1, "ai_repos": 7})
    assert not ok and "repositories" in reason
    ok, reason = gate({**strong, "human_repos": 8, "ai_repos": 1})
    assert not ok and "repositories" in reason
    assert not gate(strong)[0]  # unknown repo counts never pass
