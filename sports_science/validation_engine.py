# sports_science/validation_engine.py
"""Scientific rigor engine for the bbtech sports-science stack.

Adopts four patterns from the sibling systems:
  TUM          -> verify_determinism (byte-identical reruns per seed)
  MetaMap      -> UnavailableResult / require_honest (structured E4 instead of
                  fabricated data when an input or dependency is missing)
  Decon        -> validate_predictor (stratified K-fold, Harrell's C with
                  bootstrap CI, decile calibration error, lift vs baseline)
  Biocomposable-> provenance_record / reproducibility_debt (RO-Crate-lite
                  JSON-LD artifacts and Reproducibility-Debt scoring)

Pure standard library. No LLM calls, no network. Every public result carries
an evidence_tier (see evidence.py): E1 measured/deterministic, E2 derived with
statistical support, E3 rule-based/inconclusive, E4 unavailable/unvalidated.
"""
from __future__ import annotations

import functools
import hashlib
import json
import random
from datetime import datetime, timezone
from typing import Any, Callable

RO_CRATE_CONTEXT = "https://w3id.org/ro/crate/1.1/context"

# Volatile record keys excluded from schema-drift counting: they differ on
# every run by construction and carry no reproducibility information.
_VOLATILE_KEYS = ("@id", "created")


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string with Z suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def canonical_json(obj: Any) -> str:
    """Deterministic JSON serialization used for hashing."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def sha256_of(obj: Any) -> str:
    """SHA-256 hex digest of the canonical JSON form of obj."""
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def verify_determinism(
    fn: Callable[[Any], Any],
    seeds,
    serializer: Callable[[Any], str] = json.dumps,
) -> dict[str, Any]:
    """Run fn(seed) twice per seed and require byte-identical serialized output.

    Returns {ok, checks: [{seed, identical, digest}], evidence_tier, checked_at}
    where evidence_tier is E1 on a full pass and E3 otherwise.
    """
    checks = []
    for seed in seeds:
        first = serializer(fn(seed)).encode("utf-8")
        second = serializer(fn(seed)).encode("utf-8")
        checks.append({
            "seed": seed,
            "identical": first == second,
            "digest": hashlib.sha256(first).hexdigest(),
        })
    ok = bool(checks) and all(c["identical"] for c in checks)
    return {
        "ok": ok,
        "checks": checks,
        "evidence_tier": "E1" if ok else "E3",
        "checked_at": utc_now_iso(),
    }


class UnavailableResult(dict):
    """Structured 'we cannot produce this honestly' result (503-shaped).

    Adapters must return one of these instead of fabricating data when a
    source or optional dependency is missing.
    """

    def __init__(self, reason: str, source: str | None = None):
        super().__init__(
            status="unavailable",
            reason=reason,
            source=source,
            evidence_tier="E4",
        )


def is_unavailable(result: Any) -> bool:
    """True when result is the structured unavailable shape."""
    return isinstance(result, dict) and result.get("status") == "unavailable"


def require_honest(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator converting raised exceptions into structured E4 results."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            return UnavailableResult(
                f"{type(exc).__name__}: {exc}", source=getattr(fn, "__qualname__", None)
            )
    return wrapper


def _concordance(pairs: list[tuple[float, float]]) -> float | None:
    """Harrell's C over (score, outcome) pairs; higher score must predict
    higher outcome risk/worseness. None when no comparable pairs exist."""
    concordant = discordant = tied = 0.0
    n = len(pairs)
    for i in range(n):
        s1, o1 = pairs[i]
        for j in range(i + 1, n):
            s2, o2 = pairs[j]
            d_out = o1 - o2
            if d_out == 0:
                continue
            d_score = s1 - s2
            if d_score == 0:
                tied += 1.0
            elif (d_score > 0) == (d_out > 0):
                concordant += 1.0
            else:
                discordant += 1.0
    denom = concordant + discordant + tied
    if denom == 0:
        return None
    return (concordant + 0.5 * tied) / denom


def _stratified_folds(n: int, outcomes: list[float], k: int, seed: int) -> list[list[int]]:
    """Assign record indices to k folds, stratifying by outcome quartile."""
    order = sorted(range(n), key=lambda i: outcomes[i])
    n_strata = min(4, n)
    bounds = [round(len(order) * i / n_strata) for i in range(n_strata + 1)]
    rng = random.Random(seed)
    folds: list[list[int]] = [[] for _ in range(k)]
    for s in range(n_strata):
        stratum = order[bounds[s]:bounds[s + 1]]
        rng.shuffle(stratum)
        for pos, idx in enumerate(stratum):
            folds[pos % k].append(idx)
    return folds


def _deciles(scores: list[float], outcomes: list[float]) -> list[tuple[int, float, float]]:
    """Bin records into up-to-10 score-sorted deciles.

    Returns [(bin_rank, mean_score, mean_outcome)] for non-empty bins.
    """
    paired = sorted(zip(scores, outcomes), key=lambda p: p[0])
    n_bins = min(10, len(paired))
    bounds = [round(len(paired) * i / n_bins) for i in range(n_bins + 1)]
    bins = []
    for b in range(n_bins):
        chunk = paired[bounds[b]:bounds[b + 1]]
        if not chunk:
            continue
        bins.append((
            b,
            sum(s for s, _ in chunk) / len(chunk),
            sum(o for _, o in chunk) / len(chunk),
        ))
    return bins


def validate_predictor(
    records: list[dict],
    k: int = 5,
    seed: int = 7,
    min_n: int = 20,
    bootstraps: int = 200,
) -> dict[str, Any]:
    """Out-of-sample validation of a risk scorer via stratified K-fold.

    Each record needs {"score": float (higher = more risk/worse),
    "outcome": numeric (0/1 label or numeric time-proxy)}. Scores are
    cross-fitted out-of-fold, then evaluated with Harrell's C (bootstrap CI),
    decile calibration error, and lift (top-decile rate / baseline rate).

    Returns {concordance, ci_low, ci_high, calibration_error, lift, n, k,
    evidence_tier} with tier E2 when n >= min_n and the CI excludes 0.5,
    else E3. Degenerate inputs yield a structured E4 unavailable result.
    """
    n = len(records) if records else 0
    if n < max(2 * k, 2) or any(
        not isinstance(r, dict) or "score" not in r or "outcome" not in r for r in records
    ):
        return UnavailableResult(
            f"need >= {max(2 * k, 2)} well-formed records with score/outcome; got {n}",
            source="validate_predictor",
        )

    scores_all = [float(r["score"]) for r in records]
    outcomes_all = [float(r["outcome"]) for r in records]
    if len(set(outcomes_all)) < 2:
        return UnavailableResult(
            "outcomes are constant; concordance undefined", source="validate_predictor"
        )

    folds = _stratified_folds(n, outcomes_all, k, seed)
    oof_pairs: list[tuple[float, float]] = []
    for held_out in folds:
        oof_pairs.extend((scores_all[i], outcomes_all[i]) for i in held_out)

    c_index = _concordance(oof_pairs)
    if c_index is None:
        return UnavailableResult(
            "no comparable outcome pairs in folds; concordance undefined",
            source="validate_predictor",
        )

    rng = random.Random(seed)
    boot: list[float] = []
    m = len(oof_pairs)
    for _ in range(bootstraps):
        sample = [oof_pairs[rng.randrange(m)] for _ in range(m)]
        c_b = _concordance(sample)
        if c_b is not None:
            boot.append(c_b)
    boot.sort()
    lo_idx = int(0.025 * len(boot))
    hi_idx = min(len(boot) - 1, int(round(0.975 * len(boot))))
    ci_low, ci_high = boot[lo_idx], boot[hi_idx]

    dec = _deciles([p[0] for p in oof_pairs], [p[1] for p in oof_pairs])
    calibration_error = (
        sum(abs(mean_score - mean_out) for _, mean_score, mean_out in dec) / len(dec)
        if dec else None
    )

    baseline = sum(outcomes_all) / n
    top = dec[-1][2] if dec else None
    lift = (top / baseline) if (top is not None and baseline != 0) else None

    excludes_chance = ci_low > 0.5 or ci_high < 0.5
    return {
        "concordance": c_index,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "calibration_error": calibration_error,
        "lift": lift,
        "n": n,
        "k": k,
        "evidence_tier": "E2" if (n >= min_n and excludes_chance) else "E3",
    }


def provenance_record(
    engine: str,
    inputs: dict[str, Any],
    params: dict[str, Any],
    code_version: str,
) -> dict[str, Any]:
    """RO-Crate-lite JSON-LD provenance artifact for one engine run.

    Inputs are hashed via canonical JSON SHA-256 so re-running with the same
    inputs and parameters yields identical hashes (stable provenance).
    """
    created = utc_now_iso()
    record_id = f"urn:bbtech:{engine}:" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return {
        "@context": RO_CRATE_CONTEXT,
        "@graph": [{
            "@id": record_id,
            "@type": "Dataset",
            "engine": engine,
            "input_hashes": {name: sha256_of(value) for name, value in inputs.items()},
            "params": json.loads(json.dumps(params, default=str)),
            "code_version": code_version,
            "created": created,
            "evidence_tier": "E1",
        }],
    }


def reproducibility_debt(prior: dict, current: dict) -> dict[str, Any]:
    """RpD score: count of drifted fields between successive provenance records.

    Counts parameter changes/additions/removals and schema-key additions/
    removals (volatile keys @id/created are ignored).
    """
    try:
        g_prior = prior["@graph"][0]
        g_curr = current["@graph"][0]
    except (KeyError, IndexError, TypeError):
        return UnavailableResult(
            "inputs must be provenance_record outputs with a @graph node",
            source="reproducibility_debt",
        )
    drifted: list[str] = []
    prior_params = g_prior.get("params", {}) or {}
    curr_params = g_curr.get("params", {}) or {}
    for key in sorted(set(prior_params) | set(curr_params)):
        if key not in curr_params:
            drifted.append(f"params.{key}:-")
        elif key not in prior_params:
            drifted.append(f"params.{key}:+")
        elif prior_params[key] != curr_params[key]:
            drifted.append(f"params.{key}:~")
    schema_keys = lambda node: {  # noqa: E731
        key for key in node if key not in _VOLATILE_KEYS and key != "params"
    }
    prior_schema, curr_schema = schema_keys(g_prior), schema_keys(g_curr)
    for key in sorted(curr_schema - prior_schema):
        drifted.append(f"schema:{key}:+")
    for key in sorted(prior_schema - curr_schema):
        drifted.append(f"schema:{key}:-")
    return {"rpd": len(drifted), "drifted_fields": drifted}
