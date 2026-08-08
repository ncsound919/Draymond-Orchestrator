// ============================================================================
// Roster → GitHub repo map
// ============================================================================
// Maps Draymond agent/entity slugs to the GitHub repositories they ship, so
// the RepoRank / Grader / Vibe-Reality deep-scorers have a real repo to grade.
// URLs were derived from the local git checkouts under agents/ (credentials
// stripped) plus known public repos. Add entries as agents gain repos.
// ============================================================================

/** Sanitized slug → GitHub repo URL (never embed credentials). */
export const ROSTER_REPOS: Record<string, string> = {
  'sports-steve': 'https://github.com/ncsound919/Sports-Steve',
  'sub-team': 'https://github.com/ncsound919/Sub-Team',
  riggs: 'https://github.com/ncsound919/Sub-Team',
  moss: 'https://github.com/ncsound919/Sub-Team',
  echo: 'https://github.com/ncsound919/Sub-Team',
  hype: 'https://github.com/ncsound919/Sub-Team',
  grader: 'https://github.com/tap919/Grader',
  reporank: 'https://github.com/ncsound919/reporank',
  mutly: 'https://github.com/tap919/Mutly-Daemon-Agent',
  'agent-browser': 'https://github.com/ncsound919/AgentBrowser',
  'claw-protect': 'https://github.com/tap919/Claw-Protect',
  openchat: 'https://github.com/ncsound919/Open-Chat',
};

/** Resolve a slug's GitHub repo, falling back to the agent's own source_url. */
export function resolveRosterRepo(
  slug: string,
  sourceUrl?: string | null
): string | null {
  if (ROSTER_REPOS[slug]) return ROSTER_REPOS[slug];
  if (sourceUrl && typeof sourceUrl === 'string' && sourceUrl.trim()) {
    const trimmed = sourceUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  }
  return null;
}
