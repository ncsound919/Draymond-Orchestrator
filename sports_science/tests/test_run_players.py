import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


def test_run_players_cli_json():
    res = subprocess.run(
        [sys.executable, str(REPO / "sports_science" / "run_players.py"),
         "--player", "Andrew Bogut", "--season", "2015"],
        capture_output=True, text=True, cwd=REPO, timeout=300,
    )
    assert res.returncode == 0, f"stdout={res.stdout[:200]}, stderr={res.stderr[:200]}"
    out = json.loads(res.stdout)
    assert out.get("ok") is True
    assert isinstance(out.get("metrics"), list)
    for m in out["metrics"]:
        assert m.get("evidence_tier") in ("E1", "E2", "E3", "E4")


def test_run_players_honest_when_no_db():
    res = subprocess.run(
        [sys.executable, str(REPO / "sports_science" / "run_players.py"),
         "--player", "Fake Player Does Not Exist"],
        capture_output=True, text=True, cwd=REPO, timeout=60,
    )
    out = json.loads(res.stdout)
    assert out.get("ok") is True
    for m in out.get("metrics", []):
        if m.get("evidence_tier") in ("E1", "E2"):
            assert m.get("value") is not None
