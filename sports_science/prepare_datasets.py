# sports_science/prepare_datasets.py
"""ETL: build the consolidated sports_model.db from the raw kaggle datasets.

Inputs (raw, from the ehallmar kaggle set — real historical data):
  * nba_players_game_stats.csv  — 1.27M player game logs (1950-2018)
  * nba_betting_money_line.csv  — 125k real money-line rows across 8 books
  * nba_betting_totals.csv      — real game totals lines

Output: sports_model.db (sqlite) with
  * player_game     — player points/minutes per game, indexed by name
  * game_moneyline  — market-implied home/away win probability per game
  * game_totals     — market-implied over/under probability per game

Run once (or re-run to refresh): python prepare_datasets.py
No LLM, no network. Idempotent — rebuilds the tables atomically.
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.datasets_config import ehallmar_dir, model_db_path  # noqa: E402

CHUNK = 50_000


def american_to_implied(price: str | None) -> float | None:
    """American odds -> win probability (removing the vig, split evenly)."""
    if price is None:
        return None
    try:
        a = float(price)
    except (TypeError, ValueError):
        return None
    if a > 0:
        return 100.0 / (a + 100.0)
    if a < 0:
        return -a / (-a + 100.0)
    return None


def build_player_game(db_path: Path, src_dir: Path) -> int:
    src = src_dir / "nba_players_game_stats.csv"
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS player_game")
    cur.execute(
        """
        CREATE TABLE player_game (
          player_id INTEGER,
          player_name TEXT,
          game_date TEXT,
          team_abbreviation TEXT,
          pts REAL,
          minutes REAL
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_name ON player_game(player_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_date ON player_game(player_name, game_date)")
    n = 0
    with open(src, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            pts = row.get("pts") or "0"
            minutes = row.get("min") or "0"
            try:
                pts_f = float(pts)
                min_f = float(minutes)
            except (TypeError, ValueError):
                continue
            batch.append((
                int(float(row["player_id"])) if row.get("player_id") else 0,
                row.get("player_name", "").strip(),
                (row.get("game_date") or "")[:10],
                row.get("team_abbreviation", "").strip(),
                pts_f,
                min_f,
            ))
            n += 1
            if len(batch) >= CHUNK:
                cur.executemany(
                    "INSERT INTO player_game VALUES (?, ?, ?, ?, ?, ?)", batch
                )
                batch = []
        if batch:
            cur.executemany("INSERT INTO player_game VALUES (?, ?, ?, ?, ?, ?)", batch)
    con.commit()
    con.close()
    return n


def build_moneyline(db_path: Path, src_dir: Path) -> int:
    """Join betting money lines with game results into a market benchmark table.

    game_market: one row per game with home/away abbreviations, date, the
    market-implied home win probability (vig-free, averaged across books) and
    the actual outcome (home_won). This is what the model's market benchmark
    reads — a direct "does the model beat the book?" comparison.
    """
    # team_id -> abbreviation
    team_map: dict[int, str] = {}
    with open(src_dir / "nba_teams_all.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            try:
                team_map[int(row["team_id"])] = row["abbreviation"].strip()
            except (TypeError, ValueError):
                continue
    # game_id -> {home_abbr, away_abbr, game_date, home_won}
    games: dict[str, dict] = {}
    with open(src_dir / "nba_games_all.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            gid = row["game_id"]
            entry = games.setdefault(gid, {})
            try:
                tid = int(row["team_id"])
            except (TypeError, ValueError):
                continue
            abbr = team_map.get(tid)
            if abbr is None:
                continue
            is_home = row.get("is_home") in ("1", "h", "t", "true", "True")
            wl = row.get("wl", "")
            if is_home:
                entry["home"] = abbr
                entry["date"] = (row.get("game_date") or "")[:10]
                entry["home_won"] = 1 if wl == "W" else 0
            else:
                entry["away"] = abbr
                if wl == "W":
                    entry["away_won"] = 1
    # money line aggregation per game (team order in the CSV is arbitrary;
    # match by set membership and map each side's implied prob to home/away)
    agg: dict[str, list[tuple[float, float]]] = {}
    with open(src_dir / "nba_betting_money_line.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            p1 = american_to_implied(row.get("price1"))
            p2 = american_to_implied(row.get("price2"))
            if p1 is None or p2 is None:
                continue
            gid = row["game_id"]
            try:
                t_abbr = team_map[int(row["team_id"])]
                a_abbr = team_map[int(row["a_team_id"])]
            except (KeyError, TypeError, ValueError):
                continue
            g = games.get(gid)
            if not g:
                continue
            home = g.get("home")
            away = g.get("away")
            if home not in (t_abbr, a_abbr) or away not in (t_abbr, a_abbr):
                continue
            p_home = p1 if t_abbr == home else p2
            p_away = p2 if t_abbr == home else p1
            agg.setdefault(gid, []).append((p_home, p_away))

    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS game_market")
    cur.execute(
        """
        CREATE TABLE game_market (
          game_id TEXT,
          game_date TEXT,
          home_abbr TEXT,
          away_abbr TEXT,
          market_home_prob REAL,
          home_won INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_gm_date ON game_market(game_date)")
    rows = []
    for gid, ps in agg.items():
        g = games[gid]
        p_home = sum(p for p, _ in ps) / len(ps)
        p_away = sum(q for _, q in ps) / len(ps)
        total = p_home + p_away
        market_home = p_home / total if total > 0 else 0.5
        rows.append((
            gid, g.get("date", ""), g.get("home", ""), g.get("away", ""),
            market_home, g.get("home_won", 0),
        ))
    cur.executemany("INSERT INTO game_market VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()
    return len(rows)


def build_books(db_path: Path, src_dir: Path) -> int:
    """Per-book money-line table for cross-book (sharp-vs-soft) edge testing.

    game_book: one row per (game, book): home/away abbreviations, date, the
    book's devigged home implied probability and raw American prices, and the
    outcome. Pinnacle (sharpest book) is the reference fair-value proxy; the
    cross-book strategy bets soft-book sides that deviate from it.
    """
    team_map: dict[int, str] = {}
    with open(src_dir / "nba_teams_all.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            try:
                team_map[int(row["team_id"])] = row["abbreviation"].strip()
            except (TypeError, ValueError):
                continue
    games: dict[str, dict] = {}
    with open(src_dir / "nba_games_all.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            gid = row["game_id"]
            entry = games.setdefault(gid, {})
            try:
                tid = int(row["team_id"])
            except (TypeError, ValueError):
                continue
            abbr = team_map.get(tid)
            if abbr is None:
                continue
            is_home = row.get("is_home") in ("1", "h", "t", "true", "True")
            wl = row.get("wl", "")
            if is_home:
                entry["home"] = abbr
                entry["date"] = (row.get("game_date") or "")[:10]
                entry["home_won"] = 1 if wl == "W" else 0
            else:
                entry["away"] = abbr
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS game_book")
    cur.execute(
        """
        CREATE TABLE game_book (
          game_id TEXT,
          game_date TEXT,
          book_name TEXT,
          home_abbr TEXT,
          away_abbr TEXT,
          home_implied_prob REAL,
          home_price REAL,
          away_price REAL,
          home_won INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_gb_game ON game_book(game_id, book_name)")
    rows = []
    with open(src_dir / "nba_betting_money_line.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            p1 = american_to_implied(row.get("price1"))
            p2 = american_to_implied(row.get("price2"))
            if p1 is None or p2 is None or (p1 + p2) <= 0:
                continue
            gid = row["game_id"]
            try:
                t_abbr = team_map[int(row["team_id"])]
                a_abbr = team_map[int(row["a_team_id"])]
            except (KeyError, TypeError, ValueError):
                continue
            g = games.get(gid)
            if not g:
                continue
            home = g.get("home")
            away = g.get("away")
            if home not in (t_abbr, a_abbr) or away not in (t_abbr, a_abbr):
                continue
            p_home = p1 if t_abbr == home else p2
            p_away = p2 if t_abbr == home else p1
            devig_home = p_home / (p_home + p_away)
            price_home = float(row.get("price1") or 0) if t_abbr == home else float(row.get("price2") or 0)
            price_away = float(row.get("price2") or 0) if t_abbr == home else float(row.get("price1") or 0)
            rows.append((
                gid, g.get("date", ""), row.get("book_name", ""),
                home, away, devig_home, price_home, price_away, g.get("home_won", 0),
            ))
    cur.executemany(
        "INSERT INTO game_book VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows
    )
    con.commit()
    con.close()
    return len(rows)


def build_forward(db_path: Path, src_dir: Path) -> int:
    """Forward-test odds (2019-2026) from the chevronronson kaggle set.

    game_forward: game_id, date, home/away abbreviations, closing American
    moneyline prices, home_won. This is the UNSEEN window the betting pipeline
    uses to confirm retrospective edges (PROVISIONAL -> confirmed rule).
    """
    from sports_science.datasets_config import datasets_root

    root = datasets_root()
    src = None
    if root is not None:
        src = root / "chevronronson__nba-stats-dataset" / "csv" / "games_index.csv"
    if src is None or not src.exists():
        return 0
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS game_forward")
    cur.execute(
        """
        CREATE TABLE game_forward (
          game_id TEXT,
          game_date TEXT,
          home_abbr TEXT,
          away_abbr TEXT,
          home_price REAL,
          away_price REAL,
          home_won INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_gf_date ON game_forward(game_date)")
    rows = []
    with open(src, encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            date = (row.get("game_date") or "")[:10]
            if not date or date < "2019-01-01":
                continue
            home = (row.get("home") or "").strip().upper()
            away = (row.get("away") or "").strip().upper()
            winner = (row.get("winner") or "").strip().upper()
            if not home or not away or not winner:
                continue
            home_won = 1 if winner == home else 0
            hp = _american_to_decimal(row.get("odds_home"))
            ap = _american_to_decimal(row.get("odds_away"))
            if hp is None or ap is None:
                continue
            rows.append((row["game_id"], date, home, away, hp, ap, home_won))
    cur.executemany("INSERT INTO game_forward VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()
    return len(rows)


def _american_to_decimal(price: str | None) -> float | None:
    if price is None:
        return None
    try:
        a = float(price)
    except (TypeError, ValueError):
        return None
    if a == 0:
        return None
    if a > 0:
        return 1.0 + a / 100.0
    return 1.0 + 100.0 / abs(a)


def build_totals(db_path: Path, src_dir: Path) -> int:
    src = src_dir / "nba_betting_totals.csv"
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS game_totals")
    cur.execute(
        """
        CREATE TABLE game_totals (
          game_id TEXT,
          team_id INTEGER,
          a_team_id INTEGER,
          total REAL,
          over_implied_prob REAL,
          n_books INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_gt_game ON game_totals(game_id)")
    agg: dict[tuple, list] = {}
    with open(src, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                total = float(row.get("total1"))
            except (TypeError, ValueError):
                continue
            p_over = american_to_implied(row.get("price1"))
            if p_over is None:
                continue
            key = (row["game_id"], row["team_id"], row["a_team_id"])
            agg.setdefault(key, []).append((total, p_over))
    rows = [
        (gid, int(team), int(opp),
         sum(t for t, _ in ts) / len(ts),
         sum(p for _, p in ts) / len(ts), len(ts))
        for (gid, team, opp), ts in agg.items()
    ]
    cur.executemany("INSERT INTO game_totals VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()
    return len(rows)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Build consolidated sports_model.db")
    parser.add_argument("--force", action="store_true", help="rebuild even if present")
    args = parser.parse_args()

    src_dir = ehallmar_dir()
    if src_dir is None:
        print(json_error("ehallmar dataset directory not found (run the kaggle download or set EHALLMAR_DIR)"))
        return 1
    db_path = model_db_path()
    if db_path.exists() and not args.force:
        print(json_error(f"{db_path} already exists; use --force to rebuild"))
        return 1

    db_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        npg = build_player_game(db_path, src_dir)
        nm = build_moneyline(db_path, src_dir)
        nb = build_books(db_path, src_dir)
        nt = build_totals(db_path, src_dir)
        nf = build_forward(db_path, src_dir)
        print(json_ok(str(db_path), npg, nm, nb, nt, nf))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json_error(str(exc)))
        return 1


def json_ok(path: str, npg: int, nm: int, nb: int, nt: int, nf: int) -> str:
    import json
    return json.dumps({
        "ok": True,
        "db_path": path,
        "player_games": npg,
        "moneyline_games": nm,
        "book_lines": nb,
        "totals_games": nt,
        "forward_games": nf,
    })


def json_error(message: str) -> str:
    import json
    return json.dumps({"ok": False, "error": message})


if __name__ == "__main__":
    sys.exit(_main())