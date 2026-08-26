interface PlanetaryData {
  planet: string;
  mass: number; // kg
  radius: number; // km
  orbitalPeriod: number; // Earth days
  atmosphere: string[];
}

interface PlanetaryAnalysis {
  planet: string;
  classification: string;
  gravity: number; // m/s²
  orbitalPeriodEarthYears: number;
  atmosphereSummary: string;
}

export function analyzePlanetaryData(data: PlanetaryData): PlanetaryAnalysis {
  // Validate input
  if (!data.planet || !data.atmosphere) {
    throw new Error('Invalid planetary data: missing required fields');
  }
  if (data.mass <= 0) {
    throw new Error('Invalid planetary data: mass must be positive');
  }
  if (data.radius <= 0) {
    throw new Error('Invalid planetary data: radius must be positive');
  }
  if (data.orbitalPeriod <= 0) {
    throw new Error('Invalid planetary data: orbitalPeriod must be positive');
  }

  // Calculate gravity (g = GM/r²)
  const G = 6.67430e-11; // m³ kg⁻¹ s⁻²
  const massKg = data.mass;
  const radiusM = data.radius * 1000; // km to m
  const gravity = (G * massKg) / (radiusM * radiusM);

  // Determine classification
  const classification = data.mass < 1e25 ? 'Terrestrial' : 'Gas Giant';

  // Calculate orbital period in Earth years
  const orbitalPeriodEarthYears = Math.round((data.orbitalPeriod / 365.25) * 100) / 100;

  // Summarize atmosphere
  const atmosphereSummary = data.atmosphere.includes('CO2')
    ? 'CO2-dominant'
    : data.atmosphere.length > 0
      ? data.atmosphere.join('-dominant')
      : 'No significant atmosphere';

  return {
    planet: data.planet,
    classification,
    gravity,
    orbitalPeriodEarthYears,
    atmosphereSummary
  };
}