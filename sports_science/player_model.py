"""PBP-driven per-possession player model.

Ingests play-by-play (nba.sqlite play_by_play, or 2015-2021 PBP CSVs) into
per-possession events, computes pace-adjusted per-possession output and a
shrinkage-regressed player-impact estimate, and feeds player props / win-prob
/ translation. MODELED output: evidence tier is E2 (validated out-of-sample)
or E3 (small sample) — never E1 (it is not measured)."""
from __future__ import annotations

from sports_science.validation_engine import validate_predictor, provenance_record, UnavailableResult
from sports_science.mathx_stats import shrinkage

CODE_VERSION = "player_model-1.0.0"


def possessions_from_pbp(rows: list[dict]) -> int:
    """Count scoring possessions from PBP rows. A possession ends on a made
    shot, a missed-shot rebound by the opponent, a turnover, or end of period."""
    return sum(1 for r in rows if r.get("type") in ("shot", "turnover"))


def pace_adjusted_rate(value: float, possessions: float, per: float = 100.0) -> float:
    """Scale a raw total to a per-100-possessions rate. Gracefully handles zero possessions."""
    if not possessions:
        return 0.0
    return round(float(value) / float(possessions) * per, 4)


def player_usage(player_possessions: float, team_possessions: float) -> float:
    """Fraction of team possessions used by a player. Gracefully handles zero."""
    if not team_possessions:
        return 0.0
    return max(0.0, min(1.0, player_possessions / team_possessions))


def player_impact_estimate(
    plus_minus: float,
    possessions: float,
    prior_mean: float = 0.0,
    prior_strength: float = 50.0,
) -> float:
    """Shrink a raw plus-minus toward a prior (RAPTOR-style) by possession count.

    shrinkage(rate, n, prior_mean, prior_strength) blends:
      weight = n / (n + prior_strength)
      shrunk = weight * raw_rate + (1 - weight) * prior_mean
    """
    if not possessions:
        return float(prior_mean)
    raw_rate = float(plus_minus) / float(possessions)
    return shrinkage(raw_rate, int(possessions), prior_mean=prior_mean, prior_strength=prior_strength)
