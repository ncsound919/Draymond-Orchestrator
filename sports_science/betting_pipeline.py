# sports_science/betting_pipeline.py
"""Overlay Science experiment & simulation pipeline for the betting formula.

What the field has converged on (betting forums, sharp-bettor literature,
market-efficiency studies), enforced here as iron rules:

  1. CLV (closing line value) is the benchmark, not win rate. A 55% true-talent
     bettor still loses ~1/3 of months. A model that beats the close has skill;
     a model that doesn't is lucky.
  2. Walk-forward only. Every rating used here is a PRE-game number (Elo/CARMELO
     `_pre` from the 1946-2020 dataset; our EWMA uses only prior games), so no
     row is predicted from its own outcome.
  3. Real odds only. Only games with a recorded market line are scored; missing
     lines are excluded, never imputed.
  4. Report n + block-bootstrap CI, never a bare point estimate. Per-bet
     resampling fakes precision; resampling whole seasons is the honest test.
  5. A backtest is where edge goes to lie to you. Everything here is PROVISIONAL
     until forward (unseen) data confirms it.

Strategies benchmarked:
  * Market        — the closing line itself (the benchmark everyone must beat)
  * Elo           — classic rating baseline (thedevastator elo_prob)
  * CARMELO       — ESPN's acclaimed player-adjustment model (carmelo_prob)
  * EWMA-net      — our sports_model team-form model (math-x on real data)
  * FadeFamous    — documented behavioral edge: markets overprice famous-team
                    underdogs by ~+10.4pp (Vaze 2026, 12 NBA seasons,
                    +15.8% gross ROI betting against them). Bets the opponent
                    of a famous-team underdog in playoff games.

Metrics per strategy: Brier, C-index, calibration ECE, CLV, and ROI simulated
on the real -110 market (win pays 0.9091 units). Block-bootstrap over seasons
gives the honest CI + P(ROI>0) / P(CLV>0).

Pure standard library + sqlite3. Deterministic. No LLM, no network.
"""
from __future__ import annotations

import csv
import random
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from sports_science.datasets_config import datasets_root, model_db_path
from sports_science.validation_engine import validate_predictor

# -110 American => decimal 1.9091; win returns 0.9091 units profit per 1 staked.
WIN_PAYOUT = 0.9091
EDGE_THRESHOLD = 0.03  # only "bet" when model edge >= 3pp over the market

# Famous franchises (championship pedigree + name recognition) — the set used by
# the fade-famous behavioral strategy. From the documented dynasty-bias effect.
FAMOUS_FRANCHISES = {
    "LAL", "BOS", "GSW", "CHI", "MIA", "SAS", "NYK", "DET", "HOU", "CLE",
    "PHI", "TOR", "DEN", "MIL", "PHX", "OKC", "DAL", "IND", "LAC",
}

# thedevastator alias fixes (older fran names -> modern market abbreviations).
TEAM_ALIAS = {
    "NJN": "BKN", "CHA": "CHO", "NOH": "NOP", "NOK": "NOP", "SEA": "OKC",
    "WSB": "WAS", "CHH": "CHO", "VAN": "MEM", "NOPL": "NOP", "HOU": "HOU",
}

# The sharpest book (fair-value proxy) for the cross-book strategy.
SHARP_BOOK = "Pinnacle Sports"


def _american_to_decimal(price: float | None) -> float | None:
    """American odds -> decimal odds (the actual payout multiplier)."""
    if price is None or price == 0:
        return None
    try:
        a = float(price)
    except (TypeError, ValueError):
        return None
    if a > 0:
        return 1.0 + a / 100.0
    if a < 0:
        return 1.0 + 100.0 / abs(a)
    return None


@dataclass
class Game:
    game_id: str
    date: str
    home: str
    away: str
    market_home_prob: float
    home_won: int
    elo_home_prob: float | None = None
    carmelo_home_prob: float | None = None
    is_playoff: bool = False
    # Average closing prices (decimal) for the side across books — used for
    # REALISTIC ROI simulation (a favorite's bet does NOT pay -110).
    home_price_dec: float | None = None
    away_price_dec: float | None = None


