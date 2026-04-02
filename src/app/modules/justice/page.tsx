import Link from 'next/link';

const legalCategories = [
  {
    id: 'police',
    icon: '🚔',
    title: 'Police Encounters & Your Rights',
    tag: 'Police & Civil Rights',
    tagColor: 'warning',
    description: 'What you can and cannot do during stops, searches, and arrests.',
    fastFacts: [
      'Invoke your right to remain silent clearly: "I am invoking my right to remain silent."',
      'You can refuse a search: "I do not consent to this search."',
      'If arrested, you have the right to an attorney — ask immediately.',
      'Ask "Am I being detained?" — if no, you are free to leave.',
      'Document officer names, badge numbers, witnesses after any encounter.',
    ],
    links: [
      { label: 'ACLU — Stopped by Police', url: 'https://www.aclu.org/know-your-rights/stopped-by-police' },
      { label: '4th Amendment — Cornell LII', url: 'https://www.law.cornell.edu/constitution/fourth_amendment' },
      { label: 'Filing a Police Complaint — ACLU', url: 'https://www.aclu.org/know-your-rights/what-to-do-if-your-rights-are-violated-by-law-enforcement' },
    ],
  },
  {
    id: 'court',
    icon: '⚖️',
    title: 'Courts, Criminal Records & Expungement',
    tag: 'Court System',
    tagColor: 'blue',
    description: 'Bail, public defenders, plea deals, expungement, and appeals explained.',
    fastFacts: [
      'You have the right to a speedy, public trial by jury.',
      'Never sign a plea deal without speaking to an attorney first — they are almost always permanent.',
      'Excessive bail is unconstitutional — you can file a motion to reduce.',
      'Expungement can seal past convictions from public records in most states.',
      'You can appeal on grounds of ineffective counsel, new evidence, or judicial error.',
    ],
    links: [
      { label: 'Criminal Procedure — Cornell LII', url: 'https://www.law.cornell.edu/wex/criminal_procedure' },
      { label: 'Innocence Project', url: 'https://www.innocenceproject.org/' },
      { label: 'Expungement Help — Clean Criminal Record', url: 'https://cleancriminalrecord.org/' },
    ],
  },
  {
    id: 'family',
    icon: '👨‍👧',
    title: 'Child Support, Custody & Family Court',
    tag: 'Family Law',
    tagColor: 'error',
    description: 'Support orders, custody disputes, modification, and parental rights.',
    fastFacts: [
      'Both parents are legally required to support children regardless of relationship status.',
      'Child support amounts are calculated using state income-based formulas — not arbitrary.',
      'You can request a modification if your income or circumstances change significantly.',
      'Unpaid support can lead to wage garnishment or license suspension — seek modification proactively.',
      'Custody is determined by the "best interest of the child" standard.',
    ],
    links: [
      { label: 'HHS Child Support Services', url: 'https://www.acf.hhs.gov/css' },
      { label: 'Child Support Law — Cornell LII', url: 'https://www.law.cornell.edu/wex/child_support' },
      { label: 'WomensLaw.org — Family Court Help', url: 'https://www.womenslaw.org/' },
      { label: 'National DV Hotline', url: 'https://www.thehotline.org/' },
    ],
  },
  {
    id: 'tax',
    icon: '🧾',
    title: 'Taxes, IRS & Tax Relief',
    tag: 'Taxes',
    tagColor: 'gold',
    description: 'Audits, unpaid taxes, IRS disputes, free filing, and EITC explained.',
    fastFacts: [
      'The IRS will NEVER call, email, or text demanding immediate payment — those are scams.',
      'If you cannot pay, file anyway — failure-to-file penalty is 5× worse than failure-to-pay.',
      'Free File is available for households earning under $79,000 — no paid preparer needed.',
      'The EITC can return thousands of dollars — many eligible families never claim it.',
      'The IRS Taxpayer Advocate Service (1-877-777-4778) is free and independent.',
    ],
    links: [
      { label: 'IRS Free File Program', url: 'https://www.irs.gov/freefile' },
      { label: 'IRS Taxpayer Advocate Service', url: 'https://www.taxpayeradvocate.irs.gov/' },
      { label: 'Earned Income Tax Credit (EITC)', url: 'https://www.eitc.irs.gov/' },
      { label: 'Low-Income Taxpayer Clinics (LITC)', url: 'https://www.irs.gov/individuals/low-income-taxpayer-clinics' },
    ],
  },
  {
    id: 'land',
    icon: '🏡',
    title: 'Land, Property & Eviction Rights',
    tag: 'Land & Property',
    tagColor: 'success',
    description: 'Protecting your land title, tenant rights, heirs property, and eminent domain.',
    fastFacts: [
      '"Heirs property" (land passed without a will) is extremely vulnerable — get a clear deed ASAP.',
      'Landlords must provide written notice before eviction — typically 30-60 days.',
      'You cannot be evicted without a court order — changing your locks is illegal self-help eviction.',
      'Eminent domain requires just compensation — you have the right to challenge the offer.',
      'A will is the single most important document to prevent heirs property fragmentation.',
    ],
    links: [
      { label: 'National Housing Law Project', url: 'https://www.nhlp.org/' },
      { label: 'HUD Tenant Rights by State', url: 'https://www.hud.gov/topics/rental_assistance/tenantrights' },
      { label: 'Heirs Property Help — Rural Community Assistance', url: 'https://www.ruralhome.org/what-we-do/landowner-services' },
      { label: 'Eminent Domain — Cornell LII', url: 'https://www.law.cornell.edu/wex/eminent_domain' },
    ],
  },
  {
    id: 'inheritance',
    icon: '📜',
    title: 'Wills, Estates & Inheritance',
    tag: 'Inheritance',
    tagColor: 'success',
    description: 'Protecting your legacy and navigating probate without losing assets.',
    fastFacts: [
      'Dying without a will (intestate) means the state — not your family — decides who gets your assets.',
      'A simple will can be created for free at FreeWill.com.',
      'Probate can take 1-3 years and cost 3-7% of estate value — a living trust avoids it.',
      'Beneficiary designations on accounts override your will — keep them updated.',
      'Transfer-on-death (TOD) deeds allow property to pass directly without probate in most states.',
    ],
    links: [
      { label: 'FreeWill.com — Free Will Builder', url: 'https://www.freewill.com/' },
      { label: 'Wills & Estates — Cornell LII', url: 'https://www.law.cornell.edu/wex/wills_trusts_and_estates' },
      { label: 'ABA Probate Guide for Consumers', url: 'https://www.americanbar.org/groups/public_education/resources/law_issues_for_consumers/probate/' },
    ],
  },
  {
    id: 'government',
    icon: '🏛️',
    title: 'Government Benefits & Appeals',
    tag: 'Government',
    tagColor: 'primary',
    description: 'SNAP, Social Security, disability, housing vouchers — and how to fight denials.',
    fastFacts: [
      'If your benefits are denied, you always have the right to appeal — request a hearing in writing.',
      'SNAP benefits cannot be reduced without prior written notice.',
      'Social Security Disability: 60%+ of initial claims are denied but many succeed on appeal.',
      'Federal agencies cannot discriminate in benefits based on race or national origin (Title VI).',
      'An advocate or attorney can represent you at benefit hearings at no cost.',
    ],
    links: [
      { label: 'Benefits.gov — Federal Benefit Finder', url: 'https://www.benefits.gov/' },
      { label: 'Social Security Disability — SSA.gov', url: 'https://www.ssa.gov/benefits/disability/' },
      { label: 'SNAP Eligibility — USDA', url: 'https://www.fns.usda.gov/snap/recipient/eligibility' },
      { label: 'HUD Fair Housing & Equal Opportunity', url: 'https://www.hud.gov/program_offices/fair_housing_equal_opp' },
    ],
  },
  {
    id: 'voting',
    icon: '🗳️',
    title: 'Voting Rights & Civic Protections',
    tag: 'Civic Rights',
    tagColor: 'primary',
    description: 'Voter registration, suppression, felony rights restoration, and more.',
    fastFacts: [
      'If you are in line when polls close, you have the legal right to stay and vote.',
      'Many states restore voting rights after completing a felony sentence — check your state.',
      'Voter intimidation or suppression is a federal crime — report to DOJ Voting Section.',
      'Provisional ballots protect your right to vote even when eligibility is questioned at the polls.',
      'Request your mail/absentee ballot early — requirements vary by state.',
    ],
    links: [
      { label: 'Vote.gov — Official Voter Registration', url: 'https://vote.gov/' },
      { label: 'ACLU Voting Rights Guide', url: 'https://www.aclu.org/know-your-rights/voting-rights' },
      { label: 'NAACP Voter Empowerment', url: 'https://www.naacp.org/campaigns/voter-empowerment/' },
      { label: 'DOJ Voting Rights Section', url: 'https://www.justice.gov/crt/voting-section' },
    ],
  },
];

