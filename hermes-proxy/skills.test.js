import { describe, it, expect } from 'vitest';
import { matchSkills } from './skills.js';

describe('skills trigger matching', () => {
  it('matches email/memo triggers', () => {
    const packs = matchSkills('please send a memo to tap4500@gmail.com');
    expect(packs.some((p) => p.id === 'email')).toBe(true);
  });
  it('matches aetherdesk/leads/campaign triggers', () => {
    const packs = matchSkills('launch the campaign for our leads');
    expect(packs.some((p) => p.id === 'crm')).toBe(true);
  });
  it('returns [] when nothing matches', () => {
    expect(matchSkills('hello there')).toEqual([]);
  });
});
