# sports_science/tests/test_injury_risk.py
from sports_science.injury_risk import (
    fatigue_score,
    injury_risk_percent,
    recovery_priority,
    HRV_BASELINE,
)


def test_fatigue_increases_with_load_and_low_hrv():
    low = fatigue_score(hrv=HRV_BASELINE, load=0.5)
    high = fatigue_score(hrv=HRV_BASELINE * 0.7, load=0.9)
    assert high > low


def test_injury_risk_bounds():
    assert 0.0 <= injury_risk_percent(fatigue=0.8, acute_chronic=1.5, sleep_hrs=6.0) <= 100.0


def test_recovery_priority_ranges():
    assert recovery_priority(injury_risk=92.0) == "critical"
    assert recovery_priority(injury_risk=60.0) == "elevated"
    assert recovery_priority(injury_risk=25.0) == "normal"
