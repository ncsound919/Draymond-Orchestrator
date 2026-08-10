# sports_science/tests/test_ingest_fb_box.py
from sports_science.ingest import normalize_football_row, normalize_boxing_row, load_csv_rows


def test_football_row_maps():
    out = normalize_football_row({"goals": 2, "assists": 1, "shots": 6, "distance_km": 11.5, "sprints": 40})
    assert out["goals"] == 2 and out["distance_km"] == 11.5


def test_boxing_row_maps():
    out = normalize_boxing_row({"landed": 120, "thrown": 400, "knockdowns": 1, "rounds": 10})
    assert 0.0 < out["land_pct"] < 1.0


def test_load_csv_rows(tmp_path):
    p = tmp_path / "data.csv"
    p.write_text("goals,assists\n2,1\n1,3\n")
    rows = load_csv_rows(str(p))
    assert rows == [{"goals": 2, "assists": 1}, {"goals": 1, "assists": 3}]
