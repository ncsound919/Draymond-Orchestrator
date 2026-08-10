# sports_science/ingest.py
import csv
import json

import requests

from sports_science.adapters.boxing import normalize_boxrec_row

NBA_STATS_API = "https://stats.nba.com/stats/playergamelogs"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
}


def _as_float(value):
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def normalize_performance_row(row):
    fga = _as_float(row.get("FGA"))
    tpa = _as_float(row.get("3PA"))
    reb = _as_float(row.get("REB"))
    fg = _as_float(row.get("FGM")) / fga * 100.0 if fga else 0.0
    tp = _as_float(row.get("3PM")) / tpa * 100.0 if tpa else 0.0
    return {
        "pts": round(_as_float(row.get("PTS")), 4),
        "ast": round(_as_float(row.get("AST")), 4),
        "reb": round(reb, 4),
        "oreb": round(reb, 4),
        "tov": round(-_as_float(row.get("TOV")), 4),
        "pf": round(-_as_float(row.get("PF")), 4),
        "fgm": round(_as_float(row.get("FGM")), 4),
        "fga": round(fga, 4),
        "tpm": round(_as_float(row.get("3PM")), 4),
        "tpa": round(tpa, 4),
        "fg": round(fg, 4),
        "tp": round(tp, 4),
    }


def fetch_nba_player_game_log(player_id, season):
    if not player_id:
        raise ValueError("player_id is required")
    params = {
        "PlayerID": player_id,
        "Season": season,
        "SeasonType": "Regular Season",
        "PerMode": "PerGame",
    }
    resp = requests.get(NBA_STATS_API, params=params, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    result_set = resp.json()["resultSets"][0]
    headers = result_set["headers"]
    return [
        normalize_performance_row(dict(zip(headers, row)))
        for row in result_set["rowSet"]
    ]


def ingest_biometrics(path):
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return {
        "hrv": _as_float(data.get("hrv")),
        "load": _as_float(data.get("load")),
        "acute_chronic": _as_float(data.get("acute_chronic")),
        "sleep_hrs": _as_float(data.get("sleep_hrs")),
    }


def _coerce(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return float(value)
        except (TypeError, ValueError):
            return value


def load_csv_rows(path):
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            rows.append({k: _coerce(v) for k, v in row.items()})
    return rows


def normalize_football_row(row):
    return {
        "goals": _as_float(row.get("goals")),
        "assists": _as_float(row.get("assists")),
        "shots": _as_float(row.get("shots")),
        "distance_km": _as_float(row.get("distance_km")),
        "sprints": _as_float(row.get("sprints")),
    }


def normalize_boxing_row(row):
    return normalize_boxrec_row(row)
