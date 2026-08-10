# sports_science/tests/test_reproducibility.py
import hashlib
import json
from sports_science.run_metrics import compute_metrics_from_json


def test_same_input_same_output(tmp_path):
    sample = tmp_path / "s.json"
    sample.write_text(json.dumps({
        "sport": "football",
        "performance": {"fg": 60.0, "tp": 50.0, "ast": 40.0, "oreb": 30.0, "tov": -10.0, "pf": -5.0},
        "biometrics": {"hrv": 60.0, "load": 0.6, "acute_chronic": 1.0, "sleep_hrs": 7.5},
    }))
    a = compute_metrics_from_json(sample)
    b = compute_metrics_from_json(sample)
    assert a == b
    digest = hashlib.sha256(json.dumps(a, sort_keys=True).encode()).hexdigest()
    assert len(digest) == 64
