_ARCHETYPES = {
    "viral": ("Explosive first-step attacker that infects the lane and spreads energy through the roster.", ("basketball", "football", "boxing")),
    "mutation": ("Unpredictable handles and shot creativity that mutate between sets and confound scouting.", ("basketball",)),
    "malignant": ("Dominant scorer that consumes possessions and oppresses defenders at the point of attack.", ("basketball", "boxing")),
    "cns_endocrine": ("High-IQ orchestrator that controls pace, alignment, and the hormonal rhythm of the team.", ("basketball", "football")),
    "master_regulator": ("System engine that raises the ceiling of every teammate and dictates both ends.", ("basketball", "football", "boxing")),
    "tcell": ("Relentless defender and spark plug that targets and neutralizes the opponent's key player.", ("basketball", "boxing")),
    "macrophage": ("Rebounding and grinder engine that cleans up mistakes and feeds second-chance possessions.", ("basketball", "football")),
    "invasive": ("Freak athlete that physically overwhelms and attacks the rim, backfield, or guard repeatedly.", ("basketball", "football", "boxing")),
    "rule_exploiter": ("Draws fouls and bends the rules to manufacture efficient, repeatable offense.", ("basketball",)),
}

_ALIASES = {
    "curry": "viral",
    "kyrie": "mutation",
    "jordan": "malignant",
    "jokic": "cns_endocrine",
    "lebron": "master_regulator",
    "draymond": "tcell",
    "rodman": "macrophage",
    "giannis": "invasive",
    "harden": "rule_exploiter",
    "luka": "rule_exploiter",
}

ARCHETYPES = {name: {"description": desc, "sports": list(sports)} for name, (desc, sports) in _ARCHETYPES.items()}

_SUPPORTED_SPORTS = ["basketball", "football", "boxing"]


def system_archetype(player_key):
    token = str(player_key).strip().lower().split()[0]
    name = _ALIASES.get(token, token)
    if name in _ARCHETYPES:
        return name
    raise KeyError(f"unknown player/archetype key: {player_key!r}")


def list_sports():
    return list(_SUPPORTED_SPORTS)


def list_archetypes_for_sport(sport):
    return [name for name, info in ARCHETYPES.items() if sport in info["sports"]]
