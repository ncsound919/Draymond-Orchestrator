import * as path from 'node:path';
process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const { buildDecomposition, decomposeGoalToIdeSteps, decomposeGoalToBlueprint } = await import('../src/lib/draymond/decomposer');
  const AGENT_ROLES: Record<string, string> = {
    megacode: 'web and software development, code generation', rex: 'sales outreach',
    maya: 'marketing content, social media, copywriting', finn: 'invoicing, financial summaries',
    cleo: 'project management, scheduling', lexa: 'client onboarding',
    uplift: 'general research, coordination', riggs: 'software engineering, debugging',
    moss: 'research and OSINT, competitive intelligence', scribe: 'communications, email',
    echo: 'call center operations', hype: 'media and creative, scriptwriting',
  };
  const goals = [
    'write a marketing blog post about our new AI call-center product',
    'build a React landing page for the new fitness savings app',
    'research the competitive landscape for AI call centers',
    'analyze our monthly revenue data and produce a report',
    'organize the Q3 product launch event',
  ];

  console.log('== IDE steps adapter ==');
  const IDE_KINDS = new Set(['plan','codegen','edit','scan','analyze','symbols','test','typecheck','build','review','browser-check','command','git-status','git-diff','git-commit','diagnose','repair','verify','message']);
  const IDE_AGENTS = new Set(['uplift','mutly','agent-browser','megacode','big-homie','codegang','opencode']);
  for (const g of goals) {
    const s = decomposeGoalToIdeSteps(g, IDE_KINDS, IDE_AGENTS);
    console.log(`${g.slice(0,40)} => ${s}`);
  }

  console.log('\n== chain blueprint adapter ==');
  const catalog = [
    { slug: 'megacode', name: 'Megacode', kind: 'agent' },
    { slug: 'maya', name: 'Maya', kind: 'agent' },
    { slug: 'moss', name: 'Moss', kind: 'agent' },
    { slug: 'uplift', name: 'Uplift', kind: 'agent' },
  ];
  for (const g of goals.slice(0, 3)) {
    const s = decomposeGoalToBlueprint(g, catalog);
    console.log(`${g.slice(0,40)} => ${s}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
