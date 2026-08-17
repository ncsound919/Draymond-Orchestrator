# biotech_science/tests/test_chemlab.py
from biotech_science.chemlab import compute_risk, morgan_fingerprint, suggest_analogues


def test_morgan_fingerprint_deterministic_and_bounded():
    a = morgan_fingerprint("CCO")
    b = morgan_fingerprint("CCO")
    assert a == b
    assert len(a) == 128
    assert all(x in (0, 1) for x in a)
    assert sum(a) > 0


def test_morgan_fingerprint_invalid_smiles_is_zero():
    fp = morgan_fingerprint("not-a-smiles!!!")
    assert sum(fp) == 0


def test_compute_risk_valid_smiles():
    r = compute_risk("CC(=O)Oc1ccccc1C(=O)O")
    assert r["valid"] is True
    assert 0.0 <= r["posterior_risk"] <= 1.0
    assert len(r["confidence95"]) == 2
    assert r["confidence95"][0] <= r["confidence95"][1]
    assert isinstance(r["dominant_features"], list)
    assert r["flagged"] in (True, False)
    assert r["evidence_tier"] == "E2"


def test_compute_risk_deterministic():
    assert compute_risk("CCO") == compute_risk("CCO")


def test_compute_risk_invalid_smiles():
    r = compute_risk("")
    assert r["valid"] is False
    assert r["posterior_risk"] is None
    assert r["evidence_tier"] == "E3"


def test_suggest_analogues_self_is_top():
    r = suggest_analogues("CC(=O)Oc1ccccc1C(=O)O", k=3)
    assert r["analogues"][0]["name"] == "aspirin"
    assert r["analogues"][0]["similarity"] == 1.0
    assert len(r["analogues"]) <= 3


def test_suggest_analogues_invalid():
    r = suggest_analogues("###")
    assert r["analogues"] == []
    assert "error" in r
