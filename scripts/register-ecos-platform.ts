import { registerEntity } from '../src/lib/draymond/registry';

async function main() {
  const result = await registerEntity({
    name: 'ECOS Environmental Initiatives',
    slug: 'ecos-environmental-initiatives',
    kind: 'service',
    description:
      'Overlay365 Environmental pillar (13 interconnected climate-tech businesses). ' +
      'FastAPI revenue engine (challenges, membership, marketplace, gamification, DIY kits) with ' +
      'real telemetry-driven analytics and carbon-credit computation. Next.js web app brands as Overlay365. ' +
      'Monorepo adopted at 01_Platforms/ECOS-Environmental-Initiatives.',
    version: '1.0.0',
    tags: ['environment', 'climate', 'platform', 'revenue', 'iot', 'carbon'],
    category: 'environment',
    sector: 'ventures',
    invocation_method: 'internal',
    capabilities: [
      'environmental_monitoring',
      'revenue_engine',
      'carbon_credits',
      'iot_telemetry',
      'challenge_management',
      'membership_tiers',
      'marketplace',
      'gamification',
      'diy_kits',
    ],
    source_type: 'platform',
    source_url: 'https://github.com/ncsound919/Environmental-Initiatives-',
    download_path: '01_Platforms/ECOS-Environmental-Initiatives',
    is_free: true,
    is_integrated: true,
    is_active: true,
    risk_level_default: 'low',
  });
  console.log('REGISTERED', JSON.stringify({ id: result.id, slug: result.slug, kind: result.kind }, null, 2));
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
