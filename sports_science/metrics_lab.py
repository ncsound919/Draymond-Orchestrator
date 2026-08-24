# sports_science/metrics_lab.py
"""bbtech Metrics Lab: NEW deterministic composite statistics over session profiles.

Derived stats feed the trends engine alongside raw metrics. Every public result
carries a provenance_record (validation_engine) and an evidence_tier; inputs
that are insufficient yield a structured E4 unavailable result instead of a
fabricated number. Pure standard library, no LLM, no network, seeded-free.

Session profile shapes follow the ingest/run_metrics conventions:
  {"sport": ..., "ter": float, "four_factors": {proliferation, clearance,
   resource, metastasis}, "gravity": float, "flow": float,
   "performance": {"court_spacing": float}, "baseline_form": float,
   "archetype": str, "domain": "sports"|"biotech", "evidence_tier": "E1".."E4",
   "generated_at"/"timestamp": iso-str}
Missing keys are handled honestly (they shrink inputs_used or trigger E4).
"""
from __future__ import annotations

import math
from typing import Any

from sports_science.validation_engine import provenance_record

CODE_VERSION = "metrics_lab-1.0.0"
PRECISION = 6

# Evidence-tier trust weights used by evidence-weighted composites.
TIER_WEIGHTS = {"E1": 1.0, "E2": 0.75, "E3": 0.5, "E4": 0.25}


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _round(value: float) -> float:
    return round(float(value), PRECISION)


def _tier_weight(tier: Any) -> float:
    key = str(tier or "").upper()
    return TIER_WEIGHTS.get(key, TIER_WEIGHTS["E3"])


def _ordered(profiles: list[dict]) -> list[dict]:
    """Profiles sorted by their timestamp field; input order breaks ties so
    timestamp-less sessions remain deterministic."""
    indexed = list(enumerate(profiles))

    def key(pair: tuple[int, Any]) -> tuple[str, int]:
        idx, p = pair
        ts = ""
        if isinstance(p, dict):
            ts = str(p.get("generated_at") or p.get("timestamp") or "")
        return (ts, idx)

    return [p for _, p in sorted(indexed, key=key)]


def _is_biotech(profile: dict) -> bool:
    return str(profile.get("domain", "")).lower() == "biotech"


def _minmax(series: list[float]) -> list[float]:
    lo, hi = min(series), max(series)
    if hi == lo:
        return [0.5] * len(series)
    return [(v - lo) / (hi - lo) for v in series]


def _four_factor_mean(profile: dict) -> float | None:
    factors = profile.get("four_factors")
    if not isinstance(factors, dict):
        return None
    values = [float(v) for v in factors.values() if _is_number(v)]
    return sum(values) / len(values) if values else None


def _result(
    name: str,
    engine: str,
    profiles: list[dict],
    params: dict[str, Any],
    value: Any,
    unit: str | None,
    inputs_used: list[str],
    tier: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "value": value,
        "unit": unit,
        "inputs_used": inputs_used,
        "evidence_tier": tier,
        "provenance": provenance_record(
            engine, {"profiles": profiles}, params, CODE_VERSION
        ),
    }


def _unavailable(name: str, engine: str, profiles: list[dict], reason: str) -> dict[str, Any]:
    result = _result(name, engine, profiles, {}, None, None, [], "E4")
    result["status"] = "unavailable"
    result["reason"] = reason
    return result


def translation_delta_index(profiles: list[dict]) -> dict[str, Any]:
    """Normalized 0..1 divergence between basketball-side and biotech-side TER
    trajectories across sessions (0 = identical trajectories, 1 = maximal).
    """
    engine = "translation_delta_index"
    if not isinstance(profiles, list) or not profiles:
        return _unavailable(engine, engine, [], "no session profiles provided")
    sports_series: list[float] = []
    biotech_series: list[float] = []
    for profile in _ordered([p for p in profiles if isinstance(p, dict)]):
        ter = profile.get("ter")
        if not _is_number(ter):
            continue
        target = biotech_series if _is_biotech(profile) else sports_series
        target.append(float(ter))
    if len(sports_series) < 2 or len(biotech_series) < 2:
        return _unavailable(
            engine,
            engine,
            profiles,
            f"need >= 2 TER points per side; got sports={len(sports_series)}, "
            f"biotech={len(biotech_series)}",
        )
    norm_sports = _minmax(sports_series)
    norm_biotech = _minmax(biotech_series)
    n = min(len(norm_sports), len(norm_biotech))
    divergence = sum(abs(norm_sports[i] - norm_biotech[i]) for i in range(n)) / n
    return _result(
        engine,
        engine,
        profiles,
        {"precision": PRECISION},
        _round(divergence),
        "index",
        ["ter", "domain", "generated_at"],
        "E2" if n >= 3 else "E3",
    )


