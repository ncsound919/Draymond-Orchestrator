# biotech_science/ingest.py
"""Tumor / patient / assay JSON ingestion (mirror of sports_science.ingest).

Normalizes raw clinical inputs into the flat dict the runners and metrics
modules consume. Tolerant of missing fields (defaults), strict on structure.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _f(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_tumor(raw: dict) -> dict:
    """Normalize a raw tumor/patient dict into the standard input shape."""
    perf = raw.get("tumor", raw.get("performance", {}))
    bio = raw.get("biometrics", {})
    rs = raw.get("receptor_status", raw.get("receptors", {}))
    return {
        # four-factors
        "proliferation": _f(perf.get("proliferation", bio.get("proliferation")), 50.0),
        "clearance": _f(perf.get("clearance", bio.get("clearance")), 50.0),
        "angiogenesis": _f(perf.get("angiogenesis", bio.get("angiogenesis")), 50.0),
        "metastasis": _f(perf.get("metastasis", bio.get("metastasis")), 50.0),
        # ter inputs
        "fg": _f(perf.get("fg", bio.get("fg")), 0.0),
        "tp": _f(perf.get("tp", bio.get("tp")), 0.0),
        "ast": _f(perf.get("ast", bio.get("ast")), 0.0),
        "oreb": _f(perf.get("oreb", bio.get("oreb")), 0.0),
        "tov": _f(perf.get("tov", bio.get("tov")), 0.0),
        "pf": _f(perf.get("pf", bio.get("pf")), 0.0),
        "cell_cycle": _f(perf.get("cell_cycle", bio.get("cell_cycle")), 24.0),
        # gravity / flow
        "immune_attention": _f(perf.get("immune_attention", bio.get("immune_attention")), 0.5),
        "tumor_spacing": _f(perf.get("tumor_spacing", bio.get("tumor_spacing")), 0.5),
        "treatment_tempo": _f(perf.get("treatment_tempo", bio.get("treatment_tempo")), 0.5),
        "response_quality": _f(perf.get("response_quality", bio.get("response_quality")), 0.5),
        # clinical
        "tumor_size": _f(perf.get("tumor_size", bio.get("tumor_size")), 2.0),
        "grade": int(_f(perf.get("grade", bio.get("grade")), 2)),
        "age": _f(perf.get("age", bio.get("age")), 55.0),
        "receptor_status": {
            "ER_positive": bool(rs.get("ER_positive", rs.get("ER", False))),
            "HER2_positive": bool(rs.get("HER2_positive", rs.get("HER2", False))),
        },
        "ctdna": _f(perf.get("ctdna", bio.get("ctdna")), 0.0),
        "tumor_shrinkage": _f(perf.get("tumor_shrinkage", bio.get("tumor_shrinkage")), 0.0),
        "time_point": int(_f(perf.get("time_point", bio.get("time_point")), 0)),
        "mutational_burden": _f(perf.get("mutational_burden", bio.get("mutational_burden")), 50.0),
        "immune_infiltrate": _f(perf.get("immune_infiltrate", bio.get("immune_infiltrate")), 50.0),
        "cancer_type": str(raw.get("cancer_type", raw.get("disease", "unknown"))),
    }


def load_dataset(path: Path | str) -> dict:
    """Load + normalize a dataset file (JSON). Raises ValueError on bad structure."""
    p = Path(path)
    if not p.exists():
        raise ValueError(f"dataset not found: {p}")
    try:
        raw = json.loads(p.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in {p}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"dataset root must be an object, got {type(raw).__name__}")
    return normalize_tumor(raw)
