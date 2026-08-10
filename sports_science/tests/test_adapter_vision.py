# sports_science/tests/test_adapter_vision.py
import pytest

from sports_science.adapters.vision import (
    DEFAULT_MODEL_PATH,
    CLASS_NAMES,
    ShotDetectionAdapter,
    VisionUnavailableError,
    _in_hoop_region,
    _clean_ball_pos,
)


def test_default_model_path_points_to_bundled_weights():
    assert DEFAULT_MODEL_PATH.endswith("basketball_shot_best.pt")


def test_class_names():
    assert CLASS_NAMES == ["Basketball", "Basketball Hoop"]


def test_in_hoop_region_without_hoop_history():
    assert _in_hoop_region((10, 10), []) is False


def test_clean_ball_pos_removes_old_points():
    pos = [((0, 0), 0, 5, 5, 0.9), ((1, 1), 40, 5, 5, 0.9)]
    cleaned = _clean_ball_pos(list(pos), 40)
    assert len(cleaned) == 1


@pytest.mark.skipif(
    not __import__("pathlib").Path(DEFAULT_MODEL_PATH).exists(),
    reason="bundled vision model not present",
)
def test_adapter_contract_requires_video_path():
    adapter = ShotDetectionAdapter()
    out = adapter.call({})
    assert out["success"] is False
    assert out["evidence_tier"] == "E3"


def test_adapter_missing_video_returns_error_not_crash():
    adapter = ShotDetectionAdapter()
    out = adapter.call({"video_path": "C:/does/not/exist.mp4"})
    # Without optional CV deps, this must degrade gracefully (E3).
    assert out["evidence_tier"] in ("E2", "E3")


def test_vision_unavailable_error_is_runtime_error():
    assert issubclass(VisionUnavailableError, RuntimeError)
