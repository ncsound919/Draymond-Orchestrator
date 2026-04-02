import ModulePage from "@/components/ModulePage";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uplift Community | The Uplift Lab",
  description:
    "Mutual aid board, event calendar, neighborhood resource map, civic engagement tools, and crisis response coordination.",
};

export default function CommunityPage() {
  return (
    <ModulePage
      name="Uplift Community"
      tagline="Together, we rise."
      description="The Uplift Community module is the heartbeat of the platform — connecting neighbors through mutual aid, local organizing, and collective care."
      color="#5a2a6b"
      bg="#f2eaf6"
      icon="🤝"
      targetUsers={[
        "Community Members",
        "Mutual Aid Organizers",
        "Neighborhood Leaders",
        "Nonprofit Staff",
        "Civic Engagement Coordinators",
        "Crisis Response Volunteers",
      ]}
      features={[
        {
          title: "Mutual Aid Board",
          description:
            "Post and respond to requests and offers for goods, services, and support — food, transportation, childcare, skills, and more.",
        },
        {
          title: "Resource Mapping",
          description:
            "A community-curated map of free resources: community fridges, pantries, cooling centers, and safe spaces.",
        },
        {
          title: "Organizing Toolkit",
          description:
            "Tools for block captains and neighborhood organizers to coordinate events, meetings, and local advocacy.",
        },
      ]}
    >
      <section className="space-y-8">
        <div className="glass-card p-8 text-center border-[#a855f7]/20">
          <h2 className="text-3xl font-bold text-white mb-4">Connect & Support (Free)</h2>
          <p className="text-lg text-white/50 max-w-2xl mx-auto mb-6">
            Building community is an act of resistance. Join our network of mutual aid and local organizing today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/network/new?type=mutual_aid_request&module=community"
              className="bg-white text-[#5a2a6b] px-6 py-3 rounded-xl font-bold hover:bg-opacity-90 transition-all">
              Request Support
            </Link>
            <Link href="/network/new?type=mutual_aid_offer&module=community"
              className="border-2 border-white text-white px-6 py-3 rounded-xl font-bold hover:bg-white hover:text-[#5a2a6b] transition-all">
              Offer Support
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-xl font-bold mb-2">Local Events</h3>
            <p className="text-gray-600 mb-4">Find town halls, volunteer opportunities, and community celebrations in your area.</p>
            <Link href="/network/new?type=event&module=community" className="text-[#5a2a6b] font-semibold hover:underline">View Calendar →</Link>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-xl font-bold mb-2">Civic Action</h3>
            <p className="text-gray-600 mb-4">Get notified about local policy changes and learn how to advocate for your neighborhood.</p>
            <Link href="/network/new?type=announcement&module=community" className="text-[#5a2a6b] font-semibold hover:underline">Take Action →</Link>
          </div>
        </div>
      </section>
    </ModulePage>
  );
}
