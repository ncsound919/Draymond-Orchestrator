# sports_science/datasets_config.py
"""Dataset discovery + configuration for the bbtech sports model bridge.

Single source of truth for where the real sports datasets live. The model and
the Sports Steve bridge both resolve paths here (no hardcoded per-module
paths). Env overrides win; otherwise known ecosystem locations are searched.

Sources:
  * NBA_SQLITE            — nba.sqlite team warehouse (1950-2023) [fallback]
  * NBA_MODEL_DB          — consolidated sports_model.db built by
                            prepare_datasets.py from the ehallmar kaggle set:
                            player game logs + historical betting lines
  * SPORTS_DATASETS_DIR   — the datasets/ dir (fallback discovery root)
"""
from __future__ import annotations

import os
from pathlib import Path

_HERE = Path(__file__).resolve()


def datasets_root() -> Path | None:
    """Locate the ecosystem datasets/ dir (the one holding the kaggle sets).

    Walks up from this module; a candidate only counts if it actually contains
    the kaggle datasets (ehallmar or thedevastator), so the Draymond runtime
    copy resolves to the real store instead of its own empty datasets/ dir.
    """
    env = os.environ.get("SPORTS_DATASETS_DIR")
    if env:
        p = Path(env)
        return p if p.is_dir() else None
    for parent in _HERE.parents:
        candidate = parent / "datasets"
        if candidate.is_dir() and (
            (candidate / "ehallmar__nba-historical-stats-and-betting-data").is_dir()
            or (candidate / "thedevastator__nba-game-elo-and-carmelo-ratings-1946-2020").is_dir()
        ):
            return candidate
        if parent.name == "Uplift":
            break
    return None


def ehallmar_dir() -> Path | None:
    env = os.environ.get("EHALLMAR_DIR")
    if env:
        p = Path(env)
        return p if p.is_dir() else None
    root = datasets_root()
    if root is None:
        return None
    p = root / "ehallmar__nba-historical-stats-and-betting-data"
    return p if p.is_dir() else None


def nba_sqlite_path() -> Path | None:
    env = os.environ.get("NBA_SQLITE_PATH")
    if env:
        p = Path(env)
        return p if p.exists() else None
    root = datasets_root()
    if root is None:
        return None
    p = root / "sports-datasets" / "nba.sqlite"
    if p.exists():
        return p
    p2 = Path(__file__).resolve().parent.parent / "sports-datasets" / "nba.sqlite"
    return p2 if p2.exists() else None


def model_db_path() -> Path | None:
    """Path to the consolidated sports_model.db (may not exist until
    prepare_datasets.py has been run). Searches the pillar source too, so the
    Draymond runtime copy can read the shared store instead of duplicating it."""
    env = os.environ.get("NBA_MODEL_DB")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    candidates = [
        here.parent / "sports_model.db",
        here.parent.parent / "sports-datasets" / "sports_model.db",
    ]
    for parent in here.parents:
        candidate = parent / "02_Pillars" / "Overlay Science" / "Sports" / "sports_science" / "sports_model.db"
        candidates.append(candidate)
        if parent.name == "Uplift":
            break
    for c in candidates:
        if c.exists():
            return c
    # Default write location: next to the package.
    return here.parent / "sports_model.db"


def required_datasets_present() -> bool:
    """True when at least the team warehouse OR the consolidated model db is
    available (the model degrades honestly when neither exists)."""
    return nba_sqlite_path() is not None or (
        model_db_path() is not None and model_db_path().exists()
    )