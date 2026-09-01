# sports_science/validate_crosscheck.py
"""Independent re-derivation of the model concordance on the same data, so the
scorecard's headline number is cross-checked by a second implementation
(analogous to oncology's scikit-survival cross-check)."""


def independent_concordance(records: list[dict]) -> float:
    """Purely-pairwise concordance over (score, outcome). Hand-rolled, no reuse
    of validation_engine internals, so it can catch a bug in the primary path."""
    pairs = [(float(r["score"]), float(r["outcome"])) for r in records]
    concordant = discordant = tied = 0.0
    n = len(pairs)
    for i in range(n):
        s1, o1 = pairs[i]
        for j in range(i + 1, n):
            s2, o2 = pairs[j]
            d_out = o1 - o2
            if d_out == 0:
                continue
            d_score = s1 - s2
            if d_score == 0:
                tied += 1.0
            elif (d_score > 0) == (d_out > 0):
                concordant += 1.0
            else:
                discordant += 1.0
    denom = concordant + discordant + tied
    return (concordant + 0.5 * tied) / denom if denom else 0.0