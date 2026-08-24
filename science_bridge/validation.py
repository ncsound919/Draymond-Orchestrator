# science_bridge/validation.py
"""Shared seam for scientific rigor validation utilities.

This module is the single import point for cross-platform code needing
determinism verification, honesty gates (structured E4 unavailable results),
out-of-sample predictor validation, and RO-Crate-lite provenance. It re-exports
the one implementation living in `sports_science.validation_engine` — do not
duplicate logic here or in the pillar copy.
"""
try:
    from ..sports_science.validation_engine import (
        RO_CRATE_CONTEXT,
        UnavailableResult,
        canonical_json,
        is_unavailable,
        provenance_record,
        reproducibility_debt,
        require_honest,
        sha256_of,
        utc_now_iso,
        validate_predictor,
        verify_determinism,
    )
except ImportError:  # science_bridge imported as a top-level package
    from sports_science.validation_engine import (  # noqa: F401
        RO_CRATE_CONTEXT,
        UnavailableResult,
        canonical_json,
        is_unavailable,
        provenance_record,
        reproducibility_debt,
        require_honest,
        sha256_of,
        utc_now_iso,
        validate_predictor,
        verify_determinism,
    )

__all__ = [
    "RO_CRATE_CONTEXT",
    "UnavailableResult",
    "canonical_json",
    "is_unavailable",
    "provenance_record",
    "reproducibility_debt",
    "require_honest",
    "sha256_of",
    "utc_now_iso",
    "validate_predictor",
    "verify_determinism",
]
