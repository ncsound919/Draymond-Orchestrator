# sports_science/tests/test_manifest.py
import pytest

from sports_science import manifest
from sports_science.validation_engine import sha256_of


def test_inputs_hash_is_deterministic():
    a = manifest.build_engine_manifest("ewma", "1.0.0", {"values": [1.0, 2.0]}, 0)
    b = manifest.build_engine_manifest("ewma", "1.0.0", {"values": [1.0, 2.0]}, 0)
    assert a["inputsHash"] == b["inputsHash"] == sha256_of({"values": [1.0, 2.0]})


def test_manifest_hash_is_sha256_hex():
    m = manifest.build_engine_manifest("beta_posterior", "1.0.0", {"successes": 1.0}, 7)
    assert len(m["manifestHash"]) == 64
    assert len(m["inputsHash"]) == 64


def test_manifest_for_registered_engine_uses_registry_version():
    m = manifest.manifest_for("ter_score", {"fg": 1.0}, 0)
    assert m["engine"] == "ter_score"
    assert m["engineVersion"] == "1.0.0"


def test_manifest_for_unknown_engine_raises():
    with pytest.raises(KeyError):
        manifest.manifest_for("does_not_exist", {}, 0)
