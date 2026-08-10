# sports_science/translation/__init__.py
"""Bidirectional sports <-> biotech translation core (shared via science_bridge).

Thin re-export of the shared `science_bridge` seam so the sports platform has
the same translation surface as biotech. Single source of truth lives in
`science_bridge/translation`.
"""
from __future__ import annotations

import sys
from pathlib import Path

_BRIDGE = Path(__file__).resolve().parent.parent.parent / "science_bridge"
if str(_BRIDGE) not in sys.path:
    sys.path.insert(0, str(_BRIDGE))

from science_bridge.translation.engine import (  # noqa: E402, F401
    BiotechTranslationEngine,
    TranslationEngine,
    TranslationResult,
)

__all__ = ["TranslationEngine", "BiotechTranslationEngine", "TranslationResult"]
