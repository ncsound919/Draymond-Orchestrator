import requests

DEFAULT_SIM_URL = "http://localhost:8080"
SUPPORTED_SPORTS = ("NBA", "NFL")


def normalize_playbook_input(payload):
    normalized = dict(payload)
    sport = str(normalized.get("sport", "")).upper()
    if sport not in SUPPORTED_SPORTS:
        raise ValueError(f"unsupported sport {sport!r}; supported: {', '.join(SUPPORTED_SPORTS)}")
    normalized["sport"] = sport
    return normalized


class PlaygeneAdapter:
    def __init__(self, base_url=DEFAULT_SIM_URL):
        self.base_url = base_url

    def run_play_simulation(self, payload):
        normalized = normalize_playbook_input(payload)
        try:
            resp = requests.post(f"{self.base_url}/api/simulation/run", json=normalized, timeout=10)
            resp.raise_for_status()
            return {"source": "playgene", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {
                "source": "playgene",
                "evidence_tier": "E3",
                "data": {"error": "playgene simulation service unreachable"},
            }
