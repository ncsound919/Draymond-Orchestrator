import { describe, test, expect } from 'vitest';
import { describe, test, expect } from 'vitest';
import { analyzePlanetaryData } from '../../src/agents/planetary-analyzer';

describe('planetary-analyzer', () => {
  test('analyzes valid planetary data and returns structured results', () => {
    const input = {
      planet: 'Mars',
      mass: 6.39e23,
      radius: 3389.5,
      orbitalPeriod: 687,
      atmosphere: ['CO2', 'N2', 'Ar']
    };

    const result = analyzePlanetaryData(input);

    expect(result).toEqual({
      planet: 'Mars',
      classification: 'Terrestrial',
      gravity: expect.closeTo(3.71, 2),
      orbitalPeriodEarthYears: 1.88,
      atmosphereSummary: 'CO2-dominant'
    });
  });

  test('throws error for invalid mass', () => {
    const input = {
      planet: 'Mars',
      mass: -6.39e23,
      radius: 3389.5,
      orbitalPeriod: 687,
      atmosphere: ['CO2']
    };

    expect(() => analyzePlanetaryData(input)).toThrow('Invalid planetary data: mass must be positive');
  });

  test('throws error for missing required fields', () => {
    const input = {
      planet: 'Mars',
      mass: 6.39e23
      // Missing radius, orbitalPeriod, atmosphere
    };

    expect(() => analyzePlanetaryData(input)).toThrow('Invalid planetary data: missing required fields');
  });
});