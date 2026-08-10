# biotech_science/adapters/omics.py
"""Single-cell omics adapter (scanpy / anndata / decoupler).

Graceful-degradation contract: E1 when the heavy libs are installed, E3 with a
clear message otherwise. Mirrors the sports adapters' pattern.
"""
from __future__ import annotations

from typing import Any


class OmicsAdapter:
    def __init__(self) -> None:
        self._scanpy = None
        self._anndata = None
        self._decoupler = None
        try:
            import scanpy as sc  # type: ignore
            self._scanpy = sc
        except Exception:  # noqa: BLE001
            self._scanpy = None
        try:
            import anndata as ad  # type: ignore
            self._anndata = ad
        except Exception:  # noqa: BLE001
            self._anndata = None
        try:
            import decoupler as dc  # type: ignore
            self._decoupler = dc
        except Exception:  # noqa: BLE001
            self._decoupler = None

    @property
    def available(self) -> bool:
        return self._anndata is not None

    def summarize(self, h5ad_path: str) -> dict:
        """Summarize a single-cell dataset: n cells, n genes, basic stats."""
        if self._anndata is None:
            return {
                "source": "omics",
                "evidence_tier": "E3",
                "data": {"error": "anndata not installed — install scanpy/anndata for omics support"},
            }
        try:
            import anndata as ad
            adata = ad.read_h5ad(h5ad_path)
            return {
                "source": "omics",
                "evidence_tier": "E1",
                "data": {
                    "n_cells": int(adata.n_obs),
                    "n_genes": int(adata.n_vars),
                    "layers": list(adata.layers.keys()) if adata.layers else [],
                    "obs_columns": list(adata.obs.columns)[:20],
                },
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "source": "omics",
                "evidence_tier": "E3",
                "data": {"error": f"failed to read h5ad: {exc}"},
            }

    def pathway_activity(self, counts_matrix: Any, genes: list[str] | None = None) -> dict:
        """Infer pathway activity from an expression matrix (decoupler)."""
        if self._decoupler is None or self._anndata is None:
            return {
                "source": "omics",
                "evidence_tier": "E3",
                "data": {"error": "decoupler not installed — install decoupler for pathway inference"},
            }
        return {
            "source": "omics",
            "evidence_tier": "E3",
            "data": {"note": "pathway inference requires expression AnnData + decoupler run_mlm"},
        }
