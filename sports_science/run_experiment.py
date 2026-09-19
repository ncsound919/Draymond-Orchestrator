# sports_science/run_experiment.py
"""CLI: run the betting experiment & simulation pipeline.

  python sports_science/run_experiment.py [--from 2010-01-01] [--to 2018-06-01]
      [--max 14000]

Output: machine-readable JSON {ok, kind, domain, metrics, evidence_tier,
generated_at} following the Draymond derived-metrics contract so the trends
store can persist it (source='bbtech_betting_experiment', metricKind='derived').
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.betting_pipeline import run_experiment, run_forward_test  # noqa: E402
from sports_science.validation_engine import utc_now_iso  # noqa: E402


def _metrics(results) -> list[dict]:
    out = []
    for r in results:
        out.append({
            "name": f"betting_experiment.{r.name}",
            "value": r.roi if r.roi is not None else r.concordance,
            "unit": "roi" if r.roi is not None else "c_index",
            "brier": r.brier,
            "concordance": r.concordance,
            "ci_low": r.ci_low,
            "ci_high": r.ci_high,
            "calibration_error": r.calibration_error,
            "model_market_gap": r.gap,
            "gap_p_positive": r.gap_p_positive,
            "roi": r.roi,
            "roi_p_positive": r.roi_p_positive,
            "bets": r.bets,
            "n": r.n,
            "verdict": r.verdict,
            "evidence_tier": "E2" if (r.bets >= 500 and r.roi is not None and r.roi > 0) else "E3",
            "modeled": True,
        })
    return out


def _main() -> int:
    parser = argparse.ArgumentParser(description="Overlay Science betting experiment pipeline")
    parser.add_argument("--from", dest="from_date", default="2010-01-01")
    parser.add_argument("--to", dest="to_date", default="2018-06-01")
    parser.add_argument("--max", dest="max_games", type=int, default=14000)
    parser.add_argument("--forward", action="store_true",
                        help="forward-test on the unseen 2019-2026 window (confirm or kill retrospective edges)")
    args = parser.parse_args()
    try:
        if args.forward:
            results, report = run_forward_test(
                from_date=args.from_date, to_date=args.to_date, max_games=args.max_games
            )
        else:
            results, report = run_experiment(
                from_date=args.from_date, to_date=args.to_date, max_games=args.max_games
            )
        metrics = _metrics(results)
        for m in metrics:
            m["name"] = m["name"].replace("betting_experiment.", "betting_experiment.forward." if args.forward else "betting_experiment.")
        tiers = ["E1", "E2", "E3", "E4"]
        worst = None
        for m in metrics:
            t = m.get("evidence_tier")
            if isinstance(t, str) and t in tiers:
                if worst is None or tiers.index(t) > tiers.index(worst):
                    worst = t
        output = {
            "ok": True,
            "kind": "betting_experiment" + (".forward" if args.forward else ""),
            "domain": "sports",
            "metrics": metrics,
            "evidence_tier": worst or "E3",
            "report": report,
            "generated_at": utc_now_iso(),
        }
        print(json.dumps(output, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())