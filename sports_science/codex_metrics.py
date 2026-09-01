import sys
from pathlib import Path

_BBTECH_PATH = str(Path(__file__).resolve().parent.parent / "bbtech 2")

_BBTECH_AVAILABLE = False
try:
    if _BBTECH_PATH not in sys.path:
        sys.path.insert(0, _BBTECH_PATH)
    from oncology_platform.analytics.four_factors import FourFactorsCalculator
    from oncology_platform.analytics.ter_engine import (
        TERComponents,
        TumorEfficiencyCalculator,
    )

    _BBTECH_AVAILABLE = True
except ImportError:
    _BBTECH_AVAILABLE = False

FOUR_FACTOR_NAMES = ("proliferation", "clearance", "resource", "metastasis")

# Weights mirror bbtech 2's TERComponents.WEIGHTS. Note the double-negative
# convention: `tov`/`pf` are stored as negative weights and multiplied against
# the raw input, so a *positive* turnover/foul input yields a *negative* score
# contribution (a liability), while the aggression test feeds negative inputs
# to represent absence of those liabilities. Keep the sign convention exactly
# as-is so the fallback and bbtech paths stay identical.
_BBTECH_WEIGHTS = {
    "fg": 1.65,
    "tp": 2.65,
    "ast": 0.67,
    "orb": 0.79,
    "tov": -1.04,
    "pf": -0.35,
}

_LEAGUE_AVERAGE_PACE = 100.0


def _clamp01(value):
    return max(0.0, min(1.0, float(value)))


def _clamp100(value):
    return max(0.0, min(100.0, float(value)))


def ter_score(fg, tp, ast, oreb, tov, pf, cell_cycle=24.0):
    if _BBTECH_AVAILABLE:
        try:
            components = TERComponents(
                field_goals=fg,
                three_pointers=tp,
                assists=ast,
                offensive_rebounds=oreb,
                turnovers=tov,
                personal_fouls=pf,
            )
            return float(TumorEfficiencyCalculator().calculate_ter(components, cell_cycle_time=cell_cycle))
        except Exception:
            pass
    # Reference fallback mirrors bbtech 2's exact formula (same weights and
    # double-negative convention) so both paths agree: 1.65*fg + 2.65*tp +
    # 0.67*ast + 0.79*oreb - 1.04*tov - 0.35*pf, /cell_cycle, * pace/100.
    if cell_cycle == 0:
        return 0.0
    unadjusted = (_BBTECH_WEIGHTS["fg"] * fg + _BBTECH_WEIGHTS["tp"] * tp
                  + _BBTECH_WEIGHTS["ast"] * ast
                  + _BBTECH_WEIGHTS["orb"] * oreb + _BBTECH_WEIGHTS["tov"] * tov
                  + _BBTECH_WEIGHTS["pf"] * pf)
    return unadjusted / cell_cycle * (_LEAGUE_AVERAGE_PACE / 100.0)


def four_factors(proliferation, clearance, resource, metastasis):
    if _BBTECH_AVAILABLE:
        try:
            calc = FourFactorsCalculator()
            prol = float(calc.calculate_proliferation_score(proliferation))
            clear = float(calc.calculate_clearance_rate(apoptotic_index=clearance, division_rate=100.0))
            res = _clamp100(resource)
            meta = _clamp100(metastasis)
        except Exception:
            prol = _clamp100(proliferation)
            clear = _clamp100(clearance / (100.0 + clearance) * 100)
            res = _clamp100(resource)
            meta = _clamp100(metastasis)
    else:
        prol = _clamp100(proliferation)
        clear = _clamp100(clearance / (100.0 + clearance) * 100)
        res = _clamp100(resource)
        meta = _clamp100(metastasis)
    return dict(zip(FOUR_FACTOR_NAMES, (prol, clear, res, meta)))


def four_factors_from_performance(p):
    """Derive the four-factor ANALOGY values from a raw NBA performance dict.

    bbtech maps a basketball profile onto an oncology four-factor model as a
    TRANSLATION (see bbtech 2 analytics/four_factors.py): shooting -> proliferation,
    turnover/foul control -> clearance, spacing/rebounding -> resource
    (angiogenesis), errors -> metastasis. The mapping is deterministic and
    monotonic in the real inputs, but the scaling constants are hand-chosen to
    land raw stat lines on a 0-100 axis. This is an ANALOGY, not a biological
    measurement — downstream consumers label it E3-analogy, never E1 biology.
    """
    fg = _clamp100(float(p.get("fg", 50.0)))
    tp = _clamp100(float(p.get("tp", 0.0)))
    oreb = max(0.0, float(p.get("oreb", 0.0)))
    tov = max(0.0, -float(p.get("tov", 0.0)))  # profile stores liabilities negative
    pf = max(0.0, -float(p.get("pf", 0.0)))
    da = _clamp01(float(p.get("defensive_attention", 0.5)))
    spacing = _clamp01(float(p.get("court_spacing", 0.5)))

    proliferation = _clamp100(0.7 * fg + 0.3 * tp)                       # shooting -> growth
    turnover_eff = 1.0 - min(1.0, tov / 5.0)
    clearance = _clamp100(0.6 * 100.0 * da + 0.4 * 100.0 * turnover_eff - pf * 3.0)  # clean defensive control -> immune clearance
    resource = _clamp100(100.0 * (0.5 * spacing + 0.5 * min(1.0, oreb / 8.0)))      # spacing + rebounding -> supply access
    metastasis = _clamp100(10.0 + 15.0 * min(1.0, tov / 4.0) + 8.0 * min(1.0, pf / 4.0))  # errors -> spread/leakage
    return dict(zip(FOUR_FACTOR_NAMES, (proliferation, clearance, resource, metastasis)))


def gravity_index(defensive_attention, court_spacing):
    return _clamp01(0.6 * defensive_attention + 0.4 * court_spacing)


def flow_index(tempo, possession_quality):
    return max(0.0, tempo) * max(0.0, possession_quality)