def cross_domain_momentum(profiles: list[dict]) -> dict[str, Any]:
    """Evidence-weighted velocity of the TER/four-factor lab composite across
    chronologically ordered sessions. Positive slope = improving momentum,
    negative slope = declining momentum (labeled in `direction`)."""
    engine = "cross_domain_momentum"
    if not isinstance(profiles, list) or not profiles:
        return _unavailable(engine, engine, [], "no session profiles provided")
    ordered = [p for p in _ordered([p for p in profiles if isinstance(p, dict)])]
    ters = [float(p["ter"]) for p in ordered if _is_number(p.get("ter"))]
    ff_means = [m for m in (_four_factor_mean(p) for p in ordered) if m is not None]
    if len(ordered) < 2 or (not ters and not ff_means):
        return _unavailable(
            engine,
            engine,
            profiles,
            "need >= 2 sessions carrying ter and/or four_factors",
        )
    ter_ids = [id(p) for p in ordered if _is_number(p.get("ter"))]
    norm_ter = dict(zip(ter_ids, _minmax(ters))) if ters else {}
    ff_profiles = [id(p) for p in ordered if _four_factor_mean(p) is not None]
    norm_ff = dict(zip(ff_profiles, _minmax(ff_means))) if ff_means else {}
    composites: list[float] = []
    weights: list[float] = []
    for profile in ordered:
        components = []
        if id(profile) in norm_ter:
            components.append(norm_ter[id(profile)])
        if id(profile) in norm_ff:
            components.append(norm_ff[id(profile)])
        if components:
            composites.append(sum(components) / len(components))
            weights.append(_tier_weight(profile.get("evidence_tier")))
    if len(composites) < 2:
        return _unavailable(
            engine, engine, profiles, "fewer than 2 sessions yielded a composite"
        )
    t_bar = sum(range(len(composites))) / len(composites)
    c_bar = sum(c * w for c, w in zip(composites, weights)) / sum(weights)
    num = sum(
        w * (t - t_bar) * (c - c_bar)
        for t, (c, w) in enumerate(zip(composites, weights))
    )
    den = sum(w * (t - t_bar) ** 2 for t, w in enumerate(weights))
    slope = num / den if den else 0.0
    eps = 1e-9
    direction = "positive" if slope > eps else ("negative" if slope < -eps else "flat")
    result = _result(
        engine,
        engine,
        profiles,
        {"precision": PRECISION, "direction": direction},
        _round(slope),
        "index/session",
        ["ter", "four_factors", "evidence_tier", "generated_at"],
        "E2" if len(composites) >= 3 else "E3",
    )
    result["direction"] = direction
    return result


def _pressure_components(profile: dict) -> list[tuple[float, float]]:
    """(component_value, weight) pairs: gravity 0.5, flow 0.3, spatial 0.2."""
    components: list[tuple[float, float]] = []
    gravity = profile.get("gravity")
    flow = profile.get("flow")
    performance = profile.get("performance") if isinstance(profile.get("performance"), dict) else {}
    spatial = performance.get("court_spacing", profile.get("court_spacing"))
    if _is_number(gravity):
        components.append((float(gravity), 0.5))
    if _is_number(flow):
        components.append((float(flow), 0.3))
    if _is_number(spatial):
        components.append((float(spatial), 0.2))
    return components


def archetype_pressure_score(profiles: list[dict]) -> dict[str, Any]:
    """Gravity/flow/spatial pressure composite aggregated per archetype.
    `value` maps archetype -> score; missing components drop out with their
    weight removed from the denominator."""
    engine = "archetype_pressure_score"
    if not isinstance(profiles, list) or not profiles:
        return _unavailable(engine, engine, [], "no session profiles provided")
    grouped: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        components = _pressure_components(profile)
        if not components:
            continue
        weight_sum = sum(w for _, w in components)
        score = sum(v * w for v, w in components) / weight_sum
        archetype = str(profile.get("archetype", "unknown"))
        grouped.setdefault(archetype, []).append(score)
        counts[archetype] = counts.get(archetype, 0) + 1
    if not grouped:
        return _unavailable(
            engine, engine, profiles, "no profiles carry gravity/flow/spatial inputs"
        )
    per_archetype = {
        archetype: _round(sum(scores) / len(scores))
        for archetype, scores in sorted(grouped.items())
    }
    deep_enough = any(count >= 2 for count in counts.values())
    return _result(
        engine,
        engine,
        profiles,
        {"precision": PRECISION, "weights": {"gravity": 0.5, "flow": 0.3, "spatial": 0.2}},
        per_archetype,
        "score",
        ["gravity", "flow", "court_spacing", "archetype"],
        "E2" if deep_enough else "E3",
    )


def evidence_weighted_form(profiles: list[dict]) -> dict[str, Any]:
    """Performance form index weighted by each contributing input's evidence
    tier (E1=1.0, E2=0.75, E3=0.5, E4=0.25). Form prefers the clinical
    baseline_form input and falls back to the gravity/flow mean."""
    engine = "evidence_weighted_form"
    if not isinstance(profiles, list) or not profiles:
        return _unavailable(engine, engine, [], "no session profiles provided")
    forms: list[float] = []
    weights: list[float] = []
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        baseline = profile.get("baseline_form")
        if _is_number(baseline):
            form = float(baseline)
        else:
            gravity = profile.get("gravity")
            flow = profile.get("flow")
            parts = [float(v) for v in (gravity, flow) if _is_number(v)]
            if not parts:
                continue
            form = sum(parts) / len(parts)
        forms.append(form)
        weights.append(_tier_weight(profile.get("evidence_tier")))
    if not forms:
        return _unavailable(
            engine, engine, profiles, "no profiles carry baseline_form/gravity/flow inputs"
        )
    value = sum(f * w for f, w in zip(forms, weights)) / sum(weights)
    all_measured = all(
        str(p.get("evidence_tier", "E3")).upper() in ("E1", "E2")
        for p in profiles
        if isinstance(p, dict)
        and (_is_number(p.get("baseline_form")) or _is_number(p.get("gravity")) or _is_number(p.get("flow")))
    )
    return _result(
        engine,
        engine,
        profiles,
        {"precision": PRECISION, "tier_weights": TIER_WEIGHTS},
        _round(value),
        "index",
        ["baseline_form", "gravity", "flow", "evidence_tier"],
        "E2" if (len(forms) >= 2 and all_measured) else "E3",
    )


METRICS = (
    translation_delta_index,
    cross_domain_momentum,
    archetype_pressure_score,
    evidence_weighted_form,
)


def derive_all(profiles: list[dict]) -> list[dict[str, Any]]:
    """Run every lab metric over the profile list, in fixed order."""
    return [metric(profiles) for metric in METRICS]
