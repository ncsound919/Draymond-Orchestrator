HRV_BASELINE = 65.0


def _clamp01(value):
    return max(0.0, min(1.0, float(value)))


def fatigue_score(hrv, load):
    hrv_factor = max(0.0, 1.0 - hrv / HRV_BASELINE) if hrv < HRV_BASELINE else 0.0
    return _clamp01(0.6 * hrv_factor + 0.4 * max(0.0, load))


def injury_risk_percent(fatigue, acute_chronic, sleep_hrs):
    raw = fatigue * 50 + abs(acute_chronic - 1) * 30 + max(0.0, 7 - sleep_hrs) * 8
    return round(max(0.0, min(100.0, raw)), 2)


def recovery_priority(injury_risk):
    if injury_risk >= 85:
        return "critical"
    if injury_risk >= 50:
        return "elevated"
    return "normal"
