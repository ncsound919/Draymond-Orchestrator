import ModulePage from "@/components/ModulePage";
import Link from 'next/link';
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uplift Ventures | The Uplift Lab",
  description:
    "Business plan builder, grant and microloan finder, Black business directory, mentorship matching, and entrepreneurship analytics.",
};

export default function VenturesPage() {
  return (
    <ModulePage
      name="Uplift Ventures"
      tagline="Black founders. Funded. Supported. Seen."
      description="Black-founded startups received just 0.4% of all U.S. venture capital in 2024. Uplift Ventures levels the playing field with tools, community, and access to capital."
      color="#c04a2a"
      bg="#fdf0ec"
      icon="🚀"
      targetUsers={[
        "Aspiring Entrepreneurs",
        "Early-Stage Founders",
        "Small Business Owners",
        "Side Hustle Builders",
        "Social Entrepreneurs",
        "Investors & Mentors",
      ]}
      features={[
        {
          title: "AI Business Plan Builder",
          description:
            "Guided business plan creation with AI assistance — covering market research, financial projections, and pitch deck generation.",
        },
        {
          title: "Grant & Microloan Finder",
          description:
            "A curated database of non-dilutive funding specifically for Black and underrepresented founders.",
        },
        {
          title: "Black Business Directory",
          description:
            "Showcase your venture to a conscious consumer base and find local partners within the network.",
        },
      ]}
    >
      <section className="space-y-8">
        <div className="glass-card p-8 text-center border-[#ef4444]/20">
          <h2 className="text-3xl font-bold text-white mb-4">Build Your Empire (Free)</h2>
          <p className="text-lg text-white/50 max-w-2xl mx-auto mb-6">
            We provide the tools. You provide the vision. Access our full suite of entrepreneurship resources at zero cost.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan" target="_blank" rel="noopener noreferrer"
              className="bg-white text-[#c04a2a] px-6 py-3 rounded-xl font-bold hover:bg-opacity-90 transition-all">
              Start Your Plan
            </a>
            <a href="https://www.grants.gov/" target="_blank" rel="noopener noreferrer"
              className="border-2 border-white text-white px-6 py-3 rounded-xl font-bold hover:bg-white hover:text-[#c04a2a] transition-all">
              Find Funding
            </a>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-2">Startup OS</h3>
            <p className="text-white/40 mb-4">A complete operating system for your business, from incorporation guides to free legal templates.</p>
            <Link href="/network/new?type=story&module=ventures" className="text-[#ef4444] font-semibold hover:underline">Explore Resources →</Link>
          </div>
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-2">Mentorship Match</h3>
            <p className="text-white/40 mb-4">Connect with experienced founders and industry experts who understand your journey.</p>
            <Link href="/network/new?type=story&module=ventures" className="text-[#ef4444] font-semibold hover:underline">Get Matched →</Link>
          </div>
        </div>
      </section>
    </ModulePage>
  );
}
