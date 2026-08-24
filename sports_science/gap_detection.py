# sports_science/gap_detection.py
"""Deterministic research-gap detection over InsightReport / validation output.

Pure standard library scan of report-shaped dicts. No LLM calls, no network.
Every scientific gap surfaced by the rigor layer is routed to the escalation
pipeline (Draymond researchEscalation) so the research team can spend
resources toward definitive results.

Gap kinds:
  weak_evidence  payload graded E3/E4 (rule-based/inconclusive or unavailable)
  unknown        any structured {status: "unavailable"} result
  anomaly        numeric series value with |z| > threshold vs session baseline
  gap            weak translation confidence / validation CI spanning null /
                 calibration error above threshold

Records carry a stable content-hash gap_id (sha256 of kind+source_ref+title)
so re-scans dedup; per-report output is capped and sorted deterministically.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Callable

from sports_science.validation_engine import is_unavailable, utc_now_iso

MAX_GAPS_PER_REPORT = 25
ANOMALY_Z_THRESHOLD = 2.5
MIN_TRANSLATION_CONFIDENCE = 0.6
MAX_CALIBRATION_ERROR = 0.15
_WEAK_TIERS = ("E3", "E4")


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def compute_gap_id(kind: str, source_ref: str, title: str) -> str:
    """Stable content hash over the gap identity fields."""
    digest = hashlib.sha256(
        _canonical({"kind": kind, "source_ref": source_ref, "title": title}).encode("utf-8")
    ).hexdigest()
    return f"gap_{digest[:24]}"


def _make_gap(
    kind: str,
    title: str,
    detail: str,
    source_ref: str,
    evidence_tier: str = "E3",
    severity: int = 3,
    now: str | None = None,
) -> dict[str, Any]:
    return {
        "gap_id": compute_gap_id(kind, source_ref, title),
        "kind": kind,
        "title": title,
        "detail": detail,
        "source_ref": source_ref,
        "evidence_tier": evidence_tier,
        "severity": max(1, min(5, int(severity))),
        "detected_at": now or utc_now_iso(),
    }


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _numeric_series(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) < 2:
        return None
    if not all(_is_finite_number(v) for v in value):
        return None
    return [float(v) for v in value]


def _scan_dict(node: dict, path: str, emit: Callable[[dict], None], now: str | None) -> None:
    if is_unavailable(node):
        reason = str(node.get("reason") or "unavailable result")
        emit(_make_gap(
            kind="unknown",
            title=reason[:120],
            detail=f"structured unavailable result at {path}: {reason}",
            source_ref=path,
            evidence_tier=str(node.get("evidence_tier") or "E4"),
            severity=4,
            now=now,
        ))
        return

    tier = node.get("evidence_tier")
    if isinstance(tier, str) and tier in _WEAK_TIERS:
        emit(_make_gap(
            kind="weak_evidence",
            title=f"payload graded {tier} at {path}",
            detail=f"evidence tier {tier} carries no measured-data guarantee",
            source_ref=path,
            evidence_tier=tier,
            severity=4 if tier == "E4" else 3,
            now=now,
        ))

    baseline = node.get("baseline")
    if isinstance(baseline, dict) and _is_finite_number(baseline.get("mean")):
        std = baseline.get("std")
        if _is_finite_number(std) and float(std) > 0:
            mean, sd = float(baseline["mean"]), float(std)
            for key in sorted(node):
                series = _numeric_series(node[key])
                if series is None or key == "baseline":
                    continue
                for idx, value in enumerate(series):
                    z = abs((value - mean) / sd)
                    if z > ANOMALY_Z_THRESHOLD:
                        severity = 5 if z > 4 else 4 if z > 3 else 3
                        emit(_make_gap(
                            kind="anomaly",
                            title=f"{key}[{idx}] deviates {z:.1f} sigma from session baseline",
                            detail=f"value {value} vs baseline mean {mean} (std {sd}) at {path}.{key}[{idx}]",
                            source_ref=f"{path}.{key}[{idx}]",
                            severity=severity,
                            now=now,
                        ))

    translated = node.get("translated_metrics")
    if isinstance(translated, list):
        for idx, entry in enumerate(translated):
            if isinstance(entry, dict) and _is_finite_number(entry.get("confidence")):
                confidence = float(entry["confidence"])
                if confidence < MIN_TRANSLATION_CONFIDENCE:
                    metric = str(entry.get("metric") or entry.get("target_metric") or idx)
                    emit(_make_gap(
                        kind="gap",
                        title=f"translation confidence {confidence:.2f} below threshold for {metric}",
                        detail=(
                            f"confidence {confidence} < {MIN_TRANSLATION_CONFIDENCE} "
                            f"at {path}.translated_metrics[{idx}]"
                        ),
                        source_ref=f"{path}.translated_metrics[{idx}]",
                        severity=2,
                        now=now,
                    ))

    ci_low, ci_high = node.get("ci_low"), node.get("ci_high")
    if (
        _is_finite_number(ci_low) and _is_finite_number(ci_high)
        and float(ci_low) <= 0.5 <= float(ci_high)
    ):
        emit(_make_gap(
            kind="gap",
            title="validation confidence interval spans the null effect (0.5)",
            detail=f"CI [{float(ci_low)}, {float(ci_high)}] spans 0.5 at {path}",
            source_ref=path,
            severity=3,
            now=now,
        ))

    calibration_error = node.get("calibration_error")
    if _is_finite_number(calibration_error) and float(calibration_error) > MAX_CALIBRATION_ERROR:
        emit(_make_gap(
            kind="gap",
            title=f"calibration error {float(calibration_error):.2f} above threshold",
            detail=f"calibration_error {float(calibration_error)} > {MAX_CALIBRATION_ERROR} at {path}",
            source_ref=path,
            severity=4,
            now=now,
        ))


def _walk(node: Any, path: str, emit: Callable[[dict], None], now: str | None) -> None:
    if isinstance(node, dict):
        _scan_dict(node, path, emit, now)
        for key in sorted(node):
            child = node[key]
            if isinstance(child, (dict, list)):
                _walk(child, f"{path}.{key}", emit, now)
    elif isinstance(node, list):
        for idx, item in enumerate(node):
            if isinstance(item, (dict, list)):
                _walk(item, f"{path}[{idx}]", emit, now)


def detect_gaps(report: Any, now: str | None = None) -> dict[str, Any]:
    """Scan one InsightReport / validation-output dict for research gaps.

    Returns {ok, gaps, scanned_at}. Gaps are deduped by content-hash gap_id,
    sorted by descending severity then id (deterministic), and capped at
    MAX_GAPS_PER_REPORT. Honesty: an unusable input fails with ok:false
    instead of fabricating an empty pass.
    """
    stamp = now or utc_now_iso()
    if not isinstance(report, (dict, list)):
        return {"ok": False, "gaps": [], "scanned_at": stamp}

    candidates: list[dict] = []

    def emit(gap: dict) -> None:
        candidates.append(gap)

    try:
        _walk(report, "$", emit, now)
    except RecursionError:
        return {"ok": False, "gaps": [], "scanned_at": stamp}

    seen: set[str] = set()
    unique: list[dict] = []
    for gap in candidates:
        if gap["gap_id"] in seen:
            continue
        seen.add(gap["gap_id"])
        unique.append(gap)

    unique.sort(key=lambda g: (-g["severity"], g["kind"], g["gap_id"]))
    return {"ok": True, "gaps": unique[:MAX_GAPS_PER_REPORT], "scanned_at": stamp}


def summarize_gaps(result: dict[str, Any]) -> dict[str, Any]:
    """Attach summary counts-by-kind to a detect_gaps result (runner helper)."""
    counts: dict[str, int] = {}
    for gap in result.get("gaps", []):
        kind = str(gap.get("kind", "unknown"))
        counts[kind] = counts.get(kind, 0) + 1
    return {**result, "summary": counts}
