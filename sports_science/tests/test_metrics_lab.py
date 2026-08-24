# sports_science/tests/test_metrics_lab.py
import copy

from sports_science.metrics_lab import (
    CODE_VERSION,
    METRICS,
    archetype_pressure_score,
    cross_domain_momentum,
    derive_all,
    evidence_weighted_form,
    translation_delta_index,
)
from sports_science.validation_engine import canonical_json, verify_determinism

VOLATILE_KEYS = ("@id", "created")


def _strip_volatile(metric):
    stripped = {k: v for k, v in metric.items() if k != "provenance"}
    if "provenance" in metric:
        node = {
            k: v for k, v in metric["provenance"]["@graph"][0].items()
            if k not in VOLATILE_KEYS
        }
        stripped["provenance"] = {"@graph": [node]}
    return stripped


def _serializer(metric):
    return canonical_json(_strip_volatile(metric))


def _profile(**overrides):
    profile = {
        "sport": "basketball",
        "ter": 1.2,
        "four_factors": {"proliferation": 70, "clearance": 40, "resource": 55, "metastasis": 45},
        "gravity": 0.6,
        "flow": 0.5,
        "archetype": "jordan",
        "evidence_tier": "E3",
    }
    profile.update(overrides)
    return profile


def test_translation_delta_index_maximal_divergence():
    profiles = [
        _profile(domain="sports", ter=0.0, generated_at="2026-01-01T00:00:00Z"),
        _profile(domain="sports", ter=1.0, generated_at="2026-01-02T00:00:00Z"),
        _profile(domain="biotech", ter=1.0, generated_at="2026-01-01T00:00:00Z"),
        _profile(domain="biotech", ter=0.0, generated_at="2026-01-02T00:00:00Z"),
    ]
    result = translation_delta_index(profiles)
    assert result["value"] == 1.0
    assert result["unit"] == "index"
    assert result["evidence_tier"] == "E3"


def test_translation_delta_index_identical_trajectories():
    profiles = [
        _profile(domain="sports", ter=t, generated_at=f"2026-01-0{i+1}T00:00:00Z")
        for i, t in enumerate([0.2, 0.5, 0.8])
    ] + [
        _profile(domain="biotech", ter=t, generated_at=f"2026-01-0{i+1}T00:00:00Z")
        for i, t in enumerate([9.0, 10.0, 11.0])
    ]
    result = translation_delta_index(profiles)
    assert result["value"] == 0.0
    assert result["evidence_tier"] == "E2"
    assert set(result["inputs_used"]) == {"ter", "domain", "generated_at"}


def test_cross_domain_momentum_positive_and_negative():
    # Only ter moves; the constant four_factors component normalizes to 0.5
    # per session, so the composite is [0.25, 0.75] and the slope is 0.5.
    rising = [
        _profile(ter=0.0, generated_at="2026-01-01T00:00:00Z"),
        _profile(ter=1.0, generated_at="2026-01-02T00:00:00Z"),
    ]
    up = cross_domain_momentum(rising)
    assert up["value"] == 0.5
    assert up["direction"] == "positive"

    falling = [
        _profile(ter=1.0, generated_at="2026-01-01T00:00:00Z"),
        _profile(ter=0.0, generated_at="2026-01-02T00:00:00Z"),
    ]
    down = cross_domain_momentum(falling)
    assert down["value"] == -0.5
    assert down["direction"] == "negative"

    # When every component rises in lockstep the slope reaches its maximum.
    lockstep = [
        _profile(ter=0.0,
                 four_factors={"proliferation": 10, "clearance": 10, "resource": 10, "metastasis": 10},
                 generated_at="2026-01-01T00:00:00Z"),
        _profile(ter=1.0,
                 four_factors={"proliferation": 90, "clearance": 90, "resource": 90, "metastasis": 90},
                 generated_at="2026-01-02T00:00:00Z"),
    ]
    maxed = cross_domain_momentum(lockstep)
    assert maxed["value"] == 1.0
    assert maxed["direction"] == "positive"


def test_cross_domain_momentum_evidence_weighting_pulls_toward_trusted_sessions():
    # Same trajectory shape, but the second session is E4 (weight 0.25) while
    # the first is E1 (weight 1.0): the weighted slope must stay below the
    # unweighted slope of 1.0.
    profiles = [
        _profile(ter=0.0, evidence_tier="E1", generated_at="2026-01-01T00:00:00Z"),
        _profile(ter=1.0, evidence_tier="E4", generated_at="2026-01-02T00:00:00Z"),
    ]
    result = cross_domain_momentum(profiles)
    assert 0.0 < result["value"] < 1.0
    assert "evidence_tier" in result["inputs_used"]


