# science_engine/data/oncology_ingest.py
"""Lung cancer patient ingestion: real clinical/demographic/survival rows -> biotech profiles.

Reads the lung_cancer_dataset.csv and maps each patient row (stage, tumor size,
metastasis, smoking, survival) into the tumor/patient dict the biotech analysis
runner consumes. Output: one JSON profile per patient under
datasets/biotech/oncology/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "kaggle" / "oncology"
DEFAULT_OUTPUT = REPO / "datasets" / "biotech" / "oncology" / "profiles"


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _yes(v: Any) -> bool:
    return str(v or "").strip().lower() in ("yes", "y", "true", "1")


def oncology_to_engine(r: dict) -> dict:
    stage = int(_f(r.get("Cancer_Stage", "I").replace("Stage ", "").replace("IV", "4").replace("III", "3").replace("II", "2").replace("I", "1")) or 1)
    tumor_size = _f(r.get("Tumor_Size_cm"))
    metastasis = _yes(r.get("Metastasis"))
    smoking = _f(r.get("Years_Smoking"))
    genetic_mutation = _yes(r.get("Genetic_Mutation"))
    subtype = str(r.get("NSCLC_Subtype", "")).strip()
    return {
        "patient_id": str(r.get("Patient_ID", "")),
        "cancer_type": "Lung Cancer",
        "subtype": subtype or "nsclc",
        "overall_survival_months": _f(r.get("Survival_Months")),
        "death_from_cancer": "Died" if _f(r.get("Survived")) == 0 else "Living",
        "tumor": {
            "ki67": min(100.0, tumor_size * 8.0 + smoking * 0.5),
            "apoptotic_index": 50.0,
            "microvessel_density": 50.0,
            "ctc_count": min(20.0, (tumor_size * 2.0 if metastasis else tumor_size * 0.5)),
            "mutational_burden": min(100.0, 30.0 if genetic_mutation else 10.0),
            "immune_infiltrate": 50.0,
        },
        "clinical": {
            "tumor_size_cm": tumor_size,
            "grade": min(3, max(1, stage)),
            "age": _f(r.get("Age")),
            "receptor_status": {"ER_positive": False, "HER2_positive": False},
        },
        "treatment": {
            "ctdna": min(1.0, (stage * 0.2 + (0.3 if metastasis else 0.0))),
            "tumor_shrinkage_pct": max(0, 100 - stage * 20),
            "time_point_months": 6,
        },
        "source": "lung-cancer-uci",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest lung cancer patients into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("lung_cancer_dataset.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no lung cancer CSV found", "input": str(args.input)}))
        return 1

    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for r in rows:
        if args.limit and written >= args.limit:
            break
        profile = oncology_to_engine(r)
        out = args.output / f"{profile['patient_id'] or 'p' + str(written)}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(rows), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
