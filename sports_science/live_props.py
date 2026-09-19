# sports_science/live_props.py
"""Live player-prop edge test — real book props vs the sports_model.

Connects the Odds API (via Sports Steve's OddsApiBroker) to the player points
model. For each real NBA player-prop line the model computes an over
probability from actual game logs; the book's implied probability (devigged
from the real price) is the market to beat. Legs with |model - market| above
the edge threshold are logged to a virtual ledger for later settlement.

Honesty rules:
  * No API key / API unreachable  -> structured E4 unavailable result (never a
    fabricated line). Every prop has a real book price or it is skipped.
  * The model only produces probabilities from real game logs (sports_model.db);
    players without history are skipped, never guessed.
  * Every logged leg carries provenance + the price seen at decision time so
    the forward ledger is auditable.

Run via: python run_live_props.py [--max N] [--edge 0.03]
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.datasets_config import model_db_path  # noqa: E402
from sports_science.sports_model import TeamFormModel  # noqa: E402
from sports_science.validation_engine import provenance_record, utc_now_iso  # noqa: E402

CODE_VERSION = "live_props-1.0.0"
LEDGER_TABLE = "prop_ledger"

# SQL is assembled once at import from the constant table name, so every
# execute() call site passes a plain string and never interpolates at runtime.
_CREATE_LEDGER_SQL = (
    f"CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT)"
)
_INSERT_LEDGER_SQL = f"INSERT INTO {LEDGER_TABLE} (data) VALUES (?)"
_SELECT_OPEN_LEDGER_SQL = f"SELECT id, data FROM {LEDGER_TABLE} WHERE data LIKE ?"
_SELECT_LEDGER_BY_ID_SQL = f"SELECT data FROM {LEDGER_TABLE} WHERE id=?"
_UPDATE_LEDGER_SQL = f"UPDATE {LEDGER_TABLE} SET data=? WHERE id=?"


def _american_to_implied(price: Any) -> float | None:
    try:
        a = float(price)
    except (TypeError, ValueError):
        return None
    if a > 0:
        return 100.0 / (a + 100.0)
    if a < 0:
        return -a / (-a + 100.0)
    return None


def _devig_over(over_price: Any, under_price: Any) -> float:
    """Devigged P(over) from the book's over/under prices."""
    p_over = _american_to_implied(over_price)
    p_under = _american_to_implied(under_price)
    if p_over is None or p_under is None or (p_over + p_under) <= 0:
        return 0.5
    return p_over / (p_over + p_under)


