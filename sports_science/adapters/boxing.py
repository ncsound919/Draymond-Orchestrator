import csv

DEFAULT_BOXREC_PATH = r"C:\Users\User\Downloads\Uplift\Overlay Science\Sports\Boxing Sim\BoxRec Boxers Data.csv"


def _as_float(value):
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def normalize_boxrec_row(row):
    landed = _as_float(row.get("landed"))
    thrown = _as_float(row.get("thrown"))
    land_pct = landed / thrown if thrown else 0.0
    return {
        "land_pct": land_pct,
        "landed": landed,
        "thrown": thrown,
        "knockdowns": _as_float(row.get("knockdowns")),
        "rounds": _as_float(row.get("rounds")),
    }


class BoxingAdapter:
    def __init__(self, boxrec_path=DEFAULT_BOXREC_PATH):
        self.boxrec_path = boxrec_path

    def load_fighters(self):
        fighters = []
        with open(self.boxrec_path, "r", encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                if not any((v or "").strip() for v in row.values()):
                    continue
                fighters.append(normalize_boxrec_row(row))
        return fighters