def test_archetype_pressure_score_exact_composite():
    profiles = [
        _profile(archetype="jordan", gravity=0.6, flow=0.5),
    ]
    result = archetype_pressure_score(profiles)
    # (0.5*0.6 + 0.3*0.5) / (0.5 + 0.3) = 0.5625; spatial missing drops out.
    assert result["value"]["jordan"] == 0.5625
    assert result["unit"] == "score"


def test_archetype_pressure_score_aggregates_per_archetype():
    profiles = [
        _profile(archetype="jordan", gravity=0.6, flow=0.5),
        _profile(archetype="esa", gravity=0.2, flow=0.4, performance={"court_spacing": 0.8}),
    ]
    result = archetype_pressure_score(profiles)
    esa_expected = (0.5 * 0.2 + 0.3 * 0.4 + 0.2 * 0.8) / 1.0
    assert set(result["value"]) == {"jordan", "esa"}
    assert result["value"]["esa"] == round(esa_expected, 6)


def test_evidence_weighted_form_weights_tiers():
    profiles = [
        _profile(baseline_form=0.8, evidence_tier="E1"),
        _profile(baseline_form=0.4, evidence_tier="E4"),
    ]
    result = evidence_weighted_form(profiles)
    assert result["value"] == round((1.0 * 0.8 + 0.25 * 0.4) / 1.25, 6)
    assert result["unit"] == "index"


def test_evidence_weighted_form_falls_back_to_gravity_flow_mean():
    profiles = [_profile(gravity=0.6, flow=0.4)]
    result = evidence_weighted_form(profiles)
    assert result["value"] == 0.5
    assert result["evidence_tier"] == "E3"


def test_sparse_inputs_yield_structured_e4_unavailable():
    sparse = [{"sport": "basketball"}, {}]
    for metric in (translation_delta_index, cross_domain_momentum,
                   archetype_pressure_score, evidence_weighted_form):
        result = metric(sparse)
        assert result["status"] == "unavailable"
        assert result["evidence_tier"] == "E4"
        assert result["value"] is None
        assert isinstance(result["reason"], str) and result["reason"]
    assert translation_delta_index([])["status"] == "unavailable"
    assert derive_all(None)[0]["status"] == "unavailable"


def test_derive_all_returns_the_four_lab_metrics_in_order():
    results = derive_all([_profile()])
    assert [r["name"] for r in results] == [
        "translation_delta_index",
        "cross_domain_momentum",
        "archetype_pressure_score",
        "evidence_weighted_form",
    ]


def test_provenance_present_and_input_hashes_stable_across_runs():
    profiles = [_profile(), _profile(ter=1.4, domain="biotech")]
    first = derive_all(copy.deepcopy(profiles))
    second = derive_all(copy.deepcopy(profiles))
    for a, b in zip(first, second):
        graph_a = a["provenance"]["@graph"][0]
        graph_b = b["provenance"]["@graph"][0]
        assert graph_a["engine"] == a["name"]
        assert graph_a["code_version"] == CODE_VERSION
        assert graph_a["input_hashes"] == graph_b["input_hashes"]
        assert graph_a["params"] == graph_b["params"]
    # The top-level @context lives on the record itself.
    assert first[0]["provenance"]["@context"].startswith("https://w3id.org/ro/crate")


def test_verify_determinism_self_check_for_every_metric():
    profiles = [
        _profile(domain="sports", ter=0.3, generated_at="2026-01-01T00:00:00Z"),
        _profile(domain="sports", ter=0.7, generated_at="2026-01-02T00:00:00Z"),
        _profile(domain="biotech", ter=0.5, generated_at="2026-01-01T00:00:00Z"),
        _profile(domain="biotech", ter=0.9, generated_at="2026-01-02T00:00:00Z"),
        _profile(archetype="esa", gravity=0.4, flow=0.6, baseline_form=0.55,
                 generated_at="2026-01-03T00:00:00Z"),
    ]
    for metric in METRICS:
        report = verify_determinism(
            lambda _seed, fn=metric: fn(profiles), seeds=[1, 2], serializer=_serializer
        )
        assert report["ok"], report["checks"]
