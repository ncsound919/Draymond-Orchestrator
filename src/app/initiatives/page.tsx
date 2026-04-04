import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deficiencies & Implementations | The Uplift Lab",
  description:
    "A direct mapping of identified community deficiencies to concrete implementation tracks in The Uplift Lab build.",
};

type Initiative = {
  deficiency: string;
  implementation: string;
  module: string;
};

const initiativeGroups: { domain: string; items: Initiative[] }[] = [
  {
    domain: "Economic Justice & Wealth",
    items: [
      {
        deficiency: "Algorithmic Banking Bias (Digital Redlining)",
        implementation:
          "Bias-audit scoring layer for lending recommendations, with fairness diagnostics and community review checkpoints.",
        module: "Uplift Wealth",
      },
      {
        deficiency: "Lack of Generational Wealth",
        implementation:
          "Community investment circles and transparent shared-ownership ledger patterns for cooperative asset building.",
        module: "Uplift Wealth",
      },
      {
        deficiency: "High Remittance Fees",
        implementation:
          "Low-fee remittance pathway discovery and comparison flow to route users toward lower-cost options.",
        module: "Uplift Wealth",
      },
      {
        deficiency: "Limited Access to Capital",
        implementation:
          "Founder-investor matching, non-traditional funder discovery, and readiness guidance for capital applications.",
        module: "Uplift Ventures",
      },
      {
        deficiency: "Job Displacement Due to Automation",
        implementation:
          "AI career transition pathways with role-based training plans and credential milestones.",
        module: "Uplift Learn",
      },
    ],
  },
  {
    domain: "Healthcare Equity",
    items: [
      {
        deficiency: "Diagnostic Disparities in Healthcare",
        implementation:
          "Diagnostic equity evidence library and model-diversity audit requirements for partner tools.",
        module: "Uplift Health",
      },
      {
        deficiency: "Sickle Cell Disease Care",
        implementation:
          "Crisis-prevention tracking workflow with symptom logs, reminders, and escalation guidance.",
        module: "Uplift Health",
      },
      {
        deficiency: "Maternal Mortality Rates",
        implementation:
          "Maternal risk support pathway with culturally competent care matching and milestone check-ins.",
        module: "Uplift Health",
      },
      {
        deficiency: "Telehealth Access Gaps",
        implementation:
          "Secure telehealth connector pathway with records portability and rural-access prioritization.",
        module: "Uplift Health",
      },
      {
        deficiency: "Environmental Health Threats",
        implementation:
          "Neighborhood environmental watch surface for risk signals and community reporting.",
        module: "Uplift Health + Community",
      },
    ],
  },
  {
    domain: "Education & Digital Literacy",
    items: [
      {
        deficiency: "Academic Achievement Gap",
        implementation:
          "Personalized tutoring tracks with adaptive content recommendations by learner needs.",
        module: "Uplift Learn",
      },
      {
        deficiency: "The Digital Divide",
        implementation:
          "Low-bandwidth learning mode and local connectivity resource coordination.",
        module: "Uplift Learn + Community",
      },
      {
        deficiency: "Lack of Tech Talent Pipeline",
        implementation:
          "Coding and AI literacy progression from beginner to job-ready competency paths.",
        module: "Uplift Learn",
      },
      {
        deficiency: "Documenting Black History",
        implementation:
          "Community archive ingestion, transcription, and searchable oral history indexing.",
        module: "Uplift Learn",
      },
    ],
  },
  {
    domain: "Social Justice & Governance",
    items: [
      {
        deficiency: "Biased Facial Recognition",
        implementation:
          "Civil-rights AI audit toolkit requirements for any surveillance-related integrations.",
        module: "Uplift Justice",
      },
      {
        deficiency: "Disinformation Targeting",
        implementation:
          "Civic information verification workflows and campaign pattern reporting channels.",
        module: "Uplift Justice + Community",
      },
      {
        deficiency: "Eviction and Housing Injustice",
        implementation:
          "Tenant defense workflow with eviction-rights prompts and legal aid escalation paths.",
        module: "Uplift Justice",
      },
      {
        deficiency: "Inequitable Public Services",
        implementation:
          "Community budgeting participation workflows with transparent voting records.",
        module: "Uplift Community",
      },
      {
        deficiency: "Criminal Justice Sentencing Bias",
        implementation:
          "Sentencing-bias awareness resources with legal support and appeal-readiness flows.",
        module: "Uplift Justice",
      },
    ],
  },
  {
    domain: "Cultural & Professional Development",
    items: [
      {
        deficiency: "Intellectual Property Theft",
        implementation:
          "Creator rights toolkit with provenance tracking and ownership documentation.",
        module: "Uplift Ventures + Community",
      },
      {
        deficiency: "Hiring Discrimination",
        implementation:
          "Fair hiring prep tools including blind-resume formatting and bias-check guidance.",
        module: "Uplift Ventures",
      },
      {
        deficiency: "Misrepresentation in Generative AI",
        implementation:
          "Representation quality rubric and dataset-diversity standards for AI experiences.",
        module: "Uplift Learn + Ventures",
      },
      {
        deficiency: "Supply Chain Inequity",
        implementation:
          "Supplier fairness and traceability profiles for Black-owned business ecosystems.",
        module: "Uplift Ventures",
      },
      {
        deficiency: "Lack of Representation in Tech Leadership",
        implementation:
          "Leadership mentorship pathways and executive visibility network tracks.",
        module: "Uplift Community + Ventures",
      },
      {
        deficiency: "Data Privacy Protection",
        implementation:
          "Community-first privacy controls with consent transparency and data portability.",
        module: "Platform-wide",
      },
    ],
  },
];

export default function InitiativesPage() {
  const totalItems = initiativeGroups.reduce(
    (sum, group) => sum + group.items.length,
    0
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <span className="inline-flex rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
            Deficiencies Implemented into Build
          </span>
          <h1 className="mt-5 text-4xl font-extrabold text-white sm:text-5xl">
            Deficiency-to-Implementation Map
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-white/50">
            This page operationalizes your full issue list by mapping each
            deficiency to a concrete implementation track in the current product
            architecture.
          </p>
          <div className="mt-8 inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            <span className="font-bold text-[#22c55e]">{totalItems}</span>
            <span className="ml-2">targeted deficiencies now represented</span>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-8">
          {initiativeGroups.map((group) => (
            <div key={group.domain} className="glass-card p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-white">{group.domain}</h2>
              <div className="mt-6 grid gap-4">
                {group.items.map((item) => (
                  <article
                    key={item.deficiency}
                    className="rounded-xl border border-white/10 bg-white/5 p-5"
                  >
                    <p className="text-sm font-semibold uppercase tracking-wide text-[#ef4444]">
                      Deficiency
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-white">
                      {item.deficiency}
                    </h3>

                    <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-[#22c55e]">
                      Build Implementation
                    </p>
                    <p className="mt-1 text-white/70">{item.implementation}</p>

                    <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-white/40">
                      Primary Module:{" "}
                      <span className="text-white/70">{item.module}</span>
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
