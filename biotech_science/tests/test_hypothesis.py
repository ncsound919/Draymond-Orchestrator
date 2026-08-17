# biotech_science/tests/test_hypothesis.py
from biotech_science.hypothesis import generate_hypothesis, score_hypothesis_against_kb


def test_generate_hypothesis_cancer_domain():
    h = generate_hypothesis("breast carcinoma", "HER2", knowledge_base="clinical trial phase 3 efficacy survival")
    assert h["domain"] == "cancer"
    assert h["target"] == "HER2"
    assert h["modality"] == "small_molecule"
    assert "proposed_intervention" in h
    assert "testable_prediction" in h
    assert 0.0 <= h["confidence"] <= 1.0
    assert isinstance(h["flaws"], list) and h["flaws"]
    assert 0.0 <= h["critic_score"] <= 1.0
    assert h["knowledge_based"] is True


def test_generate_hypothesis_deterministic():
    a = generate_hypothesis("lung cancer", "EGFR", "")
    b = generate_hypothesis("lung cancer", "EGFR", "")
    assert a == b


def test_domain_infection():
    h = generate_hypothesis("viral hepatitis", "NS5A")
    assert h["domain"] == "infection"
    assert h["modality"] == "antimicrobial"


def test_kb_contradiction_lowers_confidence():
    h = generate_hypothesis("cancer", "T", knowledge_base="disproved ineffective")
    scored = score_hypothesis_against_kb(h, "disproved ineffective")
    assert scored["contradictions"]
    assert scored["confidence"] < h["confidence"]


def test_kb_boost_raises_confidence():
    h = generate_hypothesis("cancer", "T", knowledge_base="clinical trial efficacy survival")
    scored = score_hypothesis_against_kb(h, "clinical trial efficacy survival")
    assert not scored["contradictions"]
    assert scored["confidence"] >= h["confidence"]


def test_empty_kb_no_contradictions():
    h = generate_hypothesis("cancer", "T", "")
    scored = score_hypothesis_against_kb(h, "")
    assert scored["contradictions"] == []
    assert scored["evidence_tier"] == "E3"