const legalAidOrgs = [
  { name: 'Legal Services Corporation', type: 'National', desc: 'Largest funder of civil legal aid in the US. Connects you with local legal aid offices by zip code.', url: 'https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help' },
  { name: 'ACLU Know Your Rights', type: 'Civil Rights', desc: 'Free civil rights resources, know-your-rights guides, and legal representation.', url: 'https://www.aclu.org/know-your-rights' },
  { name: 'LawHelp.org', type: 'National', desc: 'State-by-state directory of free legal aid for housing, family, and benefits.', url: 'https://www.lawhelp.org/' },
  { name: 'Cornell Law LII', type: 'Reference', desc: 'Free comprehensive legal information — statutes, case law, and plain-English explanations.', url: 'https://www.law.cornell.edu/wex' },
  { name: 'NAACP Legal Defense Fund', type: 'Civil Rights', desc: 'Legal representation and advocacy on racial justice, voting rights, and criminal justice.', url: 'https://www.naacpldf.org/' },
  { name: 'Innocence Project', type: 'Criminal', desc: 'Works to exonerate wrongly convicted people through DNA evidence and systemic reform.', url: 'https://www.innocenceproject.org/' },
  { name: 'IRS Low-Income Taxpayer Clinics', type: 'Tax', desc: 'Free or low-cost representation in IRS disputes and collection matters.', url: 'https://www.irs.gov/individuals/low-income-taxpayer-clinics' },
  { name: 'HUD Housing Counselors', type: 'Housing', desc: 'Free HUD-approved counseling for eviction, foreclosure, and housing rights.', url: 'https://www.hud.gov/i_want_to/talk_to_a_housing_counselor' },
  { name: 'FreeWill.com', type: 'Estate', desc: 'Create a legally valid will, trust, or advance directive online — free in 20 minutes.', url: 'https://www.freewill.com/' },
];

