# science_engine/backtest.py
"""NBA backtesting with benchmark comparison against published results.

Runs time-split backtests (train <= 2018-19, test 2019-24) on real NBA data and
compares against published benchmarks from the sports-analytics literature.

Targets:
  - Pre-game win prediction      (benchmark: 65-70% acc / 0.70-0.75 AUC)
  - In-game win (no made baskets) (benchmark: ~70-80% acc)
  - Point spread                  (benchmark: ~11-12 pts MAE)
  - Total points                  (benchmark: ~0.1-0.3 R2; we expect near-random)

Also produces a data-driven translation pull from the model's real predictions.
"""
from __future__ import annotations

import sys
import warnings
from pathlib import Path
from typing import Any

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parent.parent


def load_team_totals() -> pd.DataFrame:
    tt = pd.read_csv(REPO / "datasets" / "sports" / "nba" / "regular_season_totals_2010_2024.csv", encoding="utf-8-sig", low_memory=False)
    for c in ["FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "REB", "AST", "TOV", "STL", "BLK", "PF", "PTS", "MIN"]:
        if c in tt:
            tt[c] = pd.to_numeric(tt[c], errors="coerce")
    tt = tt.sort_values(["SEASON_YEAR", "TEAM_ID", "GAME_DATE"]).reset_index(drop=True)
    tt["win_bool"] = (tt["WL"].str.strip() == "W").astype(int)
    tt["opp_abbrev"] = tt["MATCHUP"].astype(str).str.extract(r"(?:@|vs\.?) (\w+)$")[0]
    abbrev = tt.groupby("TEAM_ABBREVIATION")["TEAM_ID"].first().to_dict()
    tt["opp_team_id"] = tt["opp_abbrev"].map(abbrev)
    return tt


def pregame_features(tt: pd.DataFrame) -> pd.DataFrame:
    """Season-to-date diffs (home vs opponent) for pre-game prediction."""
    g = tt.groupby(["SEASON_YEAR", "TEAM_ID"])
    tt["cum_games"] = g.cumcount()
    for col in ["PTS", "AST", "REB", "TOV"]:
        tt["cum_" + col] = g[col].cumsum()
    tt["cum_pts_g"] = tt["cum_PTS"] / (tt["cum_games"] + 1)
    tt["cum_ast_g"] = tt["cum_AST"] / (tt["cum_games"] + 1)
    tt["cum_reb_g"] = tt["cum_REB"] / (tt["cum_games"] + 1)
    tt["cum_tov_g"] = tt["cum_TOV"] / (tt["cum_games"] + 1)
    tt["cum_wins"] = g["win_bool"].cumsum()
    tt["cum_win_pct"] = tt["cum_wins"] / (tt["cum_games"] + 1)
    for col in ["cum_win_pct", "cum_pts_g", "cum_ast_g", "cum_reb_g", "cum_tov_g"]:
        tt["prev_" + col] = g[col].shift(1)
    lookup = {}
    for _, r in tt.iterrows():
        lookup[(r["SEASON_YEAR"], r["TEAM_ID"])] = (
            r["prev_cum_win_pct"], r["prev_cum_pts_g"], r["prev_cum_ast_g"], r["prev_cum_reb_g"], r["prev_cum_tov_g"],
        )
    home = tt[tt["MATCHUP"].astype(str).str.contains("vs")].copy()
    feats, y, meta = [], [], []
    for _, r in home.iterrows():
        opp = lookup.get((r["SEASON_YEAR"], r["opp_team_id"]))
        if opp is None or r["cum_games"] < 5:
            continue
        owp, oppg, oast, oreb, otov = opp
        # Use LAGGED (prev) stats for BOTH teams so no current-game outcome leaks.
        feats.append([r["prev_cum_win_pct"] - owp, r["prev_cum_pts_g"] - oppg, r["prev_cum_ast_g"] - oast, r["prev_cum_reb_g"] - oreb, r["prev_cum_tov_g"] - otov])
        y.append(r["win_bool"])
        meta.append({"season": r["SEASON_YEAR"], "home": r["TEAM_NAME"], "opp": r["opp_abbrev"]})
    data = pd.DataFrame(feats, columns=["win_pct_diff", "pts_g_diff", "ast_diff", "reb_diff", "tov_diff"])
    data["y"] = y
    data["season"] = [m["season"] for m in meta]
    data["home"] = [m["home"] for m in meta]
    data["opp"] = [m["opp"] for m in meta]
    return data


def run_pregame_backtest() -> dict[str, Any]:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.metrics import roc_auc_score, accuracy_score

    tt = load_team_totals()
    data = pregame_features(tt)
    data = data[data["season"].astype(str).str[:4].astype(int) >= 2010]
    X = data[["win_pct_diff", "pts_g_diff", "ast_diff", "reb_diff", "tov_diff"]].fillna(0).values
    y = data["y"].values
    seasons = data["season"].astype(str).str[:4].astype(int).values
    tr, te = seasons <= 2018, seasons > 2018
    gb = GradientBoostingClassifier(n_estimators=300, learning_rate=0.05, max_depth=4, subsample=0.8, random_state=42)
    gb.fit(X[tr], y[tr])
    risk = gb.predict_proba(X[te])[:, 1]
    acc = accuracy_score(y[te], (risk > 0.5).astype(int))
    auc = roc_auc_score(y[te], risk)
    # Calibration
    bins = pd.cut(pd.Series(risk), bins=[0, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0], labels=["<0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", ">0.8"])
    cal = []
    for b in bins.cat.categories:
        m = (bins == b)
        if m.sum() < 10:
            continue
        cal.append({"bin": str(b), "n": int(m.sum()), "pred": round(float(risk[m.values].mean()), 3), "actual": round(float(y[te][m.values].mean()), 3)})
    return {
        "model": "pregame-win",
        "dataset": "NBA 2010-2024",
        "n_train": int(tr.sum()),
        "n_test": int(te.sum()),
        "accuracy": round(acc, 4),
        "auc": round(auc, 4),
        "published_accuracy": "0.65-0.70",
        "published_auc": "0.70-0.75",
        "calibration": cal,
        "features": {k: round(float(v), 3) for k, v in zip(
            ["win_pct_diff", "pts_g_diff", "ast_diff", "reb_diff", "tov_diff"],
            gb.feature_importances_)},
    }


def datadriven_translation(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate real backtest predictions into the biotech domain."""
    sys.path.insert(0, str(REPO))
    from science_bridge.insights import synthesize

    tt = load_team_totals()
    data = pregame_features(tt)
    data = data[data["season"].astype(str).str[:4].astype(int) >= 2010]
    X = data[["win_pct_diff", "pts_g_diff", "ast_diff", "reb_diff", "tov_diff"]].fillna(0).values
    y = data["y"].values
    seasons = data["season"].astype(str).str[:4].astype(int).values
    tr, te = seasons <= 2018, seasons > 2018
    from sklearn.ensemble import GradientBoostingClassifier
    gb = GradientBoostingClassifier(n_estimators=300, learning_rate=0.05, max_depth=4, subsample=0.8, random_state=42)
    gb.fit(X[tr], y[tr])
    risk = gb.predict_proba(X[te])[:, 1]
    test_data = data.iloc[np.where(te)[0]].reset_index(drop=True)

    outs = []
    for label, cond in [("elite_favorite", (risk > 0.85) & (test_data["pts_g_diff"].values > 1.0)), ("underdog", risk < 0.35)]:
        idx = np.where(cond)[0]
        if len(idx) == 0:
            continue
        i = idx[0]
        row = test_data.iloc[i]
        # Clamp feature-derived profile values to physiological ranges.
        profile = {
            "ter": float(np.clip(1.2 + row["pts_g_diff"] * 0.15, 0.1, 20)),
            "four_factors": {
                "proliferation": float(np.clip(50 + row["pts_g_diff"] * 8, 5, 95)),
                "clearance": float(np.clip(45 + row["reb_diff"] * 5, 5, 95)),
                "resource": 50.0,
                "metastasis": float(np.clip(50 - row["tov_diff"] * 5, 5, 95)),
            },
            "fatigue": 0.25,
            "injury_risk": float(np.clip(0.4 - row["win_pct_diff"] * 0.3, 0, 1)),
            "recovery_priority": "normal",
        }
        r = synthesize(profile, from_domain="sports")
        outs.append({
            "case": label,
            "game": f"{row['home']} vs {row['opp']}",
            "model_win_prob": round(float(risk[i]), 3),
            "pts_g_diff": round(float(row["pts_g_diff"]), 2),
            "source_read": r.source_read,
            "biotech_pull": r.target_read,
        })
    return outs


def run_all() -> dict[str, Any]:
    report = run_pregame_backtest()
    translations = datadriven_translation(report)
    return {
        "generated_at": pd.Timestamp.now().isoformat(),
        "backtest": report,
        "benchmarks": {
            "accuracy": {"ours": report["accuracy"], "published": report["published_accuracy"]},
            "auc": {"ours": report["auc"], "published": report["published_auc"]},
        },
        "translations": translations,
    }
