from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.validation_scorecard import build_sports_scorecard  # noqa: E402
from sports_science.validation_engine import utc_now_iso  # noqa: E402


def _main() -> int:
    parser = argparse.ArgumentParser(description="Sports validation scorecard")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--artifact", default=None, help="write frozen JSON here")
    args = parser.parse_args()
    scorecard = build_sports_scorecard()
    if args.artifact:
        p = Path(args.artifact)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"generated_at": utc_now_iso(), "scorecard": scorecard}, default=str))
    print(json.dumps({"ok": True, "scorecard": scorecard}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
