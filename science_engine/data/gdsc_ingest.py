# science_engine/data/gdsc_ingest.py
"""GDSC drug-response ingestion: real cancer cell-line drug sensitivities -> biotech profiles.

Reads the GDSC2 drug-response CSV (LN_IC50, AUC per cell line x drug) and
aggregates each cell line into the tumor/patient dict the biotech analysis
runner consumes. Drug response feeds resistance / treatment-toxicity signal:
  lower LN_IC50 (higher sensitivity) -> lower ctdna / higher shrinkage proxy.

Output: one JSON profile per cell line under datasets/biotech/gdsc/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "kaggle" / "gdsc"
DEFAULT_OUTPUT = REPO / "datasets" / "biotech" / "gdsc" / "profiles"


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def gdsc_to_engine(line: dict, cell: dict) -> dict:
    """Build one engine profile from an aggregated cell-line record."""
    n = max(1, cell["count"])
    avg_ic50 = cell["ic50_sum"] / n
    avg_auc = cell["auc_sum"] / n
    # LN_IC50 < 0 means high sensitivity (lower concentration needed). Normalize
    # to a 0-100 "drug sensitivity" score; resistance is the inverse.
    sensitivity = max(0.0, min(100.0, -avg_ic50 * 20.0))
    tcga = str(cell.get("tcga") or "Unknown")
    return {
        "patient_id": f"gdsc_{cell['name']}",
        "cancer_type": tcga,
        "subtype": "cell-line",
        "overall_survival_months": 0.0,
        "death_from_cancer": "N/A",
        "tumor": {
            "ki67": sensitivity,
            "apoptotic_index": max(0.0, min(100.0, 100.0 - avg_auc)),
            "microvessel_density": 50.0,
            "ctc_count": min(20.0, cell["drug_count"] / 10.0),
            "mutational_burden": min(100.0, cell["drug_count"]),
            "immune_infiltrate": 50.0,
        },
        "clinical": {
            "tumor_size_cm": 2.0,
            "grade": 2,
            "age": 55.0,
            "receptor_status": {"ER_positive": False, "HER2_positive": False},
        },
        "treatment": {
            "ctdna": max(0.0, min(1.0, (100.0 - sensitivity) / 100.0)),
            "tumor_shrinkage_pct": max(0, min(100, round(sensitivity))),
            "time_point_months": 6,
        },
        "source": "gdsc2",
        "metadata": {
            "cell_line": cell["name"],
            "drugs_screened": cell["drug_count"],
            "avg_ln_ic50": round(avg_ic50, 4),
            "avg_auc": round(avg_auc, 4),
            "drugs": cell["drugs"][:8],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest GDSC drug response into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("GDSC2-dataset.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no GDSC2 CSV found", "input": str(args.input)}))
        return 1

    cells: dict[str, dict] = defaultdict(lambda: {"ic50_sum": 0.0, "auc_sum": 0.0, "count": 0, "drug_count": 0, "drugs": set(), "tcga": ""})
    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = str(row.get("CELL_LINE_NAME", "")).strip()
            if not name:
                continue
            c = cells[name]
            c["ic50_sum"] += _f(row.get("LN_IC50"))
            c["auc_sum"] += _f(row.get("AUC"))
            c["count"] += 1
            c["drug_count"] += 1
            drug = str(row.get("DRUG_NAME", "")).strip()
            if drug:
                c["drugs"].add(drug)
            if not c["tcga"]:
                c["tcga"] = str(row.get("TCGA_DESC", "")).strip()

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for name, cell in sorted(cells.items()):
        if args.limit and written >= args.limit:
            break
        cell["name"] = name
        cell["drugs"] = sorted(cell["drugs"])
        profile = gdsc_to_engine(None, cell)
        out = args.output / f"{cell['name']}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(cells), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
