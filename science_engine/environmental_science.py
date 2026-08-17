# science_engine/environmental_science.py
"""Environmental Science Bridge — ECOS initiatives -> research experiments.

Each of the 13 ECOS environmental initiatives is a research SECTOR. This bridge
runs the deterministic science_engine simulation models (enviro-*.json) as the
primary experiment source, and where the ECOS ecosystem-brains Python packages
are installed it ALSO invokes the forecasting / solver / carbon-credit engines
so experiments report freshly-measured, engine-backed findings.

Deterministic + auditable: every number traces to a model output or an engine
recomputation. Same input => same output. Degrades gracefully when optional
packages (prophet, ortools, pulp) are absent — the science_engine models are
pure sympy + numpy and always run.

Output contract (mirrors science_bridge):
  python -m science_engine.environmental_science <sector> [--ticks N]
  python -m science_engine.environmental_science all
Prints machine-readable JSON: {"sector": ..., "findings": {...}, "evidence_tier": ...}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from science_engine.runtime import run_model, load_model  # noqa: E402

# ---- ECOS ecosystem-brains (optional) -----------------------------------------
ECOS_BRAINS = REPO.parent / "01_Platforms" / "ECOS-Environmental-Initiatives" / "packages" / "ecosystem-brains"

try:
    if str(ECOS_BRAINS) not in sys.path:
        sys.path.insert(0, str(ECOS_BRAINS))
    from carbon_credits.registry import calculate_carbon_credit, CarbonEvent  # type: ignore
    CARBON_AVAILABLE = True
except Exception:  # noqa: BLE001
    CARBON_AVAILABLE = False

try:
    from forecasting import (  # type: ignore
        predict_bulb_failure,
        forecast_solar_irradiance,
        forecast_stream_flow,
        forecast_humidity,
    )
    FORECAST_AVAILABLE = True
except Exception:  # noqa: BLE001
    FORECAST_AVAILABLE = False

try:
    from solvers import (  # type: ignore
        optimize_nutrient_cycle,
        optimize_awg_schedule,
        optimize_geothermal_flow,
        optimize_fungal_match,
    )
    SOLVERS_AVAILABLE = True
except Exception:  # noqa: BLE001
    SOLVERS_AVAILABLE = False

# ---- Sector registry -----------------------------------------------------------
# Each sector maps to an ECOS project id + its science_engine model id.
SECTORS = {
    "ecohomes":     {"project": "P01", "model": "enviro-01-ecohomes.json"},
    "agriconnect":  {"project": "P02", "model": "enviro-02-agriconnect.json"},
    "regenerafarm": {"project": "P03", "model": "enviro-03-regenerafarm.json"},
    "hempmobility": {"project": "P04", "model": "enviro-04-hempmobility.json"},
    "lumifreq":     {"project": "P05", "model": "enviro-05-lumifreq.json"},
    "nucleosim":    {"project": "P06", "model": "enviro-06-nucleosim.json"},
    "plasticycle":  {"project": "P07", "model": "enviro-07-plasticycle.json"},
    "everlume":     {"project": "P08", "model": "enviro-08-everlume.json"},
    "aquagen":      {"project": "P09", "model": "enviro-09-aquagen.json"},
    "thermalgrid":  {"project": "P10", "model": "enviro-10-thermalgrid.json"},
    "thoriumos":    {"project": "P11", "model": "enviro-11-thoriumos.json"},
    "solarshare":   {"project": "P12", "model": "enviro-12-solarshare.json"},
    "microhydro":   {"project": "P13", "model": "enviro-13-microhydro.json"},
}


def models_dir() -> Path:
    return Path(__file__).resolve().parent / "models"


def run_sector(sector: str, ticks: int | None = None) -> dict:
    """Run one sector's deterministic simulation + optional engine extras."""
    spec = SECTORS.get(sector)
    if not spec:
        return {"sector": sector, "error": f"unknown sector; known: {', '.join(SECTORS)}"}

    model_file = models_dir() / spec["model"]
    if not model_file.exists():
        return {"sector": sector, "error": f"model missing: {model_file}"}

    try:
        model = load_model(model_file)
        if ticks:
            model["ticks"] = max(1, int(ticks))
        result = run_model(model)
        if result.error:
            return {"sector": sector, "error": result.error, "evidence_tier": result.evidence_tier}
    except Exception as exc:  # noqa: BLE001
        return {"sector": sector, "error": str(exc), "evidence_tier": "E4"}

    findings = {
        "project_id": spec["project"],
        "model_id": result.model_id,
        "ticks": result.ticks,
        "outputs": result.outputs,
        "final_state": result.final_state,
        "events_triggered": [e["action"] for e in result.events],
        "evidence_tier": result.evidence_tier,
        "engines": ["science_engine"],
    }

    # ---- Optional ECOS engine invocations (degrade gracefully) -----------------
    try:
        carbon = _carbon_credit_finding(sector)
        if carbon:
            findings["carbon_credit"] = carbon
            findings["engines"].append("carbon_credits")
    except Exception:  # noqa: BLE001
        pass

    try:
        forecast = _forecast_finding(sector)
        if forecast:
            findings["forecast"] = forecast
            findings["engines"].append("forecasting")
    except Exception:  # noqa: BLE001
        pass

    try:
        solver = _solver_finding(sector)
        if solver:
            findings["solver"] = solver
            findings["engines"].append("solvers")
    except Exception:  # noqa: BLE001
        pass

    return {"sector": sector, "project": spec["project"], "findings": findings, "evidence_tier": result.evidence_tier}


