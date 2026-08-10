# biotech_science/translation/__init__.py
"""Bidirectional sports <-> biotech translation core.

Thin re-export shim over the shared `science_bridge` seam (single source of
truth). Both platforms import the same tables/engine from science_bridge.
"""
from __future__ import annotations

import sys
from pathlib import Path

_BRIDGE = Path(__file__).resolve().parent.parent.parent / "science_bridge"
if str(_BRIDGE) not in sys.path:
    sys.path.insert(0, str(_BRIDGE))

from science_bridge.translation.engine import (  # noqa: E402, F401
    BiotechTranslationEngine,
    TranslationResult,
)

__all__ = ["BiotechTranslationEngine", "TranslationResult"]
