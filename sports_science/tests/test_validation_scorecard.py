from sports_science.validation_scorecard import build_sports_scorecard, _status_gate


def test_status_gate_ok_when_winprob_present():
    assert _status_gate({"win_probability": {"status": "ok"}}) == "ok"


def test_status_gate_unavailable_when_nothing():
    assert _status_gate({}) == "unavailable"


def test_build_returns_typed_blocks():
    sc = build_sports_scorecard()
    assert set(sc.keys()) >= {"status", "win_probability", "market_null",
                              "bet_buddy", "verification", "summary"}
    assert sc["status"] in ("ok", "partial", "unavailable")
