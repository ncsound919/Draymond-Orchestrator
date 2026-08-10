# biotech_science/onco_metrics.py
"""Tumor efficiency + four-factors metrics — mirror of sports_science.codex_metrics.

Converts the sports analytics core (TER, four factors, gravity, flow) onto the
oncology side: tumor cell-cycle efficiency, proliferation/clearance/angiogenesis/
metastasis balance, immune-attention gravity, and treatment-flow.

Delegates to bbtech 2 oncology_platform (TumorEfficiencyCalculator,
FourFactorsCalculator) when importable, otherwise a deterministic reference
implementation. Same input => same output.
"""
from __future__ import annotations

import os
import sys

FOUR_FACTOR_NAMES = ("proliferation", "clearance", "angiogenesis", "metastasis")

_BBTECH_PATH = os.environ.get(
    "BIOTECH_BBTECH_PATH",
    r"C:\Users\User\Downloads\Uplift\02_Pillars\Overlay Science\Shared\bb_tech_core",
)

_BBTECH_AVAILABLE = False
try:
    if _BBTECH_PATH not in sys.path:
        sys.path.insert(0, _BBTECH_PATH)
    # bb_tech_core exposes the same oncology_platform package shape as the
    # original `bbtech 2` workspace; try both import surfaces.
    try:
        from oncology_platform.analytics.ter_engine import (  # type: ignore
            TERComponents,
            TumorEfficiencyCalculator,
        )
        from oncology_platform.analytics.four_factors import (  # type: ignore
            FourFactorsCalculator,
        )
        _BBTECH_AVAILABLE = True
    except ImportError:
        from bb_tech_core.oncology_platform.analytics.ter_engine import (  # type: ignore
            TERComponents,
            TumorEfficiencyCalculator,
        )
        from bb_tech_core.oncology_platform.analytics.four_factors import (  # type: ignore
            FourFactorsCalculator,
        )
        _BBTECH_AVAILABLE = True
except Exception:  # noqa: BLE001
    _BBTECH_AVAILABLE = False

# Weights mirror bbtech's TERComponents.WEIGHTS (same double-negative
# convention as sports: `tov`/`pf` stored negative, multiplied against input).
_BBTECH_WEIGHTS = {
    "fg": 1.65,   # on-target engagement / productive division
    "tp": 2.65,   # high-leverage effector hits (3-point = potent killing)
    "ast": 0.67,  # immune-cooperative signaling
    "orb": 0.79,  # resource uptake / nutrient scavenging
    "tov": -1.04, # treatment escape / resistance
    "pf": -0.35,  # collateral damage / toxicity
}

_LEAGUE_AVERAGE_PACE = 100.0


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _clamp100(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def ter_score(
    fg: float,
    tp: float,
    ast: float,
    oreb: float,
    tov: float,
    pf: float,
    cell_cycle: float = 24.0,
) -> float:
    """Tumor Efficiency Ratio — productive division vs. resistance + toxicity.

    Mirrors the sports TER formula: weighted productive events over cell-cycle
    time, pace-normalized. `cell_cycle` is hours per division cycle.
    """
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
        except Exception:  # noqa: BLE001
            pass
    if cell_cycle == 0:
        return 0.0
    unadjusted = (
        _BBTECH_WEIGHTS["fg"] * fg
        + _BBTECH_WEIGHTS["tp"] * tp
        + _BBTECH_WEIGHTS["ast"] * ast
        + _BBTECH_WEIGHTS["orb"] * oreb
        + _BBTECH_WEIGHTS["tov"] * tov
        + _BBTECH_WEIGHTS["pf"] * pf
    )
    return unadjusted / cell_cycle * (_LEAGUE_AVERAGE_PACE / 100.0)


def four_factors(
    proliferation: float,
    clearance: float,
    angiogenesis: float,
    metastasis: float,
) -> dict[str, float]:
    """Four-factor tumor balance: proliferation, immune clearance, angiogenesis,
    metastasis. Each clamped 0-100; clearance is sigmoidal (clearance/(100+clearance))."""
    if _BBTECH_AVAILABLE:
        try:
            calc = FourFactorsCalculator()
            prol = float(calc.calculate_proliferation_score(proliferation))
            clear = float(calc.calculate_clearance_rate(apoptotic_index=clearance, division_rate=100.0))
            angio = _clamp100(angiogenesis)
            meta = _clamp100(metastasis)
        except Exception:  # noqa: BLE001
            prol = _clamp100(proliferation)
            clear = _clamp100(clearance / (100.0 + clearance) * 100.0)
            angio = _clamp100(angiogenesis)
            meta = _clamp100(metastasis)
    else:
        prol = _clamp100(proliferation)
        clear = _clamp100(clearance / (100.0 + clearance) * 100.0)
        angio = _clamp100(angiogenesis)
        meta = _clamp100(metastasis)
    return dict(zip(FOUR_FACTOR_NAMES, (prol, clear, angio, meta)))


def tumor_gravity(immune_attention: float, tumor_spacing: float) -> float:
    """Immune-attention gravity — how much the tumor draws immune resources."""
    return _clamp01(0.6 * immune_attention + 0.4 * tumor_spacing)


def tumor_flow(treatment_tempo: float, response_quality: float) -> float:
    """Treatment flow — pace of intervention x quality of response."""
    return max(0.0, treatment_tempo) * max(0.0, response_quality)


def compute_onco_metrics(
    proliferation: float,
    clearance: float,
    angiogenesis: float,
    metastasis: float,
    fg: float = 0.0,
    tp: float = 0.0,
    ast: float = 0.0,
    oreb: float = 0.0,
    tov: float = 0.0,
    pf: float = 0.0,
    cell_cycle: float = 24.0,
    immune_attention: float = 0.5,
    tumor_spacing: float = 0.5,
    treatment_tempo: float = 0.5,
    response_quality: float = 0.5,
) -> dict[str, float]:
    """One-call convenience: full onco metric set from raw tumor/patient inputs."""
    ter = ter_score(fg, tp, ast, oreb, tov, pf, cell_cycle)
    factors = four_factors(proliferation, clearance, angiogenesis, metastasis)
    gravity = tumor_gravity(immune_attention, tumor_spacing)
    flow = tumor_flow(treatment_tempo, response_quality)
    return {
        "ter": ter,
        "four_factors": factors,
        "tumor_gravity": gravity,
        "tumor_flow": flow,
        "evidence_tier": "E1",
    }
