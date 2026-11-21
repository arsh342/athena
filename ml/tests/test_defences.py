import json
from datetime import datetime, timedelta, timezone

import numpy as np

from athena_ml.defences import apply_defences, cap_per_install, corroborated, drop_outliers, recalibrate_threshold, release_allowed
from athena_ml.ingest_contributions import main as ingest_main, schema_ok

NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)
rng = np.random.default_rng(0)


def row(install, label="ai", source="git-recorded", language="python", style=None, p_ai=0.8, day=0):
    style = list(style) if style is not None else list(rng.normal(1.0, 0.05, 35))
    rec = {"label": label, "labelSource": source, "language": language, "sizeBucket": 30, "style": style,
           "probabilities": {"ai": p_ai}, "modelVersions": {"fast": "0.2.1"}, "tuned": False, "installId": install, "cliVersion": "0.4.4"}
    return {"record": rec, "received_at": (NOW + timedelta(days=day)).isoformat()}


def inst(n):
    return f"{n:032x}"


def test_trusted_sources_count_fully():
    out = apply_defences([row(inst(1), source="git-recorded"), row(inst(2), source="pre-2021")])
    assert [r["weight"] for r in out.records] == [1.0, 1.0]


def test_a_user_correction_without_three_agreeing_installs_weighs_nothing():
    style = [1.0] * 35
    alone = apply_defences([row(inst(1), source="user-correction", style=style)])
    assert alone.records == []
    assert alone.dropped["user correction without 3 agreeing installs"] == 1
    two = apply_defences([row(inst(i), source="user-correction", style=style) for i in (1, 2)])
    assert two.records == []


def test_three_installs_agreeing_make_a_correction_count_at_a_quarter():
    style = [1.0] * 35
    out = apply_defences([row(inst(i), source="user-correction", style=style) for i in (1, 2, 3)])
    assert [r["weight"] for r in out.records] == [0.25, 0.25, 0.25]


def test_agreement_needs_different_installs_the_same_label_and_a_similar_style():
    style = [1.0] * 35
    same_install = [row(inst(1), source="user-correction", style=style) for _ in range(5)]
    assert apply_defences(same_install).records == [], "five records from one install are one voice"
    other_label = [row(inst(1), "ai", "user-correction", style=style), row(inst(2), "human", "user-correction", style=style), row(inst(3), "human", "user-correction", style=style)]
    assert corroborated(other_label, other_label[0]) is False
    different_style = [row(inst(1), source="user-correction", style=[1.0] * 35), row(inst(2), source="user-correction", style=[(-1.0) ** i for i in range(35)]), row(inst(3), source="user-correction", style=[(-1.0) ** i for i in range(35)])]
    assert corroborated(different_style, different_style[0]) is False


def test_an_install_is_capped_and_cannot_crowd_out_others():
    flood = [row(inst(1), day=i / 1000) for i in range(2500)]
    other = [row(inst(2)) for _ in range(10)]
    kept, dropped = cap_per_install(flood + other)
    assert dropped == 500
    assert sum(1 for r in kept if r["record"]["installId"] == inst(1)) == 2000
    assert sum(1 for r in kept if r["record"]["installId"] == inst(2)) == 10


def test_the_cap_is_per_window_so_an_install_can_contribute_again_later():
    early = [row(inst(1), day=0) for _ in range(2000)]
    later = [row(inst(1), day=40) for _ in range(5)]
    kept, dropped = cap_per_install(early + later)
    assert dropped == 0 and len(kept) == 2005


def test_outliers_are_dropped_from_their_label_and_language_group():
    normal = [row(inst(i % 5 + 1), style=rng.normal(1.0, 0.05, 35)) for i in range(60)]
    poison = row(inst(9), style=[50.0] * 35)
    kept, dropped = drop_outliers(normal + [poison])
    assert dropped >= 1
    assert all(r["record"]["installId"] != inst(9) for r in kept)
    small, d2 = drop_outliers([poison] + normal[:5])
    assert d2 == 0, "a group too small to judge is left alone"


def test_an_unknown_label_source_is_never_trusted():
    assert apply_defences([row(inst(1), source="somebody-said-so")]).records == []


def test_recalibration_uses_weights_and_needs_enough_data():
    humans = [{"record": row(inst(i % 3 + 1), "human", p_ai=p)["record"], "weight": 1.0} for i, p in enumerate(np.linspace(0.0, 0.99, 100))]
    ais = [{"record": row(inst(1), "ai", p_ai=0.9)["record"], "weight": 1.0} for _ in range(60)]
    t = recalibrate_threshold(humans + ais, "python")
    assert t is not None and 0.9 <= t <= 0.99
    assert recalibrate_threshold(humans[:10] + ais[:10], "python") is None


def test_release_is_refused_when_the_benchmark_regresses():
    before = {"javascript": {"f1": 0.94, "fpr": 0.03, "recall": 0.91}, "typescript": {"f1": 0.86, "fpr": 0.043, "recall": 0.76}}
    ok, why = release_allowed(before, before)
    assert ok and not why
    worse_recall = {**before, "javascript": {"f1": 0.94, "fpr": 0.03, "recall": 0.85}}
    assert release_allowed(before, worse_recall)[0] is False
    over_fpr = {**before, "typescript": {"f1": 0.9, "fpr": 0.07, "recall": 0.8}}
    ok, why = release_allowed(before, over_fpr)
    assert not ok and "typescript" in why[0]
    missing = {"javascript": before["javascript"]}
    assert release_allowed(before, missing)[0] is False


def test_ingestion_discards_bad_records_and_writes_weighted_ones(tmp_path):
    good = row(inst(1))
    bad_extra = row(inst(2)); bad_extra["record"]["code"] = "secret()"
    src = tmp_path / "in.jsonl"
    src.write_text("\n".join([json.dumps(good), json.dumps(bad_extra), "not json"]) + "\n")
    dst = tmp_path / "out.jsonl"
    ingest_main([str(src), str(dst)])
    out = [json.loads(l) for l in dst.read_text().splitlines()]
    assert len(out) == 1 and out[0]["weight"] == 1.0
    assert schema_ok(good["record"]) and not schema_ok(bad_extra["record"])
