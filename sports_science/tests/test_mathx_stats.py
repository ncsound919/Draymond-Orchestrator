# tests/test_mathx_stats.py — mirrors Draymond tests/mathx/stats.test.ts
"""Hand-computed values identical to the TypeScript suite so the Python port
stays mathematically identical to the Draymond mathx core."""

import math

import pytest

from sports_science.mathx_stats import (
    beta_posterior,
    cusum,
    ewma,
    inverse_regularized_incomplete_beta,
    normal_cdf,
    percentile,
    regularized_incomplete_beta,
    shrinkage,
    sigmoid,
)


def test_percentile_interpolates_r7():
    assert percentile([1, 2, 3, 4], 0.5) == pytest.approx(2.5, abs=1e-10)
    assert percentile([1, 2, 3, 4], 0.25) == pytest.approx(1.75, abs=1e-10)


def test_percentile_endpoints():
    assert percentile([1, 2, 3, 4], 0) == 1
    assert percentile([1, 2, 3, 4], 1) == 4


def test_percentile_empty_and_single():
    assert percentile([], 0.5) == 0
    assert percentile([5], 0.5) == 5


def test_percentile_clamps():
    assert percentile([1, 2, 3, 4], -1) == 1
    assert percentile([1, 2, 3, 4], 2) == 4


def test_reg_incomplete_beta_cdf():
    assert regularized_incomplete_beta(0, 2, 3) == 0
    assert regularized_incomplete_beta(1, 2, 3) == 1
    assert regularized_incomplete_beta(0.5, 1, 1) == pytest.approx(0.5, abs=1e-10)
    assert regularized_incomplete_beta(0.2, 1, 1) == pytest.approx(0.2, abs=1e-10)


def test_reg_incomplete_beta_rejects_bad_shapes():
    with pytest.raises(ValueError):
        regularized_incomplete_beta(0.5, 0, 1)


def test_inverse_beta_uniform():
    assert inverse_regularized_incomplete_beta(0.025, 1, 1) == pytest.approx(0.025, abs=1e-10)
    assert inverse_regularized_incomplete_beta(0.5, 1, 1) == pytest.approx(0.5, abs=1e-10)
    assert inverse_regularized_incomplete_beta(0.975, 1, 1) == pytest.approx(0.975, abs=1e-10)


def test_inverse_beta_symmetric():
    lo = inverse_regularized_incomplete_beta(0.025, 11, 11)
    hi = inverse_regularized_incomplete_beta(0.975, 11, 11)
    assert lo == pytest.approx(1 - hi, abs=1e-8)


def test_inverse_beta_roundtrip():
    for p in (0.1, 0.3, 0.5, 0.7, 0.9):
        q = inverse_regularized_incomplete_beta(p, 4, 7)
        assert regularized_incomplete_beta(q, 4, 7) == pytest.approx(p, abs=1e-8)


def test_beta_posterior_hand_computed():
    post = beta_posterior(9, 1, 1, 1)  # Beta(10, 2)
    assert post["alpha"] == 10
    assert post["beta"] == 2
    assert post["mean"] == pytest.approx(10 / 12, abs=1e-6)
    assert post["sd"] == pytest.approx(math.sqrt((10 * 2) / (144 * 13)), abs=1e-6)
    assert 0 < post["ci_low"] < post["mean"] < post["ci_high"] < 1


def test_beta_posterior_uniform_prior():
    post = beta_posterior(0, 0, 1, 1)
    assert post["mean"] == pytest.approx(0.5, abs=1e-10)
    assert post["ci_low"] == pytest.approx(0.025, abs=1e-8)
    assert post["ci_high"] == pytest.approx(0.975, abs=1e-8)


def test_beta_posterior_symmetric():
    post = beta_posterior(10, 10, 1, 1)
    assert post["mean"] == pytest.approx(0.5, abs=1e-10)
    assert post["ci_low"] == pytest.approx(1 - post["ci_high"], abs=1e-8)


def test_beta_posterior_width_tiny_vs_large():
    small = beta_posterior(1, 0, 1, 1)
    large = beta_posterior(100, 0, 1, 1)
    assert small["width"] > large["width"]


def test_beta_posterior_thin_evidence_shrinks():
    post = beta_posterior(1, 0, 1, 1)  # 1-for-1 must not report 1.0
    assert post["mean"] == pytest.approx(2 / 3, abs=1e-10)
    assert post["mean"] < 1


def test_shrinkage_hand_computed():
    assert shrinkage(1, 2, 0.75, 5) == pytest.approx((5 * 0.75 + 2) / 7, abs=1e-10)


def test_shrinkage_zero_samples():
    assert shrinkage(0.8, 0, 0.75, 5) == pytest.approx(0.75, abs=1e-10)


def test_shrinkage_grows_with_n():
    assert shrinkage(1, 1000, 0.5, 5) > 0.99


def test_shrinkage_zero_strength_zero_samples():
    assert shrinkage(0.4, 0, 0.5, 0) == 0.4


def test_ewma_empty():
    r = ewma([])
    assert r["series"] == []
    assert r["last"] is None


def test_ewma_lambda_one():
    r = ewma([10, 20], 1)
    assert r["series"] == [10, 20]
    assert r["last"] == 20


def test_ewma_hand_computed():
    r = ewma([1, 2, 3], 0.5)
    assert r["series"] == [1, 1.5, 2.25]
    assert r["last"] == pytest.approx(2.25, abs=1e-10)


def test_ewma_halflife():
    assert ewma([1], 0.5)["halflife"] == pytest.approx(1, abs=1e-10)


def test_cusum_no_alarms():
    r = cusum([10, 10, 10, 10], target=10)
    assert r["alarms"] == []
    assert r["last_high"] == 0
    assert r["last_low"] == 0


def test_cusum_ignores_subthreshold():
    r = cusum([1, 1, 1, 1], target=0, sigma=1, k=0.5, h=5)
    assert r["alarms"] == []
    assert r["last_high"] == pytest.approx(2, abs=1e-10)


def test_cusum_alarms_high():
    r = cusum([3, 3, 3], target=0, sigma=1, k=0.5, h=5)
    assert len(r["alarms"]) == 1
    assert r["alarms"][0]["index"] == 2
    assert r["alarms"][0]["direction"] == "high"
    assert r["alarms"][0]["magnitude"] > 5


def test_cusum_alarms_low():
    r = cusum([-3, -3, -3], target=0, sigma=1, k=0.5, h=5)
    assert len(r["alarms"]) == 1
    assert r["alarms"][0]["direction"] == "low"


def test_normal_cdf():
    assert normal_cdf(0) == pytest.approx(0.5, abs=1e-6)
    assert normal_cdf(1.96) == pytest.approx(0.975, abs=1e-4)
    assert normal_cdf(-1.96) == pytest.approx(0.025, abs=1e-4)
    assert normal_cdf(2.576) == pytest.approx(0.995, abs=1e-3)


def test_sigmoid():
    assert sigmoid(0) == 0.5
    assert sigmoid(1) == pytest.approx(1 / (1 + math.exp(-1)), abs=1e-10)
    assert sigmoid(1000) == pytest.approx(1, abs=1e-6)
    assert sigmoid(-1000) == pytest.approx(0, abs=1e-6)
    assert sigmoid(-2) < sigmoid(0) < sigmoid(2)