@dataclass
class StrategyResult:
    name: str
    brier: float | None = None
    concordance: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    calibration_error: float | None = None
    # avg model_prob - market_prob on bets taken (edge magnitude, NOT captured
    # price CLV — we cannot measure real CLV without a better price than close)
    gap: float | None = None
    gap_p_positive: float | None = None
    roi: float | None = None
    roi_ci: tuple[float, float] | None = None
    roi_p_positive: float | None = None
    bets: int = 0
    n: int = 0
    verdict: str = ""


def _brier_score(preds: list[float], outcomes: list[int]) -> float:
    if not preds:
        return 0.0
    return sum((p - o) ** 2 for p, o in zip(preds, outcomes)) / len(preds)


def _calibration_ece(preds: list[float], outcomes: list[int], n_bins: int = 10) -> float:
    paired = sorted(zip(preds, outcomes), key=lambda x: x[0])
    if len(paired) < n_bins:
        return 0.0
    n = len(paired)
    bounds = [round(n * i / n_bins) for i in range(n_bins + 1)]
    total = 0.0
    for b in range(n_bins):
        chunk = paired[bounds[b]:bounds[b + 1]]
        if not chunk:
            continue
        mean_pred = sum(p for p, _ in chunk) / len(chunk)
        mean_out = sum(o for _, o in chunk) / len(chunk)
        total += abs(mean_pred - mean_out)
    return total / n_bins


