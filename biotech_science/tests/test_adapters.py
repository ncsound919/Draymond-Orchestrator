# biotech_science/tests/test_adapters.py
from biotech_science.adapters.mathx import (
    MathXAdapter,
    verify_derivation,
    run_monte_carlo_est,
)
from biotech_science.adapters.biotech_ide import BiotechIdeAdapter
from biotech_science.adapters.colabfold import ColabFoldAdapter
from biotech_science.adapters.moleculargraph import MolecularGraphAdapter
from biotech_science.adapters.blackmind import BlackMindAdapter
from biotech_science.adapters.cureforge import CureForgeAdapter
from biotech_science.adapters.chemlab import ChemlabAdapter


def test_verify_derivation_simple_identity():
    result = verify_derivation("2*x + 3*x", "5*x")
    assert result["verified"] is True


def test_verify_derivation_mismatch_is_not_verified():
    result = verify_derivation("x", "x*x")
    assert result["verified"] is False


def test_run_monte_carlo_est_same_seed_is_deterministic():
    first = run_monte_carlo_est(seed=7, n=1000, fn="x")
    second = run_monte_carlo_est(seed=7, n=1000, fn="x")
    assert first["mean"] == second["mean"]
    assert first["std"] == second["std"]


def test_mathx_adapter_degrades_to_e3_when_unreachable():
    adapter = MathXAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.call("/verify", {"a": "x"})
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_biotech_ide_adapter_degrades_to_e3_when_unreachable():
    adapter = BiotechIdeAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.translate("FG_PCT")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_colabfold_adapter_degrades_to_e3_when_unreachable():
    adapter = ColabFoldAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.predict("MKTAY")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_moleculargraph_adapter_degrades_to_e3_when_unreachable():
    adapter = MolecularGraphAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.descriptors("CCO")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_blackmind_adapter_falls_back_to_local_hypothesis_when_unreachable():
    adapter = BlackMindAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.hypothesize("lung cancer", "EGFR", "")
    assert result["evidence_tier"] == "E3"
    assert result["hypothesis"]["target"] == "EGFR"
    assert "proposed_intervention" in result["hypothesis"]


def test_cureforge_adapter_falls_back_to_local_bayes_when_unreachable():
    adapter = CureForgeAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.bayes_evidence("HER2", 0.5)
    assert "posterior" in result["evidence"]
    assert 0.0 <= result["evidence"]["posterior"] <= 1.0


def test_chemlab_adapter_falls_back_to_local_risk_when_unreachable():
    adapter = ChemlabAdapter(base_url="http://127.0.0.1:59999")
    result = adapter.risk("CCO")
    assert result["evidence_tier"] == "E2"
    assert result["risk"]["valid"] is True
    assert result["risk"]["posterior_risk"] is not None


