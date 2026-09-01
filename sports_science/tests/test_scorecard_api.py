from sports_science.scorecard_api import build_scorecard_handler_response


def test_handler_returns_scorecard_json():
    status, headers, body = build_scorecard_handler_response()
    import json
    payload = json.loads(body)
    assert status == 200
    assert payload["scorecard"]["status"] in ("ok", "partial", "unavailable")
    assert any(h[0].lower() == "content-type" for h in headers)


def test_handler_includes_persist_result():
    status, headers, body = build_scorecard_handler_response()
    import json
    payload = json.loads(body)
    # persist is called as part of the handler; it should return a result
    assert "persist" in payload
    assert payload["persist"].get("ok") is True