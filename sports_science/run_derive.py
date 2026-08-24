# sports_science/run_derive.py
"""CLI runner: Metrics Lab derived composites over session profiles.

Contract (mirrors run_insights.py style):
  python sports_science/run_derive.py <session_id> <profile.json> [--domain sports|biotech]
The profile JSON may be a single session profile dict or a list of them.
Output: machine-readable JSON {ok, session_id, domain, metrics, generated_at}.
Non-zero exit => {"ok": false, "error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.metrics_lab import derive_all  # noqa: E402
from sports_science.validation_engine import utc_now_iso  # noqa: E402


def build_output(session_id: str, profiles: list[dict], domain: str) -> dict[str, Any]:
    return {
        "ok": True,
        "session_id": session_id,
        "domain": domain,
        "metrics": derive_all(profiles),
        "generated_at": utc_now_iso(),
    }


def derive_from_path(session_id: str, profile_path: Path, domain: str) -> dict[str, Any]:
    if not profile_path.exists():
        raise ValueError(f"profile not found: {profile_path}")
    data = json.loads(profile_path.read_text(encoding="utf-8-sig"))
    profiles = data if isinstance(data, list) else [data]
    profiles = [p for p in profiles if isinstance(p, dict)]
    return build_output(session_id, profiles, domain)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Metrics Lab derived composites")
    parser.add_argument("session_id", help="session/run correlation id")
    parser.add_argument("profile", help="path to a profile JSON (dict or list)")
    parser.add_argument("--domain", default="sports", choices=["sports", "biotech"],
                        help="domain tag for the output (default: sports)")
    args = parser.parse_args()
    try:
        output = derive_from_path(args.session_id, Path(args.profile), args.domain)
        print(json.dumps(output, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
