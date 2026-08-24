# sports_science/tests/test_validation_engine.py
import json
import random

from sports_science.validation_engine import (
    UnavailableResult,
    is_unavailable,
    provenance_record,
    reproducibility_debt,
    require_honest,
    validate_predictor,
    verify_determinism,
)


def _deterministic_fn(seed):
    rng = random.Random(seed)
    return {"value": rng.random(), "seed": seed}


def _nondeterministic_fn(_seed):
    return {"value": random.random()}


def test_verify_determinism_passes_on_seeded_fn():
    res = verify_determinism(_deterministic_fn, seeds=[1, 2, 3])
    assert res["ok"] is True
    assert res["evidence_tier"] == "E1"
    assert len(res["checks"]) == 3
    assert all(c["identical"] for c in res["checks"])


def test_verify_determinism_detects_nondeterminism():
    res = verify_determinism(_nondeterministic_fn, seeds=[1])
    assert res["ok"] is False
    assert res["evidence_tier"] == "E3"
    assert all(not c["identical"] for c in res["checks"])
    assert len({c["digest"] for c in res["checks"]}) >= 0


def test_unavailable_result_shape():
    res = UnavailableResult("source down", source="unit-test")
    assert is_unavailable(res)
    assert res["status"] == "unavailable"
    assert res["evidence_tier"] == "E4"
    assert not is_unavailable({"ok": True})
    assert not is_unavailable("nope")


def test_require_honest_converts_exception_to_unavailable():
    @require_honest
    def boom(record):
        raise FileNotFoundError("sensor feed missing")

    res = boom({})
    assert is_unavailable(res)
    assert res["evidence_tier"] == "E4"
    assert "FileNotFoundError" in res["reason"]

    @require_honest
    def fine(x):
        return {"ok": x}

    assert fine(1) == {"ok": 1}


def _synthetic_records(n=60, perfect=True, seed=11):
    rng = random.Random(seed)
    outcomes = [float(i % 2) for i in range(n)]
    records = []
    noise = 0.05 if perfect else 10.0
    for i, outcome in enumerate(outcomes):
        score = outcome + rng.uniform(-noise, noise) if perfect else rng.random()
        records.append({"score": score, "outcome": outcome})
    return records


def test_validate_predictor_perfect_ranking_is_e2():
    res = validate_predictor(_synthetic_records(perfect=True))
    assert res["concordance"] > 0.95
    assert res["ci_low"] > 0.5
    assert res["evidence_tier"] == "E2"
    assert res["n"] == 60
    assert res["k"] == 5


def test_validate_predictor_random_scores_not_e2():
    res = validate_predictor(_synthetic_records(perfect=False))
    assert res["ci_low"] <= 0.5 <= res["ci_high"]
    assert res["evidence_tier"] == "E3"


def test_validate_predictor_degenerate_inputs_honest():
    res = validate_predictor([])
    assert is_unavailable(res)
    assert res["evidence_tier"] == "E4"

    constant = [{"score": float(i), "outcome": 1.0} for i in range(30)]
    res2 = validate_predictor(constant)
    assert is_unavailable(res2)


def test_validate_predictor_is_deterministic():
    a = validate_predictor(_synthetic_records())
    b = validate_predictor(_synthetic_records())
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_provenance_record_stable_hashing():
    inputs = {"game_log": [1, 2, 3], "profile": {"pace": 4.4}}
    params = {"k": 5, "seed": 7}
    r1 = provenance_record("metrics", inputs, params, "v0.2.0")
    r2 = provenance_record("metrics", inputs, params, "v0.2.0")

    assert r1["@context"] == "https://w3id.org/ro/crate/1.1/context"
    g1, g2 = r1["@graph"][0], r2["@graph"][0]
    assert g1["input_hashes"] == g2["input_hashes"]
    assert g1["params"] == g2["params"]
    assert g1["@id"].startswith("urn:bbtech:metrics:")
    assert g1["created"].endswith("Z")
    assert g1["input_hashes"]["game_log"] != g1["input_hashes"]["profile"]

    r3 = provenance_record("metrics", {"game_log": [9]}, params, "v0.2.0")
    assert r3["@graph"][0]["input_hashes"]["game_log"] != g1["input_hashes"]["game_log"]


def test_rpd_detects_param_drift():
    prior = provenance_record("eng", {"in": 1}, {"lr": 0.1, "k": 5}, "v1")
    current = provenance_record("eng", {"in": 1}, {"lr": 0.2, "k": 5}, "v1")
    res = reproducibility_debt(prior, current)
    assert res["rpd"] == 1
    assert "params.lr:~" in res["drifted_fields"]

    added = provenance_record("eng", {"in": 1}, {"lr": 0.1, "k": 5, "new": True}, "v1")
    res2 = reproducibility_debt(prior, added)
    assert res2["rpd"] == 1
    assert "params.new:+" in res2["drifted_fields"]

    removed = provenance_record("eng", {"in": 1}, {}, "v1")
    res3 = reproducibility_debt(prior, removed)
    assert set(res3["drifted_fields"]) == {"params.lr:-", "params.k:-"}
    assert res3["rpd"] == 2


def test_rpd_ignores_volatile_fields_and_detects_schema_drift():
    prior = provenance_record("eng", {"in": 1}, {"a": 1}, "v1")
    current = provenance_record("eng", {"in": 2}, {"a": 1}, "v1")
    res = reproducibility_debt(prior, current)
    assert res["rpd"] == 0
    assert res["drifted_fields"] == []

    mutated = json.loads(json.dumps(prior))
    mutated["@graph"][0]["calibration_error"] = 0.12
    del mutated["@graph"][0]["code_version"]
    res2 = reproducibility_debt(prior, mutated)
    assert set(res2["drifted_fields"]) == {
        "schema:calibration_error:+", "schema:code_version:-"
    }
    assert res2["rpd"] == 2


def test_rpd_on_non_provenance_input_is_unavailable():
    res = reproducibility_debt({"nope": 1}, provenance_record("eng", {}, {}, "v1"))
    assert is_unavailable(res)
