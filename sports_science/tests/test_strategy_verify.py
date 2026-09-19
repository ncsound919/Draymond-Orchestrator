# sports_science/tests/test_strategy_verify.py
from sports_science.engine_registry import _synth_strategy_records
from sports_science.strategy_verify import fuzz_verdict, verify_strategy

_SIGNAL = _synth_strategy_records()


def test_verify_strategy_passes_on_real_signal():
    res = verify_strategy(_SIGNAL, min_bets=20)
    assert res["verdict"] == "passed"
    assert res["evidence_tier"] == "E2"
    assert all(res["falsifiers"].values())
    assert res["roi_ci"][0] > 0.0


def test_verify_strategy_is_deterministic():
    assert verify_strategy(_SIGNAL, min_bets=20) == verify_strategy(_SIGNAL, min_bets=20)


def test_verify_strategy_fails_on_negative_ev_noise():
    noise = [
        {"date": i, "prob": 0.5, "odds": 1.9, "won": i % 2}
        for i in range(120)
    ]
    res = verify_strategy(noise, min_bets=20)
    assert res["verdict"] == "failed"
    assert res["evidence_tier"] == "E3"
    assert res["falsifiers"]["positive_roi"] is False


def test_verify_strategy_inconclusive_when_too_few_bets():
    tiny = [{"date": i, "prob": 0.9, "odds": 2.0, "won": 1} for i in range(10)]
    res = verify_strategy(tiny, min_bets=30)
    assert res["verdict"] == "inconclusive"
    assert res["evidence_tier"] == "E4"


def test_pinned_threshold_uses_no_lookahead_path():
    # A very high pinned threshold yields few/no bets out-of-sample.
    res = verify_strategy(_SIGNAL, threshold=0.99, min_bets=20)
    assert res["falsifiers"]["enough_test_bets"] is False
    assert res["verdict"] == "failed"


def test_fuzz_verdict_is_stable_on_real_signal():
    res = fuzz_verdict(_SIGNAL, min_bets=20)
    assert res["status"] == "ok"
    assert res["stable"] is True
    assert res["evidence_tier"] == "E2"