export default function JusticePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] text-xs font-semibold uppercase tracking-wider mb-6">
            Free · Always Accessible
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-white mb-4">
            Uplift Law Library
          </h1>
          <p className="text-xl text-white/40 max-w-2xl mb-8">
            Fast facts, know-your-rights guides, and direct links to free legal aid — covering the issues that affect our community most. Always free.
          </p>
          <div className="p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-xl">
            <p className="text-sm text-yellow-200/80">
              <strong>⚠️ Disclaimer:</strong> This library provides general legal information, not legal advice. For your specific situation, consult a licensed attorney or contact a free legal aid organization.
            </p>
          </div>
        </div>
      </section>

      {/* Emergency Resources */}
      <section className="py-6 px-4 bg-[#dc2626]/10 border-y border-[#dc2626]/20">
        <div className="max-w-4xl mx-auto">
          <p className="font-semibold text-[#ef4444] mb-3">🚨 Need Legal Help Right Now?</p>
          <div className="flex flex-wrap gap-3">
            <a href="https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help" target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 bg-[#dc2626] text-white rounded-full text-sm font-semibold hover:bg-[#ef4444] transition shadow-lg shadow-red-900/20">
              Find Legal Aid by Zip
            </a>
            <a href="https://www.lawhelp.org/" target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 bg-[#dc2626] text-white rounded-full text-sm font-semibold hover:bg-[#ef4444] transition shadow-lg shadow-red-900/20">
              LawHelp.org
            </a>
            <a href="https://www.aclu.org/know-your-rights" target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 bg-[#dc2626] text-white rounded-full text-sm font-semibold hover:bg-[#ef4444] transition shadow-lg shadow-red-900/20">
              ACLU Know Your Rights
            </a>
          </div>
        </div>
      </section>

      {/* Legal Topics */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-serif font-bold text-white mb-2">Legal Topics & Fast Facts</h2>
          <p className="text-white/40 mb-10">Eight of the most common and impactful legal issues facing our community.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {legalCategories.map((cat) => (
              <div key={cat.id} className="glass-card p-6 flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <span className="text-3xl">{cat.icon}</span>
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide bg-white/5 text-white/40 mb-1">{cat.tag}</span>
                    <h3 className="text-lg font-semibold text-white leading-tight">{cat.title}</h3>
                    <p className="text-sm text-white/40 mt-1">{cat.description}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {cat.fastFacts.map((fact, i) => (
                    <div key={i} className="flex gap-2 text-sm p-2 bg-white/5 rounded-lg text-white/60">
                      <span className="text-[#22c55e] flex-shrink-0">⚡</span>
                      <span>{fact}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
                  {cat.links.map((link, i) => (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between px-3 py-2 rounded-lg border border-white/10 text-sm font-medium text-white/70 hover:border-[#22c55e]/50 hover:text-[#22c55e] hover:bg-[#22c55e]/5 transition">
                      <span>{link.label}</span>
                      <span className="text-white/30">→</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Legal Aid Directory */}
      <section className="py-16 px-4 bg-[#111111] border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-serif font-bold text-white mb-2">Free Legal Aid Directory</h2>
          <p className="text-white/40 mb-10">National organizations providing free or low-cost legal representation and guidance.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {legalAidOrgs.map((org, i) => (
              <div key={i} className="glass-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm text-white">{org.name}</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] font-medium">{org.type}</span>
                </div>
                <p className="text-xs text-white/40 leading-relaxed flex-1">{org.desc}</p>
                <a href={org.url} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-semibold text-[#8b5cf6] hover:underline">Visit Resource →</a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
