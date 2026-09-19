# sports_science/manifest.py
"""Reproducibility manifest for the sports trust chain.

Mirrors Overlay Oncology's ``lib/research-contract.ts`` ``buildEngineManifest``:

* ``inputsHash``  = SHA-256 of the canonical JSON of the inputs (deterministic),
* ``manifestHash`` = SHA-256 of the manifest minus ``manifestHash`` (a per-run
  anchor; includes ``createdAt`` so it is intentionally NOT stable).

The lockfile (``engine_registry.lock.json``) keys on ``inputsHash`` + ``output``;
the manifest anchors a single run so any drift in engine version, inputs, or
seed is detectable.
"""
from __future__ import annotations

from typing import Any

from sports_science.validation_engine import sha256_of, utc_now_iso

MANIFEST_VERSION = "1"


def build_engine_manifest(
    engine: str,
    engine_version: str,
    inputs: Any,
    seed: int,
    inputs_ref: str = "",
) -> dict[str, Any]:
    """Build the reproducibility manifest for one engine run."""
    inputs_hash = sha256_of(inputs)
    partial: dict[str, Any] = {
        "manifestVersion": MANIFEST_VERSION,
        "engine": engine,
        "engineVersion": engine_version,
        "inputsHash": inputs_hash,
        "inputsRef": inputs_ref,
        "seed": seed,
        "createdAt": utc_now_iso(),
    }
    partial["manifestHash"] = sha256_of(partial)
    return partial


def manifest_for(
    engine: str,
    inputs: Any,
    seed: int,
    inputs_ref: str = "",
) -> dict[str, Any]:
    """Build a manifest for a registered engine, resolving its version from the
    registry. Raises KeyError for unknown engines."""
    from sports_science.engine_registry import ENGINES

    for def_ in ENGINES:
        if def_.name == engine:
            return build_engine_manifest(engine, def_.version, inputs, seed, inputs_ref)
    raise KeyError(f"unknown engine: {engine}")
