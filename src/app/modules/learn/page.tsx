import ModulePage from "@/components/ModulePage";
import HistoryHeroes from "@/components/HistoryHeroes";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uplift Learn | The Uplift Lab",
  description:
    "Free culturally relevant education, life skills training, scholarship finder, and mentorship matching for Black community empowerment.",
};

export default function LearnPage() {
  return (
    <ModulePage
      name="Uplift Learn"
      tagline="Knowledge is liberation. Access is the key."
      description="The achievement gap isn't about ability — it's about access and representation. Uplift Learn provides high-quality, free education and life skills training that centers our culture."
      color="#3b82f6"
      bg="#e8f0f8"
      icon="📚"
      targetUsers={[
        "Students K-12",
        "College & Graduate Students",
        "Adult Learners",
        "Educators & Tutors",
        "HBCU Faculty & Staff",
        "Digital Literacy Beginners",
      ]}
      features={[
        {
          title: "Culturally Relevant LMS",
          description:
            "A library of courses in history, STEM, arts, and professional skills that center Black perspectives and excellence.",
        },
        {
          title: "Scholarship & Grant Finder",
          description:
            "Interactive database of financial aid opportunities matched specifically to your academic profile and goals.",
        },
        {
          title: "Mentorship Matching Engine",
          description:
            "Connect with professionals and elders in your field for 1:1 guidance, career advice, and community wisdom.",
        },
        {
          title: "Digital Literacy Bootcamps",
          description:
            "Self-paced training from device basics to coding and AI, designed to close the digital divide.",
        },
      ]}
    >
      <div className="mt-12 space-y-16">
        {/* Interactive Component */}
        <section aria-label="Interactive Black History">
          <HistoryHeroes />
        </section>

        {/* Life Skills Grid */}
        <section className="glass-card p-8">
          <h2 className="text-2xl font-bold text-[#3b82f6]">Life Skills & Professional Training</h2>
          <p className="mt-2 text-white/40">Essential skills for personal growth and career success.</p>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Public Speaking & Leadership",
                icon: "🎤",
                desc: "Find your voice and lead with confidence.",
              },
              {
                title: "Digital Productivity",
                icon: "💻",
                desc: "Master tools like Google Workspace, Slack, and AI.",
              },
              {
                title: "Career Path Mapping",
                icon: "🗺️",
                desc: "Define your goals and build a roadmap to your dream job.",
              },
              {
                title: "Health & Wellness Literacy",
                icon: "🧘",
                desc: "Navigate the healthcare system and prioritize self-care.",
              },
              {
                title: "Civic Engagement 101",
                icon: "🗳️",
                desc: "Learn how to organize and advocate for your community.",
              },
              {
                title: "Creative Arts & Media",
                icon: "🎨",
                desc: "Express your story through digital and traditional media.",
              },
            ].map((skill) => (
              <div
                key={skill.title}
                className="group rounded-xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10 hover:border-white/20"
              >
                <div className="text-3xl" aria-hidden="true">
                  {skill.icon}
                </div>
                <h3 className="mt-4 font-bold text-[#3b82f6]">{skill.title}</h3>
                <p className="mt-2 text-sm text-white/40">{skill.desc}</p>
                <Link href="/network/new?type=event&module=learn" className="mt-4 text-sm font-bold text-[#3b82f6] transition group-hover:underline">
                  Join Workshop →
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Mentorship CTA */}
        <section className="flex flex-col items-center overflow-hidden rounded-2xl bg-[#111111] border border-white/10 text-white shadow-xl lg:flex-row">
          <div className="flex-1 p-8 lg:p-12">
            <h2 className="text-3xl font-bold">Find Your Mentor</h2>
            <p className="mt-4 text-white/40">
              You don't have to walk the path alone. Connect with a mentor who has been where you are
              and can help you get where you're going.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/network/new?type=story&module=learn" className="rounded-full bg-white px-8 py-3 font-bold text-[#1a4a7a] transition hover:bg-blue-50">
                Match Me Now
              </Link>
              <Link href="/network/new?type=announcement&module=learn" className="rounded-full border-2 border-white/30 px-8 py-3 font-bold text-white transition hover:bg-white/10">
                Become a Mentor
              </Link>
            </div>
          </div>
          <div className="hidden h-64 w-64 items-center justify-center bg-[#3b82f6]/10 text-8xl lg:flex">
            🤝
          </div>
        </section>
      </div>
    </ModulePage>
  );
}