class LivePropEngine:
    def __init__(self, api_key: str | None = None, edge_threshold: float = 0.03):
        self.api_key = api_key or self._find_key()
        self.edge_threshold = edge_threshold
        self.model = TeamFormModel() if model_db_path() else None

    @staticmethod
    def _find_key() -> str | None:
        """Resolve the Odds API key without printing it: env var, Sports Steve
        .env (gitignored), or Keywire vault."""
        import os

        env = os.environ.get("THE_ODDS_API_KEY")
        if env:
            return env
        # Sports Steve runtime .env (gitignored) — search up the tree so this
        # works from both the pillar and Draymond runtime copies.
        here = Path(__file__).resolve()
        candidates = [
            here.parent / ".env",
            here.parent.parent / ".env",
        ]
        for parent in here.parents:
            candidates.append(parent / "agents" / "Sports-Steve-main" / ".env")
            candidates.append(parent / "Draymond-Orchestrator" / "agents" / "Sports-Steve-main" / ".env")
            if parent.name == "Uplift":
                break
        seen: set[Path] = set()
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                if not candidate.exists():
                    continue
                for line in candidate.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = line.strip()
                    if line.startswith("THE_ODDS_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
            except Exception:  # noqa: BLE001
                continue
        # Keywire vault (best-effort, never guessed).
        try:
            from keywire_client import get_secret  # type: ignore

            return get_secret("THE_ODDS_API_KEY")
        except Exception:  # noqa: BLE001
            return None

    def key_present(self) -> bool:
        return bool(self.api_key)

    def available(self) -> bool:
        return self.key_present() and self.model is not None

    # ---------------------------------------------------------------- broker

    async def _fetch_props(self, sport: str, max_legs: int) -> list[dict[str, Any]]:
        """Fetch real prop legs via Sports Steve's OddsApiBroker."""
        import sys as _sys

        broker_root: Path | None = None
        here = Path(__file__).resolve()
        for parent in here.parents:
            candidate = parent / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            candidate = parent / "Draymond-Orchestrator" / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            if parent.name == "Uplift":
                break
        if broker_root is None or str(broker_root) not in _sys.path:
            _sys.path.insert(0, str(broker_root))
        # The broker's `from src.config import settings` needs the repo root too.
        repo_root = broker_root.parent
        if str(repo_root) not in _sys.path:
            _sys.path.insert(0, str(repo_root))
        from brokers.oddsapi import OddsApiBroker  # type: ignore

        async with OddsApiBroker(api_key=self.api_key) as broker:
            props = await broker.get_player_props(sport)
        return props[:max_legs]

    # -------------------------------------------------- live moneyline edge

    async def run_ml(self, sport: str = "NBA", max_games: int = 30, edge_threshold: float | None = None) -> dict[str, Any]:
        """Live moneyline edge test: the team model vs REAL live closing lines.

        Fetches live h2h odds (this key's tier supports it), devigs each
        book's moneyline, and scores the model's win probability against the
        market. This is a genuine FORWARD test on current-season data — no
        lookahead, real prices, logged to the ledger for settlement.
        """
        threshold = edge_threshold if edge_threshold is not None else self.edge_threshold
        import sys as _sys

        broker_root: Path | None = None
        here = Path(__file__).resolve()
        for parent in here.parents:
            candidate = parent / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            candidate = parent / "Draymond-Orchestrator" / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            if parent.name == "Uplift":
                break
        if broker_root is None:
            return {"status": "unavailable", "reason": "Sports Steve broker not found",
                    "evidence_tier": "E4", "modeled": False}
        if str(broker_root) not in _sys.path:
            _sys.path.insert(0, str(broker_root))
        if str(broker_root.parent) not in _sys.path:
            _sys.path.insert(0, str(broker_root.parent))
        from brokers.oddsapi import OddsApiBroker  # type: ignore

        from sports_science.sports_model import TeamFormModel

        model = TeamFormModel()
        async with OddsApiBroker(api_key=self.api_key) as broker:
            events = await broker.get_odds(sport, [])
        if not events:
            return {"status": "unavailable", "reason": f"no live {sport} events",
                    "evidence_tier": "E4", "modeled": False}

        rows: list[dict[str, Any]] = []
        edges: list[float] = []
        for event_id, ev in list(events.items())[:max_games]:
            home = ev.get("home_team", "")
            away = ev.get("away_team", "")
            commence = ev.get("commence_time", "")
            # Map team names to abbreviations for the model (best-effort; skip
            # unknown teams rather than guess).
            home_abbr = self._team_abbr(home)
            away_abbr = self._team_abbr(away)
            if not home_abbr or not away_abbr:
                continue
            try:
                pred = model.win_probability(home_abbr, away_abbr, self._game_date(commence))
            except Exception:  # noqa: BLE001
                continue
            if pred.get("status") != "ok":
                continue
            model_prob = float(pred["win_probability"])
            # Best available real price + book for the home side.
            best = ev.get("best_odds", {}).get("home", {})
            price = best.get("price")
            book = best.get("book")
            if price is None:
                continue
            # Devig home prob from the best real prices (h2h in ev includes
            # away price too — compute from bookmakers when available).
            market_home = self._market_home_prob(ev)
            if market_home is None:
                continue
            edge = model_prob - market_home
            if abs(edge) < threshold:
                continue
            rows.append({
                "logged_at": utc_now_iso(),
                "event_id": event_id,
                "commence_time": commence,
                "home": home_abbr,
                "away": away_abbr,
                "direction": "home" if edge > 0 else "away",
                "model_home_prob": round(model_prob, 4),
                "market_home_prob": round(market_home, 4),
                "edge": round(edge, 4),
                "price": price,
                "book": book,
                "sport": sport,
                "modeled": True,
                "evidence_tier": pred.get("evidence_tier", "E3"),
                "settled": None,
                "result": None,
                "profit": None,
            })
            edges.append(edge)
        if rows:
            self._persist(rows)
        return {
            "status": "ok",
            "modeled": True,
            "fetched_events": len(events),
            "scored_edges": len(rows),
            "avg_edge": round(sum(edges) / len(edges), 4) if edges else None,
            "ledger_rows": rows[:10],
            "evidence_tier": "E2",
            "generated_at": utc_now_iso(),
        }

    @staticmethod
    def _game_date(commence: str | None) -> str:
        if not commence:
            return utc_now_iso()[:10]
        return commence[:10]

    @staticmethod
    def _team_abbr(name: str) -> str | None:
        """Map an Odds API team name to the NBA abbreviation the model knows."""
        name = (name or "").strip()
        known = {
            "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
            "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
            "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
            "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
            "LA Clippers": "LAC", "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL",
            "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL",
            "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NOP", "New York Knicks": "NYK",
            "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI",
            "Phoenix Suns": "PHX", "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC",
            "San Antonio Spurs": "SAS", "Toronto Raptors": "TOR", "Utah Jazz": "UTA",
            "Washington Wizards": "WAS",
        }
        return known.get(name)

    @staticmethod
    def _market_home_prob(ev: dict[str, Any]) -> float | None:
        """Best home prob from the first book's h2h market (devigged)."""
        home = ev.get("home_team", "")
        away = ev.get("away_team", "")
        best_home = best_away = None
        for book in ev.get("bookmakers", []):
            for market in book.get("markets", []):
                if market.get("key") != "h2h":
                    continue
                for outcome in market.get("outcomes", []):
                    p = outcome.get("price")
                    if p is None:
                        continue
                    if outcome.get("name") == home:
                        best_home = max(best_home or -1e9, p)
                    elif outcome.get("name") == away:
                        best_away = max(best_away or -1e9, p)
        if best_home is None or best_away is None:
            return None
        def to_prob(a: float) -> float:
            if a > 0:
                return 100.0 / (a + 100.0)
            if a < 0:
                return -a / (-a + 100.0)
            return 0.5
        ph = to_prob(best_home)
        pa = to_prob(best_away)
        if ph + pa <= 0:
            return None
        return ph / (ph + pa)

    # ----------------------------------------------------------------- edge

    def _model_over(self, player: str, line: float) -> dict[str, Any] | None:
        """Model over probability for a player/line (uses real game logs)."""
        if self.model is None:
            return None
        today = utc_now_iso()[:10]
        result = self.model.player_points_over_probability(player, line, today)
        if result.get("status") != "ok":
            return None
        return result

    def _score_prop(self, prop: dict[str, Any]) -> dict[str, Any] | None:
        """Score one real prop leg against the model. Returns a ledger row or
        None when there is no edge / no model coverage / no real price."""
        player = prop.get("player", "")
        line = prop.get("line")
        if not player or line is None:
            return None
        modeled = self._model_over(player, float(line))
        if modeled is None:
            return None
        over_price = prop.get("price")
        # Need the opposite side to devig: The Odds API returns over/under as
        # separate outcomes; pair by event+player+line.
        under_price = prop.get("pair_price")
        if under_price is None:
            return None  # cannot devig without both sides — never guess
        market_over = _devig_over(over_price, under_price)
        model_over = float(modeled["over_probability"])
        edge = model_over - market_over
        if abs(edge) < self.edge_threshold:
            return None
        return {
            "logged_at": utc_now_iso(),
            "event_id": prop.get("event_id", ""),
            "commence_time": prop.get("commence_time", ""),
            "player": player,
            "stat_type": prop.get("stat_type", "pts"),
            "line": float(line),
            "direction": "over" if edge > 0 else "under",
            "model_over_prob": round(model_over, 4),
            "market_over_prob": round(market_over, 4),
            "edge": round(edge, 4),
            "price": prop.get("price"),
            "book": prop.get("book", ""),
            "sport": prop.get("sport", ""),
            "modeled": True,
            "provenance": modeled.get("provenance"),
            "evidence_tier": modeled.get("evidence_tier", "E3"),
            "settled": None,
            "result": None,
            "profit": None,
        }

    # ------------------------------------------------------------- pipeline

    async def run(self, sport: str = "NBA", max_legs: int = 200) -> dict[str, Any]:
        """Fetch live props, score against the model, log edges to the ledger."""
        if not self.available():
            return {
                "status": "unavailable",
                "reason": "Odds API key not set (set THE_ODDS_API_KEY or add to Keywire) "
                          "or NBA game-log dataset missing",
                "evidence_tier": "E4",
                "modeled": False,
            }
        props = await self._fetch_props(sport, max_legs)
        if not props:
            return {
                "status": "unavailable",
                "reason": f"no player_props returned for {sport} (out of season or quota)",
                "evidence_tier": "E4",
                "modeled": False,
            }
        # Pair over/under sides per event+player+line so devig works.
        by_key: dict[tuple, dict] = {}
        for p in props:
            key = (p.get("event_id"), p.get("player"), p.get("line"), p.get("book"))
            by_key.setdefault(key, {}).update(
                {"over_price": p["price"]} if p["direction"] == "over"
                else {"under_price": p["price"]}
            )
        ledger_rows: list[dict] = []
        edges: list[float] = []
        for p in props:
            if p["direction"] != "over":
                continue  # score once per over side
            key = (p.get("event_id"), p.get("player"), p.get("line"), p.get("book"))
            pair = by_key.get(key, {})
            p["pair_price"] = pair.get("under_price")
            if p["pair_price"] is None:
                continue
            row = self._score_prop(p)
            if row is None:
                continue
            ledger_rows.append(row)
            edges.append(row["edge"])
        if ledger_rows:
            self._persist(ledger_rows)
        return {
            "status": "ok",
            "modeled": True,
            "fetched_legs": len(props),
            "scored_legs": len(ledger_rows),
            "avg_edge": round(sum(edges) / len(edges), 4) if edges else None,
            "edges_above_threshold": len(edges),
            "ledger_rows": ledger_rows[:20],
            "evidence_tier": "E2",
            "generated_at": utc_now_iso(),
        }

    # ------------------------------------------------------------- persist

    def _persist(self, rows: list[dict]) -> None:
        db = model_db_path()
        if db is None:
            return
        con = sqlite3.connect(str(db))
        try:
            con.execute(_CREATE_LEDGER_SQL)
            for row in rows:
                # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- _INSERT_LEDGER_SQL is built from the constant LEDGER_TABLE with a bound ? value.
                con.execute(
                    _INSERT_LEDGER_SQL,
                    (json.dumps(row, default=str),),
                )
            con.commit()
        finally:
            con.close()

    def _load_open_ledger(self) -> list[dict[str, Any]]:
        db = model_db_path()
        if db is None:
            return []
        con = sqlite3.connect(str(db))
        try:
            # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- _SELECT_OPEN_LEDGER_SQL is built from the constant LEDGER_TABLE with a bound ? value.
            rows = con.execute(
                _SELECT_OPEN_LEDGER_SQL,
                ('%"settled": null%',),
            ).fetchall()
        finally:
            con.close()
        out = []
        for rid, data in rows:
            try:
                row = json.loads(data)
                row["_ledger_id"] = rid
                out.append(row)
            except Exception:  # noqa: BLE001
                continue
        return out

    def _mark_settled(self, ledger_id: int, result: str, profit: float) -> None:
        db = model_db_path()
        if db is None:
            return
        con = sqlite3.connect(str(db))
        try:
            # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- _SELECT_LEDGER_BY_ID_SQL is built from the constant LEDGER_TABLE with a bound ? value.
            row = con.execute(_SELECT_LEDGER_BY_ID_SQL, (ledger_id,)).fetchone()
            if not row:
                return
            data = json.loads(row[0])
            data["settled"] = utc_now_iso()
            data["result"] = result
            data["profit"] = round(profit, 4)
            # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- _UPDATE_LEDGER_SQL is built from the constant LEDGER_TABLE with a bound ? value.
            con.execute(_UPDATE_LEDGER_SQL, (json.dumps(data, default=str), ledger_id))
            con.commit()
        finally:
            con.close()

    async def settle(self, sport: str = "NBA") -> dict[str, Any]:
        """Settle open ledger rows against REAL scores via the Scores API."""
        import sys as _sys

        broker_root: Path | None = None
        here = Path(__file__).resolve()
        for parent in here.parents:
            candidate = parent / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            candidate = parent / "Draymond-Orchestrator" / "agents" / "Sports-Steve-main" / "src"
            if (candidate / "brokers" / "oddsapi.py").exists():
                broker_root = candidate
                break
            if parent.name == "Uplift":
                break
        if broker_root is None:
            return {"status": "unavailable", "reason": "broker not found", "evidence_tier": "E4", "modeled": False}
        if str(broker_root) not in _sys.path:
            _sys.path.insert(0, str(broker_root))
        if str(broker_root.parent) not in _sys.path:
            _sys.path.insert(0, str(broker_root.parent))
        from brokers.oddsapi import OddsApiBroker  # type: ignore

        open_rows = self._load_open_ledger()
        if not open_rows:
            return {"status": "ok", "settled": 0, "open": 0, "evidence_tier": "E3", "modeled": True}
        async with OddsApiBroker(api_key=self.api_key) as broker:
            scores = await broker.get_scores(sport, days_from=3)
        # index completed scores by event_id
        completed = {}
        for g in scores:
            if g.get("completed") and g.get("scores"):
                completed[g["id"]] = g["scores"]
        settled = 0
        for row in open_rows:
            ev_id = row.get("event_id", "")
            scores_map = completed.get(ev_id)
            if not scores_map:
                continue
            # determine home/away pts from scores list
            pts = {}
            for s in scores_map:
                name = s.get("name", "")
                if name in (row.get("home"), row.get("away")):
                    pts[name] = s.get("score")
            home_pts = pts.get(row.get("home"))
            away_pts = pts.get(row.get("away"))
            if home_pts is None or away_pts is None:
                continue
            home_won = int(home_pts) > int(away_pts)
            direction = row.get("direction")
            win = (direction == "home" and home_won) or (direction == "away" and not home_won)
            # price is American; convert to profit per 1 unit
            price = row.get("price")
            profit = self._american_profit(price, win)
            self._mark_settled(row["_ledger_id"], "win" if win else "loss", profit)
            settled += 1
        return {
            "status": "ok",
            "settled": settled,
            "open": len(open_rows) - settled,
            "evidence_tier": "E2",
            "modeled": True,
            "generated_at": utc_now_iso(),
        }

    @staticmethod
    def _american_profit(price: Any, win: bool) -> float:
        if not win:
            return -1.0
        try:
            a = float(price)
        except (TypeError, ValueError):
            return 0.9091
        if a > 0:
            return a / 100.0
        if a < 0:
            return 100.0 / abs(a)
        return 0.9091


async def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Live NBA player-prop edge test")
    parser.add_argument("--sport", default="NBA")
    parser.add_argument("--max", dest="max_legs", type=int, default=200)
    parser.add_argument("--edge", type=float, default=0.03)
    args = parser.parse_args()
    engine = LivePropEngine(edge_threshold=args.edge)
    if not engine.available():
        print(json.dumps({
            "ok": False,
            "reason": "Odds API key not set (set THE_ODDS_API_KEY or add to Keywire) "
                      "or NBA game-log dataset missing",
            "evidence_tier": "E4",
        }, default=str))
        return 1
    result = await engine.run(sport=args.sport, max_legs=args.max_legs)
    print(json.dumps(result, default=str))
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(asyncio.run(_main()))