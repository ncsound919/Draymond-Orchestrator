"""Adapters wrapping existing sports-domain engines."""
from sports_science.adapters.playgene import PlaygeneAdapter
from sports_science.adapters.boxing import BoxingAdapter
from sports_science.adapters.mathx import MathXAdapter
from sports_science.adapters.vision import ShotDetectionAdapter

__all__ = [
    "PlaygeneAdapter",
    "BoxingAdapter",
    "MathXAdapter",
    "ShotDetectionAdapter",
]
