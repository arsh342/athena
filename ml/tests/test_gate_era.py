from athena_ml.evaluate import gate

BASE = {"n": 400, "humans": 200, "ais": 200, "fpr": 0.02, "f1": 0.92, "human_repos": 8, "ai_repos": 8}


def test_passes_when_every_check_holds():
    ok, reason = gate({**BASE, "late_humans": 60, "late_fpr": 0.03})
    assert ok, reason


def test_fails_without_enough_later_era_human_data():
    ok, reason = gate({**BASE, "late_humans": 5, "late_fpr": 0.0})
    assert not ok and "era-robustness evidence" in reason
    ok, reason = gate(dict(BASE))
    assert not ok and "era-robustness evidence" in reason


def test_fails_when_later_era_human_code_is_flagged():
    ok, reason = gate({**BASE, "late_humans": 80, "late_fpr": 0.18})
    assert not ok and "2022" in reason


def test_earlier_checks_still_come_first():
    ok, reason = gate({**BASE, "f1": 0.7, "late_humans": 80, "late_fpr": 0.0})
    assert not ok and "F1" in reason
