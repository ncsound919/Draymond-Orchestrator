# science_engine
"""Deterministic simulation runtime for the unified research engine.

Loads JSON ticked state-machine models, evaluates update rules with sympy,
and executes them deterministically. Both the sports and biotech platforms use
this runtime for experiments and simulations.
"""

from .runtime import (  # noqa: F401
    ModelValidationError,
    SimulationResult,
    SimModel,
    load_model,
    run_model,
)

__all__ = ["SimModel", "SimulationResult", "ModelValidationError", "load_model", "run_model"]
