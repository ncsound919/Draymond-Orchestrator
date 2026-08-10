"""Vision adapter for sports_science: YOLO-based basketball shot detection.

Wraps the `Original BBTECH` shot-detection logic (Avi Shah, 2023) into the
standard adapter contract. Like the other adapters, it degrades gracefully:
if the optional heavy dependencies (ultralytics/opencv/torch) are unavailable,
it returns an ``E3`` evidence-tier result instead of crashing.

The trained weights are bundled at ``sports_science/models/basketball_shot_best.pt``.
Override the model path with the ``SPORTS_VISION_MODEL`` environment variable.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_MODEL_PATH = str(
    Path(__file__).resolve().parent.parent / "models" / "basketball_shot_best.pt"
)

CLASS_NAMES = ["Basketball", "Basketball Hoop"]


class VisionUnavailableError(RuntimeError):
    """Raised when optional CV dependencies are not installed."""


def _require_vision():
    """Import the heavy CV stack lazily so non-vision workflows stay light."""
    try:
        from ultralytics import YOLO  # noqa: F401
        import cv2  # noqa: F401
        import numpy as np  # noqa: F401
        import torch  # noqa: F401
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise VisionUnavailableError(
            "shot detection requires optional deps: ultralytics, opencv-python, "
            "numpy, torch (see sports_science/requirements-vision.txt)"
        ) from exc


# --- Pure motion/geometry helpers (no heavy deps) ------------------------- #
def _score(ball_pos: List[Tuple[tuple, int, int, int, float]],
           hoop_pos: List[Tuple[tuple, int, int, int, float]]) -> bool:
    """Project ball trajectory and check whether it crosses the rim."""
    import numpy as np

    x: List[float] = []
    y: List[float] = []
    rim_height = hoop_pos[-1][0][1] - 0.5 * hoop_pos[-1][3]

    for i in reversed(range(len(ball_pos))):
        if ball_pos[i][0][1] < rim_height:
            x.append(ball_pos[i][0][0])
            y.append(ball_pos[i][0][1])
            if i + 1 < len(ball_pos):
                x.append(ball_pos[i + 1][0][0])
                y.append(ball_pos[i + 1][0][1])
            break

    if len(x) > 1:
        m, b = np.polyfit(x, y, 1)
        predicted_x = ((hoop_pos[-1][0][1] - 0.5 * hoop_pos[-1][3]) - b) / m
        rim_x1 = hoop_pos[-1][0][0] - 0.4 * hoop_pos[-1][2]
        rim_x2 = hoop_pos[-1][0][0] + 0.4 * hoop_pos[-1][2]
        if rim_x1 < predicted_x < rim_x2:
            return True
        rebound_zone = 10
        if rim_x1 - rebound_zone < predicted_x < rim_x2 + rebound_zone:
            return True
    return False


def _detect_down(ball_pos, hoop_pos) -> bool:
    y = hoop_pos[-1][0][1] + 0.5 * hoop_pos[-1][3]
    return ball_pos[-1][0][1] > y


def _detect_up(ball_pos, hoop_pos) -> bool:
    x1 = hoop_pos[-1][0][0] - 4 * hoop_pos[-1][2]
    x2 = hoop_pos[-1][0][0] + 4 * hoop_pos[-1][2]
    y1 = hoop_pos[-1][0][1] - 2 * hoop_pos[-1][3]
    y2 = hoop_pos[-1][0][1]
    return x1 < ball_pos[-1][0][0] < x2 and y1 < ball_pos[-1][0][1] < y2 - 0.5 * hoop_pos[-1][3]


def _in_hoop_region(center, hoop_pos) -> bool:
    if len(hoop_pos) < 1:
        return False
    x, y = center
    x1 = hoop_pos[-1][0][0] - 1 * hoop_pos[-1][2]
    x2 = hoop_pos[-1][0][0] + 1 * hoop_pos[-1][2]
    y1 = hoop_pos[-1][0][1] - 1 * hoop_pos[-1][3]
    y2 = hoop_pos[-1][0][1] + 0.5 * hoop_pos[-1][3]
    return x1 < x < x2 and y1 < y < y2


def _clean_ball_pos(ball_pos, frame_count):
    if len(ball_pos) > 1:
        w1, h1 = ball_pos[-2][2], ball_pos[-2][3]
        w2, h2 = ball_pos[-1][2], ball_pos[-1][3]
        x1, y1 = ball_pos[-2][0]
        x2, y2 = ball_pos[-1][0]
        f_dif = ball_pos[-1][1] - ball_pos[-2][1]
        dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        max_dist = 4 * math.sqrt(w1 ** 2 + h1 ** 2)
        if (dist > max_dist) and (f_dif < 5):
            ball_pos.pop()
        elif (w2 * 1.4 < h2) or (h2 * 1.4 < w2):
            ball_pos.pop()
    if ball_pos and frame_count - ball_pos[0][1] > 30:
        ball_pos.pop(0)
    return ball_pos


def _clean_hoop_pos(hoop_pos):
    if len(hoop_pos) > 1:
        x1, y1 = hoop_pos[-2][0]
        x2, y2 = hoop_pos[-1][0]
        w1, h1 = hoop_pos[-2][2], hoop_pos[-2][3]
        w2, h2 = hoop_pos[-1][2], hoop_pos[-1][3]
        f_dif = hoop_pos[-1][1] - hoop_pos[-2][1]
        dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        max_dist = 0.5 * math.sqrt(w1 ** 2 + h1 ** 2)
        if dist > max_dist and f_dif < 5:
            hoop_pos.pop()
        if (w2 * 1.3 < h2) or (h2 * 1.3 < w2):
            hoop_pos.pop()
    if len(hoop_pos) > 25:
        hoop_pos.pop(0)
    return hoop_pos


class ShotDetectionAdapter:
    """Detect basketball makes/attempts in a video using the bundled YOLO model.

    Returns an ``AgentResult``-shaped dict:
        {"success": bool, "data": dict, "error": str|None, "evidence_tier": str}
    ``data`` contains ``{"makes": int, "attempts": int, "class_names": [...]}``.
    """

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path or os.environ.get("SPORTS_VISION_MODEL", DEFAULT_MODEL_PATH)
        self._model = None
        self._device = "cpu"

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        _require_vision()
        import torch
        from ultralytics import YOLO

        if not Path(self.model_path).exists():
            raise FileNotFoundError(f"vision model not found: {self.model_path}")
        self._device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
            else "cpu"
        )
        self._model = YOLO(self.model_path)
        return self._model

    def detect_shots(self, video_path: str, max_frames: Optional[int] = None) -> dict:
        """Run shot detection over a video file and return makes/attempts."""
        try:
            model = self._ensure_model()
        except VisionUnavailableError as exc:
            return {"success": False, "data": {}, "error": str(exc), "evidence_tier": "E3"}
        except FileNotFoundError as exc:
            return {"success": False, "data": {}, "error": str(exc), "evidence_tier": "E3"}

        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {
                "success": False,
                "data": {},
                "error": f"could not open video: {video_path}",
                "evidence_tier": "E3",
            }

        ball_pos: List[Tuple[tuple, int, int, int, float]] = []
        hoop_pos: List[Tuple[tuple, int, int, int, float]] = []
        frame_count = 0
        makes = 0
        attempts = 0
        up = False
        down = False
        up_frame = 0
        down_frame = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if max_frames is not None and frame_count >= max_frames:
                break

            results = model(frame, stream=True, device=self._device, verbose=False)
            for r in results:
                boxes = r.boxes
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0]
                    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                    w, h = x2 - x1, y2 - y1
                    conf = math.ceil((box.conf[0] * 100)) / 100
                    cls = int(box.cls[0])
                    current_class = CLASS_NAMES[cls] if cls < len(CLASS_NAMES) else "Unknown"
                    center = (int(x1 + w / 2), int(y1 + h / 2))

                    if (conf > 0.3 or (_in_hoop_region(center, hoop_pos) and conf > 0.15)) and current_class == "Basketball":
                        ball_pos.append((center, frame_count, w, h, conf))
                    if conf > 0.5 and current_class == "Basketball Hoop":
                        hoop_pos.append((center, frame_count, w, h, conf))

            ball_pos = _clean_ball_pos(ball_pos, frame_count)
            if len(hoop_pos) > 1:
                hoop_pos = _clean_hoop_pos(hoop_pos)

            if len(hoop_pos) > 0 and len(ball_pos) > 0:
                if not up:
                    up = _detect_up(ball_pos, hoop_pos)
                    if up:
                        up_frame = ball_pos[-1][1]
                if up and not down:
                    down = _detect_down(ball_pos, hoop_pos)
                    if down:
                        down_frame = ball_pos[-1][1]
                if frame_count % 10 == 0:
                    if up and down and up_frame < down_frame:
                        attempts += 1
                        if _score(ball_pos, hoop_pos):
                            makes += 1
                        up = False
                        down = False

            frame_count += 1

        cap.release()
        return {
            "success": True,
            "data": {
                "makes": makes,
                "attempts": attempts,
                "shooting_pct": round(makes / attempts, 4) if attempts else 0.0,
                "frames_processed": frame_count,
                "class_names": CLASS_NAMES,
            },
            "error": None,
            "evidence_tier": "E2",
        }

    def call(self, inputs: Dict[str, Any], ctx: Any = None) -> dict:
        """Adapter-contract entry point (input key: ``video_path``)."""
        video_path = inputs.get("video_path", "")
        if not video_path:
            return {
                "success": False,
                "data": {},
                "error": "video_path required",
                "evidence_tier": "E3",
            }
        return self.detect_shots(video_path, max_frames=inputs.get("max_frames"))
