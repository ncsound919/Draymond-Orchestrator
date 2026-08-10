# sports_science/tests/test_adapter_boxing.py
from sports_science.adapters.boxing import (
    BoxingAdapter,
    normalize_boxrec_row,
    DEFAULT_BOXREC_PATH,
)
from pathlib import Path


def test_default_boxrec_path_points_to_dataset():
    assert Path(DEFAULT_BOXREC_PATH).exists()


def test_normalize_boxrec_row_maps_landed():
    out = normalize_boxrec_row({"landed": 120, "thrown": 400, "knockdowns": 1, "rounds": 10})
    assert 0.0 < out["land_pct"] < 1.0


def test_adapter_reads_boxrec_csv(tmp_path):
    csv_path = tmp_path / "boxrec.csv"
    csv_path.write_text("name,landed,thrown\nAli,200,500\n")
    adapter = BoxingAdapter(boxrec_path=str(csv_path))
    fighters = adapter.load_fighters()
    assert len(fighters) == 1
