import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


def test_run_scorecard_cli_json():
    res = subprocess.run(
        [sys.executable, str(REPO / "sports_science" / "run_scorecard.py"), "--json"],
        capture_output=True, text=True, cwd=REPO, timeout=300,
    )
    assert res.returncode == 0, f"stdout={res.stdout[:200]}, stderr={res.stderr[:200]}"
    out = json.loads(res.stdout)
    assert out.get("ok") is True
    assert "scorecard" in out
    assert out["scorecard"]["status"] in ("ok", "partial", "unavailable")
