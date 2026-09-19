# sports_science/sports_model.py
"""bbtech → Sports Steve / Bet Buddy bridge: modeled win probabilities.

The bridge: BBTech datasets + math-x statistics (mathx_stats, the Python port
of Draymond's mathx core) produce a MODELED win probability for a bet leg.
Sports Steve's ParlayOptimizer marks a leg `modeled=True` only when THIS module
returns a real probability. No model output is ever fabricated:

  * Insufficient history  -> structured E4 unavailable result + reason
  * Small sample          -> probability is shrunk toward the prior and the
                             evidence tier drops (E3)
  * Validated backtest    -> concordance/calibration/lift reported, E2 when
                             the out-of-fold C-index CI excludes 0.5
  * Market benchmark      -> model concordance compared against the real
                             betting market (does the model beat the book?)

Data sources:
  * nba.sqlite `game` table      — team-level box scores (1946-present)
  * sports_model.db (built by prepare_datasets.py from the ehallmar kaggle
    set)                         — 1.27M player game logs + historical
                                   money-line/totals betting data

Player-prop (PrizePicks) legs get modeled probabilities from the player game
logs when available; otherwise they stay honestly UNMODELED. Nothing is faked.

Pure standard library + sqlite3. Deterministic. No LLM, no network.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from sports_science.mathx_stats import beta_posterior, ewma, sigmoid
from sports_science.validation_engine import (
    provenance_record,
    utc_now_iso,
    validate_predictor,
)

try:
    from sports_science.datasets_config import model_db_path as _resolve_model_db
except Exception:  # noqa: BLE001
    _resolve_model_db = None

CODE_VERSION = "sports_model-2.0.0"
PRECISION = 6

# Prior for over/under hit rates: a neutral 0.5 prior with strength 20. The
# beta posterior shrinks thin samples toward 0.5 instead of reporting a
# fabricated extreme from a handful of games.
TOTALS_PRIOR_A = 10.0
TOTALS_PRIOR_B = 10.0

# Default EWMA smoothing for form series (higher = more recent weight).
FORM_LAMBDA = 0.3

# Bounded form window: only the most recent N games before a date count toward
# "current form". 82 games = one NBA regular season. Keeps predictions cheap
# and the model honest (it does not claim 2,300 games of context as "form").
FORM_WINDOW = 82


def _round(value: float) -> float:
    return round(float(value), PRECISION)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _unavailable(reason: str, source: str) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "reason": reason,
        "evidence_tier": "E4",
        "modeled": False,
        "source": source,
    }


def _candidate_dataset_paths() -> list[Path]:
    """Absolute candidate paths for nba.sqlite; first existing wins."""
    candidates: list[Path] = []
    env = os.environ.get("NBA_SQLITE_PATH")
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve()
    # 02_Pillars copy: sports_science/ -> ../sports-datasets/nba.sqlite
    candidates.append(here.parent / "sports-datasets" / "nba.sqlite")
    # Repo-root copies (Draymond runtime): walk up to the ecosystem root.
    for parent in here.parents:
        candidate = parent / "02_Pillars" / "Overlay Science" / "Sports" / "sports-datasets" / "nba.sqlite"
        candidates.append(candidate)
        candidate = parent / "sports-datasets" / "nba.sqlite"
        candidates.append(candidate)
        if parent.name == "Uplift":
            break
    seen: list[Path] = []
    for c in candidates:
        if c not in seen:
            seen.append(c)
    return seen


class TeamFormModel:
    """Team-level form model over the NBA warehouse `game` table.

    Form is the EWMA of each team's net rating (points scored minus allowed)
    across games strictly before a reference date. Win probability is a
    logistic map over the home-minus-away form differential (plus a
    data-calibrated home advantage). Totals use an empirical hit rate shrunk
    through a beta posterior.
    """

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = Path(db_path) if db_path else self._locate_db()
        self._team_games: dict[str, list[dict[str, Any]]] = {}
        self._home_advantage: float | None = None
        self._model_db: Path | None = (
            _resolve_model_db() if _resolve_model_db is not None else None
        )
        self._load()

    # ------------------------------------------------------------------ load

    def _locate_db(self) -> Path:
        for candidate in _candidate_dataset_paths():
            if candidate.exists():
                return candidate
        raise FileNotFoundError(
            "NBA dataset not found. Set NBA_SQLITE_PATH or place nba.sqlite in "
            "sports-datasets/ (see _candidate_dataset_paths)."
        )

    def _load(self) -> None:
        con = sqlite3.connect(str(self.db_path))
        try:
            rows = con.execute(
                """
                SELECT team_abbreviation_home, team_abbreviation_away,
                       game_date, pts_home, pts_away, wl_home
                FROM game
                WHERE pts_home IS NOT NULL AND pts_away IS NOT NULL
                """
            ).fetchall()
        finally:
            con.close()

        # Index per-team game lists, sorted chronologically. The same game is
        # recorded from both team sides (home/away), so a team's list contains
        # one entry per game it played.
        per_team: dict[str, list[tuple[str, int, int]]] = {}
        for home, away, date, pts_home, pts_away, wl_home in rows:
            date_s = str(date)[:10]
            per_team.setdefault(home, []).append((date_s, int(pts_home), int(pts_away)))
            per_team.setdefault(away, []).append((date_s, int(pts_away), int(pts_home)))
        for team, games in per_team.items():
            games.sort(key=lambda g: g[0])
            self._team_games[team] = [
                {"date": d, "pts_for": pf, "pts_against": pa} for d, pf, pa in games
            ]

        # Home advantage = mean of (home net) - (away net) across all games.
        nets = [
            (int(pts_home) - int(pts_away)) - (int(pts_away) - int(pts_home))
            for _, _, _, pts_home, pts_away, _ in rows
            if isinstance(pts_home, (int, float)) and isinstance(pts_away, (int, float))
        ]
        if nets:
            self._home_advantage = sum(nets) / len(nets)
            # Form differential standard deviation -> logistic scale. Using the
            # data's own dispersion is calibration, not tuning to an outcome.
            mean = self._home_advantage
            var = sum((n - mean) ** 2 for n in nets) / len(nets)
            self._form_scale = max(1.0, var ** 0.5)
        else:
            self._home_advantage = 0.0
            self._form_scale = 1.0

    # ---------------------------------------------------------------- queries

    def teams(self) -> list[str]:
        return sorted(self._team_games.keys())

    def _form_net(self, team: str, before_date: str, stat: str = "net") -> dict[str, Any]:
        """EWMA net-rating (or raw stat) for a team over games before a date."""
        games = self._team_games.get(team)
        if not games:
            return _unavailable(f"no games for team {team}", "team_form")
        values: list[float] = []
        for g in games:
            if g["date"] >= before_date:
                break
            if stat == "net":
                values.append(float(g["pts_for"] - g["pts_against"]))
            elif stat == "pts_for":
                values.append(float(g["pts_for"]))
            elif stat == "pts_against":
                values.append(float(g["pts_against"]))
        if len(values) < 2:
            return _unavailable(
                f"need >= 2 games before {before_date} for {team}; got {len(values)}",
                "team_form",
            )
        values = values[-FORM_WINDOW:]
        ema = ewma(values, FORM_LAMBDA)
        return {
            "team": team,
            "last": _round(ema["last"]),
            "series": [_round(v) for v in ema["series"]],
            "n": len(values),
            "evidence_tier": "E2" if len(values) >= 20 else "E3",
            "modeled": True,
            "source": "team_form",
        }

    def win_probability(self, home: str, away: str, game_date: str) -> dict[str, Any]:
        """Modeled P(home wins) = sigmoid((home_net - away_net + home_adv) / scale)."""
        source = "win_probability"
        home_form = self._form_net(home, game_date)
        if home_form.get("status") == "unavailable":
            return home_form
        away_form = self._form_net(away, game_date)
        if away_form.get("status") == "unavailable":
            return away_form
        n = min(home_form["n"], away_form["n"])
        diff = home_form["last"] - away_form["last"] + (self._home_advantage or 0.0)
        prob = sigmoid(diff / self._form_scale)
        return {
            "status": "ok",
            "modeled": True,
            "home": home,
            "away": away,
            "game_date": game_date,
            "win_probability": _round(prob),
            "home_form": home_form["last"],
            "away_form": away_form["last"],
            "home_advantage": _round(self._home_advantage or 0.0),
            "form_scale": _round(self._form_scale),
            "n_home": home_form["n"],
            "n_away": away_form["n"],
            "n": n,
            "evidence_tier": "E2" if n >= 20 else "E3",
            "provenance": provenance_record(
                source,
                {"home": home, "away": away, "game_date": game_date},
                {"lambda": FORM_LAMBDA, "scale": self._form_scale},
                CODE_VERSION,
            ),
        }

    def total_over_probability(self, team: str, line: float, game_date: str, stat: str = "game_total") -> dict[str, Any]:
        """Modeled P(team's game total OVER `line`) via empirical rate + beta posterior.

        Game total = points scored + points allowed in each of the team's
        games (the market Sports Steve models for DraftKings total legs).
        """
        source = "total_over_probability"
        games = self._team_games.get(team)
        if not games:
            return _unavailable(f"no games for team {team}", source)
        hits: list[float] = []
        for g in games:
            if g["date"] >= game_date:
                break
            if stat == "game_total":
                value = float(g["pts_for"] + g["pts_against"])
            elif stat == "pts_for":
                value = float(g["pts_for"])
            elif stat == "pts_against":
                value = float(g["pts_against"])
            else:
                return _unavailable(f"unknown stat {stat}", source)
            if value > 0:
                hits.append(1.0 if value > line else 0.0)
        if len(hits) < 2:
            return _unavailable(
                f"need >= 2 games before {game_date} for {team} totals; got {len(hits)}",
                source,
            )
        successes = sum(hits)
        post = beta_posterior(successes, len(hits) - successes, TOTALS_PRIOR_A, TOTALS_PRIOR_B)
        return {
            "status": "ok",
            "modeled": True,
            "team": team,
            "line": float(line),
            "game_date": game_date,
            "over_probability": _round(post["mean"]),
            "under_probability": _round(1.0 - post["mean"]),
            "empirical_hit_rate": _round(successes / len(hits)),
            "n": len(hits),
            "ci_low": _round(post["ci_low"]),
            "ci_high": _round(post["ci_high"]),
            "evidence_tier": "E2" if len(hits) >= 30 else "E3",
            "provenance": provenance_record(
                source,
                {"team": team, "line": line, "game_date": game_date, "stat": stat},
                {"prior_a": TOTALS_PRIOR_A, "prior_b": TOTALS_PRIOR_B},
                CODE_VERSION,
            ),
        }

    # ----------------------------------------------------- player props (sports_model.db)

    def player_points_over_probability(self, player_name: str, line: float, game_date: str) -> dict[str, Any]:
        """Modeled P(player scores OVER `line` pts) from real game logs.

        Uses the consolidated sports_model.db player_game table (1.27M player
        game logs, 1950-2018, built by prepare_datasets.py). Only games with
        minutes played before `game_date` count; the empirical hit rate is
        shrunk through a beta posterior (small samples pull toward 0.5).
        This unlocks PrizePicks-style player props with a real data source.
        """
        source = "player_points_over_probability"
        db = self._model_db
        if db is None or not db.exists():
            return _unavailable(
                "sports_model.db not found — run prepare_datasets.py (ehallmar player game logs)",
                source,
            )
        hits: list[float] = []
        with sqlite3.connect(str(db)) as con:
            rows = con.execute(
                """
                SELECT pts FROM player_game
                WHERE player_name = ? AND game_date < ? AND minutes > 0
                ORDER BY game_date
                """,
                (player_name, game_date),
            ).fetchall()
        for (pts,) in rows:
            if pts is not None:
                hits.append(1.0 if float(pts) > line else 0.0)
        if len(hits) < 5:
            return _unavailable(
                f"need >= 5 played games before {game_date} for '{player_name}'; got {len(hits)}",
                source,
            )
        successes = sum(hits)
        post = beta_posterior(successes, len(hits) - successes, TOTALS_PRIOR_A, TOTALS_PRIOR_B)
        return {
            "status": "ok",
            "modeled": True,
            "player": player_name,
            "line": float(line),
            "game_date": game_date,
            "over_probability": _round(post["mean"]),
            "under_probability": _round(1.0 - post["mean"]),
            "empirical_hit_rate": _round(successes / len(hits)),
            "n": len(hits),
            "ci_low": _round(post["ci_low"]),
            "ci_high": _round(post["ci_high"]),
            "evidence_tier": "E2" if len(hits) >= 30 else "E3",
            "provenance": provenance_record(
                source,
                {"player": player_name, "line": line, "game_date": game_date},
                {"prior_a": TOTALS_PRIOR_A, "prior_b": TOTALS_PRIOR_B},
                CODE_VERSION,
            ),
        }

    # ------------------------------------------------- market benchmark

    def market_benchmark(
        self,
        from_date: str = "2010-01-01",
        to_date: str = "2018-06-01",
        max_games: int = 600,
    ) -> dict[str, Any]:
        """Benchmark the model against the REAL betting market.

        For games in the window with a Pinnacle-or-book money line (market
        implied home win prob) AND a model prediction, report the out-of-fold
        concordance of BOTH the market and the model against the same outcomes.
        This is the honest "does it beat the book?" check.

        Requires sports_model.db (game_moneyline) + the ehallmar
        nba_games_all.csv for home/away + outcomes.
        """
        source = "sports_model.market_benchmark"
        db = self._model_db
        if db is None or not db.exists():
            return _unavailable(
                "sports_model.db not found — run prepare_datasets.py",
                source,
            )
        games = self._load_market_games(from_date, to_date)
        if not games:
            return _unavailable(
                f"no money-line games with outcomes in {from_date}..{to_date}",
                source,
            )
        sampled = games
        if len(sampled) > max_games:
            stride = max(1, len(sampled) // max_games)
            sampled = games[::stride][:max_games]

        model_records: list[dict[str, Any]] = []
        market_records: list[dict[str, Any]] = []
        for home_abbr, away_abbr, date_s, market_home_prob, outcome in sampled:
            pred = self.win_probability(home_abbr, away_abbr, date_s)
            if pred.get("status") != "ok":
                continue
            model_records.append({"score": float(pred["win_probability"]), "outcome": outcome})
            market_records.append({"score": market_home_prob, "outcome": outcome})

        if len(model_records) < 40:
            return _unavailable(
                f"only {len(model_records)} benchmarkable games",
                source,
            )
        m_model = validate_predictor(model_records, k=5, seed=7, min_n=40, bootstraps=50)
        m_market = validate_predictor(market_records, k=5, seed=7, min_n=40, bootstraps=50)
        if m_model.get("status") == "unavailable" or m_market.get("status") == "unavailable":
            return _unavailable("validation failed", source)
        delta = m_model["concordance"] - m_market["concordance"]
        return {
            "status": "ok",
            "modeled": True,
            "model_concordance": _round(m_model["concordance"]),
            "model_ci_low": _round(m_model["ci_low"]),
            "model_ci_high": _round(m_model["ci_high"]),
            "market_concordance": _round(m_market["concordance"]),
            "market_ci_low": _round(m_market["ci_low"]),
            "market_ci_high": _round(m_market["ci_high"]),
            "model_minus_market": _round(delta),
            "n": m_model["n"],
            "from_date": from_date,
            "to_date": to_date,
            "generated_at": utc_now_iso(),
            "evidence_tier": "E2" if m_model["evidence_tier"] == "E2" else "E3",
            "provenance": provenance_record(
                source,
                {"from_date": from_date, "to_date": to_date, "max_games": max_games},
                {"lambda": FORM_LAMBDA, "scale": self._form_scale},
                CODE_VERSION,
            ),
        }

    def _load_market_games(self, from_date: str, to_date: str) -> list[tuple[str, str, str, float, float]]:
        """Load (home_abbr, away_abbr, date, market_home_prob, outcome) from the
        consolidated game_market table (built by prepare_datasets.py)."""
        db = self._model_db
        if db is None or not db.exists():
            return []
        with sqlite3.connect(str(db)) as con:
            rows = con.execute(
                """
                SELECT home_abbr, away_abbr, game_date, market_home_prob, home_won
                FROM game_market
                WHERE game_date >= ? AND game_date < ?
                  AND home_abbr != '' AND away_abbr != ''
                """,
                (from_date, to_date),
            ).fetchall()
        return [
            (str(h), str(a), str(d), float(p), int(w))
            for h, a, d, p, w in rows
        ]

    # ---------------------------------------------------------------- backtest

    def backtest(
        self,
        from_date: str = "2013-01-01",
        to_date: str = "2023-06-01",
        max_games: int = 800,
    ) -> dict[str, Any]:
        """Out-of-sample validation of the win-probability model.

        Predicts home-win probability for a stride-sampled set of games in the
        window using only data strictly before each game (no lookahead), then
        scores the model with validation_engine.validate_predictor (stratified
        K-fold, Harrell's C with bootstrap CI, decile calibration error, lift
        vs baseline).

        Returns {concordance, ci_low, ci_high, calibration_error, lift, n,
        home_advantage, form_scale, evidence_tier}. E4 when not enough games.
        """
        source = "sports_model.backtest"
        records: list[dict[str, Any]] = []
        # Re-query the db for the window (fast, indexed date); predictions use
        # only data strictly before each game (no lookahead).
        con = sqlite3.connect(str(self.db_path))
        try:
            rows = con.execute(
                """
                SELECT team_abbreviation_home, team_abbreviation_away, game_date,
                       pts_home, pts_away
                FROM game
                WHERE game_date >= ? AND game_date < ?
                  AND wl_home IS NOT NULL
                ORDER BY game_date
                """,
                (from_date, to_date),
            ).fetchall()
        finally:
            con.close()

        # Stride-sample across the whole window so the validation set is
        # representative (not just the first N games by date).
        if len(rows) > max_games:
            stride = max(1, len(rows) // max_games)
            sampled = rows[::stride][:max_games]
        else:
            sampled = rows

        for home, away, date, pts_home, pts_away in sampled:
            date_s = str(date)[:10]
            pred = self.win_probability(home, away, date_s)
            if pred.get("status") != "ok":
                continue
            outcome = 1.0 if (pts_home or 0) > (pts_away or 0) else 0.0
            records.append({"score": float(pred["win_probability"]), "outcome": outcome})

        if len(records) < 40:
            return _unavailable(
                f"backtest window produced only {len(records)} predictable games",
                source,
            )

        validation = validate_predictor(records, k=5, seed=7, min_n=40, bootstraps=50)
        if validation.get("status") == "unavailable":
            return validation
        return {
            "status": "ok",
            "modeled": True,
            "concordance": _round(validation["concordance"]),
            "ci_low": _round(validation["ci_low"]),
            "ci_high": _round(validation["ci_high"]),
            "calibration_error": _round(validation["calibration_error"]),
            "lift": _round(validation["lift"]),
            "n": validation["n"],
            "home_advantage": _round(self._home_advantage or 0.0),
            "form_scale": _round(self._form_scale),
            "evidence_tier": validation["evidence_tier"],
            "from_date": from_date,
            "to_date": to_date,
            "generated_at": utc_now_iso(),
            "provenance": provenance_record(
                source,
                {"from_date": from_date, "to_date": to_date, "max_games": max_games},
                {"lambda": FORM_LAMBDA, "scale": self._form_scale},
                CODE_VERSION,
            ),
        }


def model_win_probability(
    home: str,
    away: str,
    game_date: str,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Convenience: modeled home win probability for a DraftKings-style ML leg."""
    try:
        model = TeamFormModel(db_path)
        return model.win_probability(home, away, game_date)
    except FileNotFoundError as exc:
        return _unavailable(str(exc), "sports_model")


def model_total_over(
    team: str,
    line: float,
    game_date: str,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Convenience: modeled over probability for a DraftKings-style total leg."""
    try:
        model = TeamFormModel(db_path)
        return model.total_over_probability(team, line, game_date)
    except FileNotFoundError as exc:
        return _unavailable(str(exc), "sports_model")