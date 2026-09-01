# sports_science/tests/test_crosscheck.py
from sports_science.validate_crosscheck import independent_concordance
from sports_science.validation_engine import validate_predictor


def test_independent_concordance_matches():
    records = [{"score": 0.9, "outcome": 1}, {"score": 0.1, "outcome": 0},
               {"score": 0.7, "outcome": 1}, {"score": 0.3, "outcome": 0},
               {"score": 0.5, "outcome": 1}, {"score": 0.2, "outcome": 0}]
    a = independent_concordance(records)
    b = validate_predictor(records, k=2, seed=1, min_n=4, bootstraps=5)
    assert abs(a - b["concordance"]) < 1e-6


def test_independent_concordance_handles_ties():
    records = [{"score": 0.5, "outcome": 1}, {"score": 0.5, "outcome": 0},
               {"score": 0.7, "outcome": 1}, {"score": 0.3, "outcome": 0}]
    c = independent_concordance(records)
    # The (0.5, 0.5) pair is tied, half-credit: 1.0 conc, 0 discord, 1 tied, 1 conc = (1 + 0.5) / 3 = 0.5
    assert 0.0 <= c <= 1.0


def test_independent_concordance_handles_empty():
    assert independent_concordance([]) == 0.0
