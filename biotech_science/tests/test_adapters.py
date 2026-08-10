# biotech_science/tests/test_adapters.py
from biotech_science.adapters.mathx import (
    MathXAdapter,
    verify_derivation,
    run_monte_carlo_est,
)
from biotech_science.adapters.biotech_ide import BiotechIdeAdapter
from biotech_science.adapters.colabfold import ColabFoldAdapter
from biotech_science.adapters.moleculargraph import MolecularGraphAdapter


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
    adapter = MathXAdapter(base_url="http://localhost:9")
    result = adapter.call("/verify", {"a": "x"})
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_biotech_ide_adapter_degrades_to_e3_when_unreachable():
    adapter = BiotechIdeAdapter(base_url="http://localhost:9")
    result = adapter.translate("FG_PCT")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_colabfold_adapter_degrades_to_e3_when_unreachable():
    adapter = ColabFoldAdapter(base_url="http://localhost:9")
    result = adapter.predict("MKTAY")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]


def test_moleculargraph_adapter_degrades_to_e3_when_unreachable():
    adapter = MolecularGraphAdapter(base_url="http://localhost:9")
    result = adapter.descriptors("CCO")
    assert result["evidence_tier"] == "E3"
    assert result["data"]["error"]
