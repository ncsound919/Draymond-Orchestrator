"""Execute the runnable experiments in .draymond/experiment-queue.json.

Deterministic, fail-honest: every experiment either produces a real measured
result or records the exact failure reason. No fabrication.

Runnable by type:
  simulation   -> python -m science_engine.cli <model>.json <ticks>
  analysis     -> sports:  python sports_science/run_metrics.py session <sport> <dataset>
                  biotech: python biotech_science/run_analysis.py session <dataset>
  translation  -> python sports_science/run_insights.py session <profile.json> [--domain]

Also flags the claim-only 08-25 stubs (no model_id/dataset) as UNRUNNABLE so the
queue stops silently carrying dead entries.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(r"C:\Users\User\Downloads\Uplift\Draymond-Orchestrator")
QUEUE = ROOT / ".draymond" / "experiment-queue.json"
OUT_DIR = ROOT / "research" / "experiments-runs" / "2026-08-27"
PY = r"C:\Program Files\Python312\python.exe"

SKIP_DATASET_PREFIXES = (".next",)  # stale standalone paths never existed on disk


def run(cmd: list[str], cwd: Path, timeout: int = 90) -> tuple[str, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=timeout,
                           env={"PYTHONPATH": str(ROOT), **{k: v for k, v in __import__('os').environ.items()}})
        return p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    state = json.loads(QUEUE.read_text(encoding="utf-8-sig"))
    queue = state["queue"]
    results = []
    summary = {"total": len(queue), "completed": 0, "failed": 0, "skipped": 0, "unrunnable": 0}

    for exp in queue:
        rid = exp.get("id", "?")
        goal = exp.get("goal_id", "?")
        hyp = exp.get("hypothesis_id", "?")
        etype = exp.get("type", "?")
        domain = exp.get("domain", "?")
        inputs = exp.get("inputs", {}) or {}
        model_id = exp.get("model_id")

        # Claim-only stubs (08-25 batch) have no model_id and no dataset
        if not model_id and "dataset" not in inputs and "profile" not in inputs:
            exp["status"] = "unrunnable"
            exp["reason"] = "claim-only stub: no model_id, dataset, or profile"
            exp["result_file"] = None
            exp["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            summary["unrunnable"] += 1
            results.append({"id": rid, "goal": goal, "hyp": hyp, "type": etype, "status": "unrunnable",
                            "reason": exp["reason"]})
            continue

        try:
            started = time.monotonic()
            stdout, stderr = "", ""
            detail = ""

            if etype == "simulation":
                model_path = ROOT / "science_engine" / "models" / f"{model_id}.json"
                if not model_path.exists():
                    raise RuntimeError(f"model not found: {model_path.name}")
                ticks = int(inputs.get("ticks", 48))
                stdout, stderr = run([PY, "-m", "science_engine.cli", str(model_path), str(ticks)], ROOT)
                detail = "simulation"
            elif etype == "analysis":
                dataset = str(inputs.get("dataset", ""))
                if dataset.startswith(SKIP_DATASET_PREFIXES):
                    raise RuntimeError(f"stale standalone dataset path (never existed on disk): {dataset}")
                dp = ROOT / dataset
                if not dp.exists():
                    raise RuntimeError(f"dataset not found: {dataset}")
                if domain == "biotech":
                    stdout, stderr = run([PY, "biotech_science/run_analysis.py", "session", str(dp)], ROOT)
                else:
                    sport = inputs.get("sport", "basketball")
                    stdout, stderr = run([PY, "sports_science/run_metrics.py", "session", sport, str(dp)], ROOT)
                detail = "analysis"
            elif etype == "translation":
                profile = inputs.get("profile")
                if not isinstance(profile, dict):
                    raise RuntimeError("translation profile missing")
                fd, tmp = tempfile.mkstemp(suffix=".json", dir=OUT_DIR)
                with __import__('os').fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(profile, f)
                args = [PY, "sports_science/run_insights.py", "session", tmp]
                if domain == "biotech":
                    args.append("--from_biotech")
                stdout, stderr = run(args, ROOT)
                Path(tmp).unlink(missing_ok=True)
                detail = "translation"
            else:
                raise RuntimeError(f"unknown type: {etype}")

            elapsed = round(time.monotonic() - started, 2)

            # Validate JSON output (fail-honest: non-JSON or error body = failure)
            parsed = {}
            if stdout:
                try:
                    parsed = json.loads(stdout)
                except json.JSONDecodeError:
                    parsed = {"stdout_raw": stdout[:2000]}
            if stderr and "error" in stderr.lower():
                parsed["stderr"] = stderr[:2000]

            ok = bool(parsed) and not parsed.get("error")
            status = "completed" if ok else "failed"
            result_file = OUT_DIR / f"{rid}.json"
            result_file.write_text(json.dumps({
                "experiment_id": rid, "goal_id": goal, "hypothesis_id": hyp, "type": etype,
                "domain": domain, "model_id": model_id, "inputs": inputs,
                "status": status, "elapsed_s": elapsed, "detail": detail,
                "result": parsed if ok else None,
                "error": parsed.get("error") or stderr[:2000] or None if not ok else None,
                "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, indent=2, default=str), encoding="utf-8")

            exp["status"] = status
            exp["result_file"] = str(result_file)
            exp["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if not ok:
                exp["reason"] = parsed.get("error") or stderr[:500] or "empty/non-JSON output"
            summary["completed" if ok else "failed"] += 1
            results.append({"id": rid, "goal": goal, "hyp": hyp, "type": etype, "status": status,
                            "elapsed_s": elapsed, "result_file": str(result_file),
                            "error": exp.get("reason")})

        except Exception as exc:  # noqa: BLE001
            exp["status"] = "failed"
            exp["reason"] = str(exc)
            exp["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            summary["failed"] += 1
            results.append({"id": rid, "goal": goal, "hyp": hyp, "type": etype, "status": "failed",
                            "error": str(exc)})

    state["queue"] = queue
    state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    QUEUE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    (OUT_DIR / "summary.json").write_text(json.dumps({
        "summary": summary,
        "results": results,
    }, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    for r in results:
        print(f"  [{r['status']:>10}] {r['id'][:8]} {r['goal']}/{r['type']} "
              f"{r.get('error') or r.get('result_file') or ''}")


if __name__ == "__main__":
    main()