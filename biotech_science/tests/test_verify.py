# biotech_science/tests/test_verify.py
from biotech_science.verify import (
    bayesian_update,
    fetch_target_evidence,
    verify_claim,
    verify_hypothesis_prediction,
)


def test_bayesian_update_posterior_in_range():
    r = bayesian_update(0.5, True)
    assert 0.0 <= r["posterior"] <= 1.0
    assert r["prior"] == 0.5
    assert r["p_d_given_h"] > r["p_d_given_not_h"]


def test_bayesian_update_strong_evidence_raises_posterior():
    low = bayesian_update(0.5, True)
    high = bayesian_update(0.5, True, chembl_active_count=200, has_clinical_trials=True)
    assert high["posterior"] >= low["posterior"]


def test_bayesian_update_clamps_prior():
    r = bayesian_update(1.7, True)
    assert r["prior"] == 1.0


def test_verify_claim_true_and_false():
    ok = verify_claim("(2+3)*4", 20.0)
    assert ok["verified"] is True
    bad = verify_claim("(2+3)*4", 21.0)
    assert bad["verified"] is False


def test_verify_claim_rejects_code_injection():
    r = verify_claim("__import__('os').system('dir')", 0)
    assert r["verified"] is False
    assert r["error"]


def test_verify_claim_supports_constants():
    r = verify_claim("2*pi", 6.283185307179586, tolerance=1e-6)
    assert r["verified"] is True


def test_prediction_gate_grounded():
    h = {
        "testable_prediction": "Reduced proliferation and increased apoptosis in biopsy within 4 weeks.",
        "mechanism": "Inhibitory targeting of the dominant oncogenic driver.",
        "confidence": 0.7,
    }
    r = verify_hypothesis_prediction(h)
    assert r["grounded"] is True
    assert r["errors"] == []


def test_prediction_gate_flags_vague():
    h = {"testable_prediction": "good", "mechanism": "x", "confidence": 2.0}
    r = verify_hypothesis_prediction(h)
    assert r["grounded"] is False
    assert len(r["errors"]) >= 2


def test_fetch_target_evidence_degrades_offline():
    r = fetch_target_evidence("HER2")
    assert "chembl_active_count" in r
    assert "has_clinical_trials" in r
    assert r["evidence_tier"] in ("E1", "E3")