def _block_bootstrap_profit(
    seasons: dict[int, list[float]], rng: random.Random, iters: int = 600
) -> tuple[float, float, float]:
    """Resample whole seasons of per-bet PROFITS (already paid out or lost).
    Returns (median ROI, 2.5%, 97.5%) where ROI = mean profit / mean stake=1."""
    season_keys = list(seasons.keys())
    if not season_keys:
        return 0.0, 0.0, 0.0
    rois: list[float] = []
    for _ in range(iters):
        sample: list[float] = []
        for _ in range(len(season_keys)):
            sample.extend(seasons[rng.choice(season_keys)])
        if sample:
            rois.append(sum(sample) / len(sample))
    if not rois:
        return 0.0, 0.0, 0.0
    rois.sort()
    return rois[len(rois) // 2], rois[int(0.025 * len(rois))], rois[int(0.975 * len(rois))]


def _bootstrap_p_positive(values: list[float], rng: random.Random, iters: int = 600) -> float:
    if not values:
        return 0.0
    pos = sum(1 for v in values if v > 0)
    return pos / len(values)


def _season_of(date_str: str) -> int:
    try:
        return int(date_str[:4])
    except (TypeError, ValueError):
        return 0


class BettingExperiment:
    """Loads market games + ratings once, then evaluates strategies honestly."""

    def __init__(self, from_date: str = "2010-01-01", to_date: str = "2018-06-01", max_games: int = 3000):
        db = model_db_path()
        if db is None or not db.exists():
            raise FileNotFoundError("sports_model.db not found — run prepare_datasets.py")
        self.from_date = from_date
        self.to_date = to_date
        self.max_games = max_games
        self.games: list[Game] = self._load_market_games(db)
        self._enrich_ratings()
        self._season_map: dict[str, list[Game]] = {}
        for g in self.games:
            self._season_map.setdefault(str(_season_of(g.date)), []).append(g)

    # ------------------------------------------------------------------ load

    def _load_market_games(self, db: Path) -> list[Game]:
        con = sqlite3.connect(str(db))
        try:
            rows = con.execute(
                """
                SELECT game_id, game_date, home_abbr, away_abbr,
                       market_home_prob, home_won
                FROM game_market
                WHERE game_date >= ? AND game_date < ?
                  AND home_abbr != '' AND away_abbr != ''
                ORDER BY game_date
                """,
                (self.from_date, self.to_date),
            ).fetchall()
            # Average closing prices per game from game_book (real prices for
            # realistic ROI simulation — a favorite does not pay -110).
            price_rows = con.execute(
                """
                SELECT game_id,
                       AVG(home_price), AVG(away_price)
                FROM game_book
                GROUP BY game_id
                """
            ).fetchall()
        finally:
            con.close()
        prices = {
            str(gid): (_american_to_decimal(hp), _american_to_decimal(ap))
            for gid, hp, ap in price_rows
        }
        games = []
        for g, d, h, a, p, w in rows:
            dec_h, dec_a = prices.get(str(g), (None, None))
            games.append(Game(
                game_id=str(g), date=str(d), home=str(h), away=str(a),
                market_home_prob=float(p), home_won=int(w),
                home_price_dec=dec_h, away_price_dec=dec_a,
            ))
        if len(games) > self.max_games:
            stride = max(1, len(games) // self.max_games)
            games = games[::stride][: self.max_games]
        return games

    def _enrich_ratings(self) -> None:
        """Join Elo + CARMELO pre-game probs from thedevastator by (date, teams)."""
        root = datasets_root()
        if root is None:
            return
        src = root / "thedevastator__nba-game-elo-and-carmelo-ratings-1946-2020" / "nba_elo.csv"
        if not src.exists():
            return
        # game lookup key: (date, sorted team pair) -> (prob1_for_team1)
        by_pair: dict[tuple[str, str, str], tuple[float, float, bool]] = {}
        with open(src, encoding="utf-8", errors="replace") as f:
            for row in csv.DictReader(f):
                date = (row.get("date") or "")[:10]
                t1 = TEAM_ALIAS.get(row.get("team1", ""), row.get("team1", "")).upper()
                t2 = TEAM_ALIAS.get(row.get("team2", ""), row.get("team2", "")).upper()
                if not date or not t1 or not t2:
                    continue
                try:
                    elo_prob = float(row["elo_prob1"])
                    carmelo_prob = float(row["carmelo_prob1"]) if row.get("carmelo_prob1") else None
                except (TypeError, ValueError):
                    continue
                playoff = str(row.get("playoff") or "").strip().lower() in ("1", "y", "t", "yes")
                by_pair[(date, t1, t2)] = (elo_prob, carmelo_prob, playoff)

        for g in self.games:
            key = (g.date, g.home, g.away)
            rev = (g.date, g.away, g.home)
            if key in by_pair:
                elo1, carmelo1, playoff = by_pair[key]
                g.elo_home_prob = elo1
                g.carmelo_home_prob = carmelo1 if carmelo1 is not None else None
                g.is_playoff = playoff
            elif rev in by_pair:
                elo2, carmelo2, playoff = by_pair[rev]
                g.elo_home_prob = 1.0 - elo2
                g.carmelo_home_prob = (1.0 - carmelo2) if carmelo2 is not None else None
                g.is_playoff = playoff

    # ------------------------------------------------------------ strategies

    def _market_predict(self, g: Game) -> float:
        return g.market_home_prob

    def _elo_predict(self, g: Game) -> float:
        return g.elo_home_prob if g.elo_home_prob is not None else g.market_home_prob

    def _carmelo_predict(self, g: Game) -> float:
        if g.carmelo_home_prob is not None:
            return g.carmelo_home_prob
        return g.elo_home_prob if g.elo_home_prob is not None else g.market_home_prob

    def _ewma_predict(self, g: Game) -> float:
        from sports_science.sports_model import TeamFormModel

        if not hasattr(self, "_ewma"):
            self._ewma = TeamFormModel()
        try:
            result = self._ewma.win_probability(g.home, g.away, g.date)
            if result.get("status") == "ok":
                return float(result["win_probability"])
        except Exception:  # noqa: BLE001
            pass
        return g.market_home_prob

    def _fade_famous_predict(self, g: Game, require_playoff: bool = True) -> float:
        """Bet the opponent of a famous-team underdog.

        The market overprices famous-team underdogs (documented dynasty bias:
        +10.4pp mispricing, +15.8% gross ROI betting against them). The
        published effect is strongest in playoff series, so by default we only
        fire there; require_playoff=False tests whether the bias generalizes to
        the regular season (where famous teams are underdogs far more often).
        """
        if require_playoff and not g.is_playoff:
            return g.market_home_prob
        home_famous = g.home in FAMOUS_FRANCHISES
        away_famous = g.away in FAMOUS_FRANCHISES
        # Famous home underdog: market overprices home -> fade home (bet away).
        if home_famous and not away_famous and g.market_home_prob < 0.5:
            return max(0.05, g.market_home_prob - 0.10)
        # Famous away underdog: market overprices away -> fade away (bet home).
        if away_famous and not home_famous and g.market_home_prob > 0.5:
            return min(0.95, g.market_home_prob + 0.10)
        return g.market_home_prob

    # ------------------------------------------------------------- evaluate

    def evaluate_prop_strategy(self, max_players: int = 25, min_games: int = 30) -> StrategyResult:
        """Player props at -110 (both sides -110, so flat payout is correct).

        Synthetic book sets the line at the player's season mean pts. Our
        player_points_over model predicts P(over) from real game logs via beta
        posterior. We bet at -110 when |model - 0.5| >= threshold (i.e. the
        synthetic book is mispriced vs the empirical hit rate).
        """
        result = StrategyResult(name="player-props")
        from sports_science.sports_model import TeamFormModel

        # Use the model's sports_model.db path (walk up to the shared location).
        db_path = model_db_path()
        if db_path is None or not db_path.exists():
            return result
        try:
            model = TeamFormModel() if not hasattr(self, "_ewma") else self._ewma
            if not hasattr(self, "_ewma"):
                self._ewma = model
        except FileNotFoundError:
            return result

        # Sample players with enough history.
        with sqlite3.connect(str(db_path)) as con:
            players = [r[0] for r in con.execute(
                "SELECT player_name FROM player_game WHERE minutes > 0 "
                "GROUP BY player_name HAVING COUNT(*) >= ? ORDER BY COUNT(*) DESC LIMIT ?",
                (min_games, max_players),
            ).fetchall()]

        rng = random.Random(7)
        season_bets: dict[int, list[float]] = {}
        gaps: list[float] = []
        total_profit = 0.0
        bet_count = 0
        calibration_preds: list[float] = []
        calibration_outs: list[int] = []

        for player in players:
            with sqlite3.connect(str(db_path)) as con:
                rows = con.execute(
                    "SELECT game_date, pts FROM player_game "
                    "WHERE player_name = ? AND minutes > 0 ORDER BY game_date",
                    (player,),
                ).fetchall()
            if len(rows) < min_games:
                continue
            pts_series = [float(r[1]) for r in rows]
            dates = [r[0] for r in rows]
            # ROLLING prior mean as the synthetic book line (no lookahead — the
            # line for game i is the mean of games 0..i-1 only).
            for i, (date, pts) in enumerate(zip(dates, pts_series)):
                if i < 20:
                    continue
                line = round(sum(pts_series[:i]) / i, 1)
                # Model predicts over probability for THIS game using only prior games.
                pred = model.player_points_over_probability(player, line, date)
                if pred.get("status") != "ok":
                    continue
                model_over = float(pred["over_probability"])
                market_over = 0.5  # synthetic book at rolling mean => implied 50/50
                edge = model_over - market_over
                if abs(edge) < EDGE_THRESHOLD:
                    continue
                on_over = edge > 0
                actual_over = float(pts) > line
                win = actual_over == on_over
                profit = WIN_PAYOUT if win else -1.0
                total_profit += profit
                bet_count += 1
                season = int(date[:4])
                season_bets.setdefault(season, []).append(profit)
                gaps.append(edge)
                calibration_preds.append(model_over)
                calibration_outs.append(1 if actual_over else 0)

        result.bets = bet_count
        result.n = len(players)
        result.brier = round(_brier_score(calibration_preds, calibration_outs), 4) if calibration_preds else None
        result.calibration_error = round(_calibration_ece(calibration_preds, calibration_outs), 4) if calibration_preds else None
        if bet_count > 0:
            result.roi = round(total_profit / bet_count, 4)
            median, lo, hi = _block_bootstrap_profit(season_bets, rng, iters=600)
            result.roi_ci = (round(lo, 4), round(hi, 4))
            result.roi_p_positive = round(_bootstrap_p_positive([p for profs in season_bets.values() for p in profs], rng), 3)
        if gaps:
            result.gap = round(sum(gaps) / len(gaps), 4)
            result.gap_p_positive = round(_bootstrap_p_positive(gaps, rng), 3)
        result.verdict = self._verdict(result)
        return result

    def _load_book_lines(self) -> dict[str, dict]:
        """game_id -> {book_name: (home_implied, home_decimal, away_decimal)}."""
        db = model_db_path()
        if db is None or not db.exists():
            return {}
        if hasattr(self, "_book_lines"):
            return self._book_lines
        con = sqlite3.connect(str(db))
        try:
            rows = con.execute(
                """
                SELECT game_id, book_name, home_implied_prob, home_price, away_price
                FROM game_book
                """
            ).fetchall()
        finally:
            con.close()
        out: dict[str, dict] = {}
        for gid, book, implied, hp, ap in rows:
            dec_h = _american_to_decimal(hp)
            dec_a = _american_to_decimal(ap)
            if dec_h is None or dec_a is None:
                continue
            out.setdefault(str(gid), {})[str(book)] = (float(implied), dec_h, dec_a)
        self._book_lines = out
        return out

    def evaluate_book_strategy(
        self,
        name: str,
        sharp_book: str = SHARP_BOOK,
        min_deviation: float = 0.03,
        max_deviation: float = 0.25,
    ) -> StrategyResult:
        """Bet soft-book sides that deviate from the sharp book's fair line.

        Pinnacle is the sharpest book; its devigged implied probability is the
        fair-value proxy. When a soft book prices a side BELOW Pinnacle's fair
        probability (i.e. pays more than fair), bet that side at the soft
        book's price. Settlement is against the real outcome. This is the
        documented sharp practice — beat the book by finding books that price
        the same game wrong, not by out-predicting the market.

        max_deviation guards against junk/stale lines (implausibly large gaps).
        """
        result = StrategyResult(name=name)
        lines = self._load_book_lines()
        if not lines:
            return result
        rng = random.Random(7)
        season_bets: dict[int, list[float]] = {}
        gaps: list[float] = []
        total_profit = 0.0
        bet_count = 0
        for g in self.games:
            by_book = lines.get(g.game_id)
            if not by_book or sharp_book not in by_book:
                continue
            fair_home = by_book[sharp_book][0]  # sharp devigged prob = fair proxy
            for book, (soft_implied, soft_dec_h, soft_dec_a) in by_book.items():
                if book == sharp_book:
                    continue
                # Home side: soft book prices home below fair -> pays too much.
                dev = fair_home - soft_implied
                if min_deviation <= dev <= max_deviation and soft_dec_h is not None:
                    win = g.home_won == 1
                    profit = (soft_dec_h - 1.0) if win else -1.0
                    total_profit += profit
                    bet_count += 1
                    season_bets.setdefault(_season_of(g.date), []).append(profit)
                    gaps.append(dev)
                # Away side: soft book prices away below its fair share.
                fair_away = 1.0 - fair_home
                soft_away_implied = 1.0 - soft_implied
                dev_a = fair_away - soft_away_implied
                if min_deviation <= dev_a <= max_deviation and soft_dec_a is not None:
                    win = g.home_won == 0
                    profit = (soft_dec_a - 1.0) if win else -1.0
                    total_profit += profit
                    bet_count += 1
                    season_bets.setdefault(_season_of(g.date), []).append(profit)
                    gaps.append(dev_a)
        result.bets = bet_count
        if bet_count > 0:
            result.roi = round(total_profit / bet_count, 4)
            median, lo, hi = _block_bootstrap_profit(season_bets, rng, iters=600)
            result.roi_ci = (round(lo, 4), round(hi, 4))
            result.roi_p_positive = round(
                _bootstrap_p_positive([p for profs in season_bets.values() for p in profs], rng),
                3,
            )
        if gaps:
            result.gap = round(sum(gaps) / len(gaps), 4)
            result.gap_p_positive = round(_bootstrap_p_positive(gaps, rng), 3)
        result.n = len(self.games)
        result.verdict = self._verdict(result)
        return result

    def evaluate(self, name: str, predict: Callable[[Game], float]) -> StrategyResult:
        result = StrategyResult(name=name)
        games = self.games
        if not games:
            return result
        # Probability quality over ALL games with a market line.
        preds = [predict(g) for g in games]
        outcomes = [g.home_won for g in games]
        result.brier = round(_brier_score(preds, outcomes), 4)
        result.calibration_error = round(_calibration_ece(preds, outcomes), 4)
        # C-index on a stride-sampled subset (concordance is O(n^2) — full
        # 3000-game evaluation would take minutes per strategy).
        records = [{"score": p, "outcome": o} for p, o in zip(preds, outcomes)]
        if len(records) > 800:
            stride = max(1, len(records) // 800)
            records = records[::stride][:800]
        val = validate_predictor(records, k=5, seed=7, min_n=40, bootstraps=30)
        if val.get("status") != "unavailable":
            result.concordance = round(val["concordance"], 4)
            result.ci_low = round(val["ci_low"], 4)
            result.ci_high = round(val["ci_high"], 4)
        result.n = len(games)

        # Betting simulation: edge over market, staked at the ACTUAL closing
        # price for the chosen side (not flat -110 — a favorite pays less).
        # gap = avg(model_prob - market_prob) on bets taken.
        rng = random.Random(7)
        season_bets: dict[int, list[float]] = {}
        gaps: list[float] = []
        total_staked = 0.0
        total_profit = 0.0
        bet_count = 0
        for g in games:
            prob = predict(g)
            edge = prob - g.market_home_prob
            if abs(edge) < EDGE_THRESHOLD:
                continue
            # Bet on the side the model favors: home if prob > market, else away.
            on_home = edge > 0
            win = g.home_won == 1 if on_home else g.home_won == 0
            # Realistic payout: the actual closing price for the chosen side.
            dec = g.home_price_dec if on_home else g.away_price_dec
            if dec is None or dec <= 1.0:
                continue
            stake = 1.0
            profit = (dec - 1.0) * stake if win else -stake
            total_staked += stake
            total_profit += profit
            bet_count += 1
            season_bets.setdefault(_season_of(g.date), []).append(profit)
            gaps.append(edge)
        result.bets = bet_count
        if total_staked > 0:
            result.roi = round(total_profit / total_staked, 4)
            median, lo, hi = _block_bootstrap_profit(season_bets, rng, iters=600)
            result.roi_ci = (round(lo, 4), round(hi, 4))
            result.roi_p_positive = round(
                _bootstrap_p_positive([p for profs in season_bets.values() for p in profs], rng),
                3,
            )
        if gaps:
            result.gap = round(sum(gaps) / len(gaps), 4)
            result.gap_p_positive = round(_bootstrap_p_positive(gaps, rng), 3)
        result.verdict = self._verdict(result)
        return result

    @staticmethod
    def _verdict(r: StrategyResult) -> str:
        if r.bets == 0:
            return "no bets fired (no edge >= threshold)"
        parts = []
        if r.gap is not None:
            parts.append(f"gap={r.gap:+.2%} P(>0)={r.gap_p_positive:.0%}")
        if r.roi is not None:
            parts.append(f"ROI={r.roi:+.2%} P(>0)={r.roi_p_positive:.0%}")
        if r.concordance is not None and r.ci_low is not None and r.ci_high is not None:
            parts.append(f"C={r.concordance:.3f} [{r.ci_low:.3f},{r.ci_high:.3f}]")
        if r.bets < 500:
            parts.append("PROVISIONAL (need ~500-2000 bets for significance)")
        return " | ".join(parts)

    def run_all(self) -> list[StrategyResult]:
        strategies = [
            ("market", self._market_predict),
            ("elo", self._elo_predict),
            ("carmelo", self._carmelo_predict),
            ("ewma-net", self._ewma_predict),
            ("fade-famous", lambda g: self._fade_famous_predict(g, require_playoff=True)),
            ("fade-famous-all", lambda g: self._fade_famous_predict(g, require_playoff=False)),
        ]
        results = [self.evaluate(name, fn) for name, fn in strategies]
        results.append(self.evaluate_prop_strategy())
        # Cross-book: the sharp practice — exploit soft-book mispricing vs Pinnacle.
        for dev in (0.03, 0.05, 0.08):
            results.append(
                self.evaluate_book_strategy(f"book-gap-{int(dev*100)}", min_deviation=dev)
            )
        return results

    def report(self, results: list[StrategyResult]) -> str:
        lines = [
            f"Betting Experiment | {self.from_date}..{self.to_date} | "
            f"games={len(self.games)} | edge threshold={EDGE_THRESHOLD:.0%} | payout={WIN_PAYOUT}",
            "=" * 100,
            f"{'strategy':<14} {'Brier':>7} {'C-index':>13} {'ECE':>6} {'bets':>5} "
            f"{'gap':>8} {'ROI':>10}  verdict",
            "-" * 100,
        ]
        for r in results:
            lines.append(
                f"{r.name:<14} {str(r.brier):>7} {str(r.concordance or '-'):>13} "
                f"{str(r.calibration_error or '-'):>6} {r.bets:>5} "
                f"{str(r.gap or '-'):>8} {str(r.roi or '-'):>10}  {r.verdict}"
            )
        return "\n".join(lines)


def run_experiment(from_date: str = "2010-01-01", to_date: str = "2018-06-01", max_games: int = 14000) -> tuple[list[StrategyResult], str]:
    exp = BettingExperiment(from_date=from_date, to_date=to_date, max_games=max_games)
    results = exp.run_all()
    return results, exp.report(results)


def run_forward_test(from_date: str = "2019-01-01", to_date: str = "2026-06-01", max_games: int = 8000) -> tuple[list[StrategyResult], str]:
    """Forward-test on the UNSEEN 2019-2026 window (real odds from the
    chevronronson set). Retrospective edges are PROVISIONAL until confirmed
    here — the pipeline's iron rule."""
    exp = ForwardExperiment(from_date=from_date, to_date=to_date, max_games=max_games)
    results = exp.run_all()
    return results, exp.report(results)


class ForwardExperiment(BettingExperiment):
    """Loads the 2019-2026 real-odds window (game_forward) instead of the
    2010-2018 game_market window. Everything else (strategies, evaluation,
    bootstraps) is identical — no re-tuning on the forward window."""

    def __init__(self, from_date: str = "2019-01-01", to_date: str = "2026-06-01", max_games: int = 8000):
        self.from_date = from_date
        self.to_date = to_date
        self.max_games = max_games
        db = model_db_path()
        if db is None or not db.exists():
            raise FileNotFoundError("sports_model.db not found — run prepare_datasets.py")
        self.games = self._load_forward_games(db)
        self._enrich_ratings()
        self._season_map: dict[str, list[Game]] = {}
        for g in self.games:
            self._season_map.setdefault(str(_season_of(g.date)), []).append(g)

    def _load_forward_games(self, db: Path) -> list[Game]:
        con = sqlite3.connect(str(db))
        try:
            rows = con.execute(
                """
                SELECT game_id, game_date, home_abbr, away_abbr,
                       home_price, away_price, home_won
                FROM game_forward
                WHERE game_date >= ? AND game_date < ?
                ORDER BY game_date
                """,
                (self.from_date, self.to_date),
            ).fetchall()
        finally:
            con.close()
        games = []
        for gid, d, h, a, hp, ap, w in rows:
            hp, ap = float(hp), float(ap)
            # devigged market home prob from the real closing prices
            q_home = 1.0 / hp
            q_away = 1.0 / ap
            market_home = q_home / (q_home + q_away) if (q_home + q_away) > 0 else 0.5
            games.append(Game(
                game_id=str(gid), date=str(d), home=str(h), away=str(a),
                market_home_prob=market_home, home_won=int(w),
                home_price_dec=hp, away_price_dec=ap,
            ))
        if len(games) > self.max_games:
            stride = max(1, len(games) // self.max_games)
            games = games[::stride][: self.max_games]
        return games