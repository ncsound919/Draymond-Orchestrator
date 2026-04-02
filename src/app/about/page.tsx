import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About | The Uplift Lab",
  description:
    "Learn about The Uplift Lab's mission, governance model, and the team building the community operating system for Black empowerment.",
};

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden py-20 px-4">
        <div className="absolute inset-0 bg-[#0a0a0a]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(220,38,38,0.08)_0%,_transparent_60%)]" />
        <div className="relative max-w-4xl mx-auto">
          <div className="inline-block mb-4 px-4 py-1 rounded-full bg-[#dc2626]/10 text-[#dc2626] text-sm font-medium border border-[#dc2626]/20">
            About The Lab
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight text-white">
            We Build Infrastructure for{" "}
            <span className="text-[#22c55e]">Systemic Change</span>
          </h1>
          <p className="text-white/50 text-xl leading-relaxed max-w-3xl">
            The Uplift Lab is a community-owned, modular digital platform
            engineered to directly address systemic barriers facing the Black
            community across six critical domains: education, health, finance,
            entrepreneurship, justice, and community support.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-20 px-4 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-6">
            Our Mission
          </h2>
          <blockquote className="border-l-4 border-[#22c55e] pl-6 mb-8">
            <p className="text-xl italic text-white/70 leading-relaxed">
              &ldquo;The Uplift Lab is a community-owned, modular digital platform
              engineered to directly address systemic barriers facing the Black
              community. We build technology that empowers — never extracts.&rdquo;
            </p>
          </blockquote>
          <p className="text-white/40 text-lg leading-relaxed mb-6">
            The systemic challenges facing Black Americans are not isolated —
            they are interconnected. A mother navigating food insecurity is
            simultaneously dealing with healthcare gaps, educational barriers
            for her children, and financial exclusion. Yet the tools available
            to address these challenges are fragmented, underfunded, and rarely
            designed with or for the communities they claim to serve.
          </p>
          <p className="text-white/40 text-lg leading-relaxed">
            The Uplift Lab is the answer to that fragmentation. It is a modular,
            extensible platform — a community operating system — that weaves
            together purpose-built tools across six domains into a unified
            experience.
          </p>
        </div>
      </section>

      {/* Vision */}
      <section className="relative overflow-hidden py-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-r from-[#dc2626]/10 via-[#111111] to-[#22c55e]/10" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6 text-white">Our Vision</h2>
          <p className="text-xl text-white/50 leading-relaxed max-w-3xl mx-auto">
            To become the definitive operating system for Black community
            empowerment — open-source, extensible, and community-governed —
            serving as critical infrastructure that any city, organization, or
            community in America can deploy and customize to address their local
            needs.
          </p>
        </div>
      </section>

      {/* Key Differentiators */}
      <section className="py-20 px-4 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-10">
            What Makes Us <span className="text-[#dc2626]">Different</span>
          </h2>
          <div className="space-y-6">
            {[
              {
                title: "Community-First Governance",
                body: "Elected Community Advisory Board with binding input on product roadmap and data policies. This is not a platform built for the community — it is built by and with the community.",
              },
              {
                title: "Modular Architecture",
                body: "Six independent modules with clear bounded contexts, deployable individually or as a suite. Cities and organizations adopt what they need without buying the whole platform.",
              },
              {
                title: "Data Sovereignty",
                body: "Community members own their data. Granular opt-in consent, right to deletion, data portability, and a Community Data Governance Council with veto power over data partnerships.",
              },
              {
                title: "Culturally Resonant Design",
                body: "Built from the ground up with culturally competent UX, language, imagery, and content — not a generic platform with a diversity layer bolted on.",
              },
              {
                title: "Open-Source Core",
                body: "Core modules open-sourced under AGPL, enabling other communities to deploy, customize, and contribute back.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="glass-card flex gap-5 p-6"
              >
                <div className="flex-shrink-0 w-3 h-3 mt-2 rounded-full bg-[#22c55e]" />
                <div>
                  <h3 className="font-bold text-white text-lg mb-2">
                    {item.title}
                  </h3>
                  <p className="text-white/40 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="py-20 px-4 bg-[#111111]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-10 text-white">Development Roadmap</h2>
          <div className="space-y-6">
            {[
              {
                phase: "Phase 0",
                name: "Foundation",
                months: "Months 1–3",
                status: "current",
                items: [
                  "Core infrastructure: authentication, user profiles, notification engine",
                  "Design system v1: Tailwind + component library",
                  "Community module MVP: mutual aid board, event calendar, resource map",
                  "Data ethics framework: consent architecture, data governance",
                  "CI/CD pipeline (GitHub Actions), staging environment",
                ],
              },
              {
                phase: "Phase 1",
                name: "Empower",
                months: "Months 4–8",
                status: "upcoming",
                items: [
                  "Education module: LMS, scholarship finder, mentorship matching",
                  "Financial Empowerment module: financial literacy, budgeting tools",
                  "Analytics dashboard v1: community impact metrics",
                  "Search infrastructure for resource discovery across modules",
                ],
              },
              {
                phase: "Phase 2",
                name: "Expand",
                months: "Months 9–14",
                status: "future",
                items: [
                  "Health module: telehealth, food access, mental health screening",
                  "Entrepreneurship module: business tools, grant finder, Black business directory",
                  "AI/ML layer v1: recommendation engine",
                  "HIPAA compliance for Health module",
                ],
              },
              {
                phase: "Phase 3",
                name: "Advocate",
                months: "Months 15–20",
                status: "future",
                items: [
                  "Justice module: know-your-rights library, legal aid directory",
                  "Record expungement eligibility checker",
                  "Civic engagement tools: voter registration, representative contact",
                  "SOC 2 Type II certification",
                ],
              },
            ].map((phase) => (
              <div
                key={phase.phase}
                className={`glass-card p-6 ${
                  phase.status === "current"
                    ? "!border-[#22c55e]/30 glow-green"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      phase.status === "current"
                        ? "bg-[#22c55e] text-[#0a0a0a]"
                        : "bg-white/5 text-white/40"
                    }`}
                  >
                    {phase.status === "current"
                      ? "In Progress"
                      : phase.status === "upcoming"
                        ? "Upcoming"
                        : phase.status === "future"
                          ? "Future"
                          : "Planned"}
                  </span>
                  <span className="text-white/30 text-sm">{phase.months}</span>
                </div>
                <h3 className="text-xl font-bold mb-3 text-white">
                  {phase.phase}: {phase.name}
                </h3>
                <ul className="space-y-1">
                  {phase.items.map((item) => (
                    <li
                      key={item}
                      className="text-white/40 text-sm flex items-start gap-2"
                    >
                      <span className="text-[#22c55e] mt-0.5">→</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 bg-[#0a0a0a] text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Explore the Platform?
          </h2>
          <p className="text-white/40 mb-8">
            Discover the six modules built to address systemic barriers in the
            Black community.
          </p>
          <Link
            href="/#modules"
            className="inline-block px-8 py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors shadow-lg shadow-red-900/20"
          >
            View All Modules
          </Link>
        </div>
      </section>
    </>
  );
}
