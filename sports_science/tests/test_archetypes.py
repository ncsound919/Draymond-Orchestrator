# sports_science/tests/test_archetypes.py
from sports_science.archetypes import (
    system_archetype,
    list_sports,
    list_archetypes_for_sport,
)


def test_archetype_registry_covers_all_sports():
    for sport in ("basketball", "football", "boxing"):
        assert len(list_archetypes_for_sport(sport)) >= 3


def test_known_archetype_resolves():
    assert system_archetype("Curry") == "viral"


def test_list_sports_matches_scope():
    assert set(list_sports()) == {"basketball", "football", "boxing"}
