import ModulePage from "@/components/ModulePage";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uplift Health | The Uplift Lab",
  description:
    "Telehealth connections, food access mapping, mental health screening, maternal health tracker, and a culturally competent provider directory.",
};

export default function HealthPage() {
  return (
    <ModulePage
      name="Uplift Health"
      tagline="Your health. Your culture. Your care."
      description="Black women face a maternal mortality rate over three times higher than white women. Black communities are disproportionately impacted by food deserts and lack of culturally competent care. Uplift Health provides free tools to bridge these gaps."
      color="#1a6b5a"
      bg="#e6f4f0"
      icon="❤️"
      targetUsers={[
        "Community Members",
        "Expecting Parents",
        "Mental Health Support Seekers",
        "Healthcare Providers",
        "Community Health Workers",
        "Food Insecure Households",
      ]}
      features={[
        {
          title: "Telehealth Connector",
          description: "Free access to culturally competent healthcare providers via video or chat.",
          icon: "📱",
        },
        {
          title: "Food Access Map",
          description: "Real-time mapping of local food banks, community gardens, and healthy grocery options.",
          icon: "🥗",
        },
        {
          title: "Maternal Health Tracker",
          description: "A specialized tool for Black mothers to track health metrics and receive culturally resonant advice.",
          icon: "🤱",
        },
        {
          title: "Mental Health Screening",
          description: "Free, confidential screenings and connection to support groups within the community.",
          icon: "🧠",
        },
      ]}
    >
      <section className="space-y-8">
        <div className="glass-card p-8 text-center border-[#14b8a6]/20">
          <h2 className="text-3xl font-bold text-white mb-4">Bridging the Healthcare Gap</h2>
          <p className="text-lg text-white/50 max-w-2xl mx-auto mb-6">
            We offer free, accessible health resources because wellness shouldn't be a luxury. Join our network of providers or find the care you deserve.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="https://findahealthcenter.hrsa.gov/" target="_blank" rel="noopener noreferrer"
              className="bg-white text-[#6b2137] px-6 py-3 rounded-xl font-bold hover:bg-opacity-90 transition-all">
              Find a Provider (Free)
            </a>
            <Link href="/network/new?type=story&module=health"
              className="border-2 border-white text-white px-6 py-3 rounded-xl font-bold hover:bg-white hover:text-[#6b2137] transition-all">
              Access Support Groups
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-2">Community Nutrition Program</h3>
            <p className="text-white/40 mb-4">Learn about healthy eating, urban farming, and how to access local fresh produce at no cost.</p>
            <Link href="/network/new?type=story&module=health" className="text-[#14b8a6] font-semibold hover:underline">Explore Resources →</Link>
          </div>
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-2">Wellness & Prevention</h3>
            <p className="text-white/40 mb-4">Access free screenings, vaccination info, and wellness workshops tailored for our community.</p>
            <Link href="/network/new?type=event&module=health" className="text-[#14b8a6] font-semibold hover:underline">See Upcoming Events →</Link>
          </div>
        </div>
      </section>
    </ModulePage>
  );
}