# ---- Carbon credits (IPCC AR6 / Verra / Gold Standard) --------------------------
def _carbon_credit_finding(sector: str) -> dict | None:
    if not CARBON_AVAILABLE:
        return None
    event_map = {
        "solarshare":   ("solar_gen", 120.0),
        "microhydro":   ("hydro_gen", 120.0),
        "thermalgrid":  ("geothermal_saving", 500.0),
        "regenerafarm": ("soil_carbon", 6.0),
        "thoriumos":    ("bio_carbon", 6.0),
    }
    if sector not in event_map:
        return None
    etype, qty = event_map[sector]
    unit = "kwh" if etype in ("solar_gen", "hydro_gen", "geothermal_saving") else "ha"
    event = CarbonEvent(
        project_id=int(SECTORS[sector]["project"][1:]),
        project_code=SECTORS[sector]["project"],
        event_type=etype,
        quantity_kwh_or_kg=qty,
        unit=unit,
    )
    credit = calculate_carbon_credit(event)
    return {
        "event_type": etype,
        "quantity": qty,
        "tonnes_co2e_avoided": credit.tonnes_co2e_avoided,
        "tonnes_co2e_sequestered": credit.tonnes_co2e_sequestered,
        "total_tonnes_co2e": credit.total_tonnes_co2e,
        "verra_methodology": credit.verra_methodology,
        "gold_standard_methodology": credit.gold_standard_methodology,
        "value_usd": credit.estimated_value_usd,
    }


# ---- Forecasting (Prophet / LSTM) ------------------------------------------------
def _forecast_finding(sector: str) -> dict | None:
    if not FORECAST_AVAILABLE:
        return None
    import numpy as np  # noqa: PLC0415
    import pandas as pd  # noqa: PLC0415

    ts = pd.date_range(end="2026-08-17", periods=72, freq="h")
    if sector == "solarshare":
        hist = {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
                "irradiance": (600 + 400 * np.sin(np.arange(72) * 0.3)).tolist(),
                "cloud_cover": (20 + 10 * np.random.RandomState(1).rand(72)).tolist(),
                "temperature": (25 + 5 * np.random.RandomState(2).rand(72)).tolist()}
        return forecast_solar_irradiance(hist, hours_ahead=24)
    if sector == "microhydro":
        hist = {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
                "flow": (0.8 + 0.3 * np.sin(np.arange(72) * 0.2)).tolist(),
                "precipitation": (2 + np.random.RandomState(3).rand(72)).tolist(),
                "temperature": (18 + 3 * np.random.RandomState(4).rand(72)).tolist()}
        return forecast_stream_flow(hist, hours_ahead=24)
    if sector == "aquagen":
        hist = {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
                "humidity": (60 + 15 * np.sin(np.arange(72) * 0.2)).tolist(),
                "temperature": (24 + 4 * np.random.RandomState(5).rand(72)).tolist()}
        return forecast_humidity(hist, hours_ahead=6)
    if sector == "everlume":
        return predict_bulb_failure({"voltage": 12.4, "thermal_cycles": 2400.0, "uptime": 26000.0})
    return None


# ---- Solvers (OR-Tools / PuLP) -----------------------------------------------------
def _solver_finding(sector: str) -> dict | None:
    if not SOLVERS_AVAILABLE:
        return None
    if sector == "regenerafarm":
        return optimize_nutrient_cycle(
            {"N": 30.0, "P": 15.0, "K": 20.0},
            {"N": 22.0, "P": 10.0, "K": 15.0},
        )
    if sector == "aquagen":
        return optimize_awg_schedule([65.0, 72.0, 78.0, 74.0, 66.0, 58.0], [0.18, 0.14, 0.12, 0.13, 0.16, 0.20], 20.0)
    if sector == "thermalgrid":
        return optimize_geothermal_flow({"b1": 180.0, "b2": 220.0, "b3": 150.0}, 12.0, 520.0)
    if sector == "agriconnect":
        return optimize_fungal_match({"pH": 6.4, "moisture": 55.0, "temp": 21.0})
    return None


def run_all() -> dict:
    results = {}
    for sector in SECTORS:
        r = run_sector(sector)
        results[sector] = r
    return {"sectors": results}


def _main() -> int:
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(description="Environmental science bridge (13 ECOS sectors)")
    parser.add_argument("sector", help="sector name or 'all'")
    parser.add_argument("--ticks", type=int, default=None, help="override model ticks")
    args = parser.parse_args()

    try:
        if args.sector == "all":
            out = run_all()
        else:
            out = run_sector(args.sector, args.ticks)
        print(json.dumps(out, default=str))
        return 0 if "error" not in out else 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
