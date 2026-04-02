import Link from "next/link";
import Image from "next/image";
import MembershipBanner from "@/components/MembershipBanner";

const modules = [
  {
    name: "Uplift Learn",
    tagline: "Knowledge is liberation. Access is the key.",
    description:
      "Culturally relevant education, life skills training, scholarship finder, and mentorship matching built to close the achievement gap.",
    href: "/modules/learn",
    color: "#3b82f6",
    icon: "📚",
  },
  {
    name: "Uplift Health",
    tagline: "Your health. Your culture. Your care.",
    description:
      "Telehealth connections, food access mapping, mental health screening, maternal health tracker, and a culturally competent provider directory.",
    href: "/modules/health",
    color: "#14b8a6",
    icon: "💚",
  },
  {
    name: "Uplift Wealth",
    tagline: "Build wealth. Break cycles.",
    description:
      "Free financial literacy curriculum, budgeting tools, credit education, CDFI connector, and pathways to economic mobility.",
    href: "/modules/wealth",
    color: "#f59e0b",
    icon: "💰",
  },
  {
    name: "Uplift Ventures",
    tagline: "From idea to impact. Build Black.",
    description:
      "Business plan builder with AI, grant and microloan finder, mentor matching, and supplier diversity marketplace.",
    href: "/modules/ventures",
    color: "#ef4444",
    icon: "🚀",
  },
  {
    name: "Uplift Justice",
    tagline: "Know your rights. Reclaim your future.",
    description:
      "Know-your-rights library, legal aid directory, expungement checker, and reentry support resource hub.",
    href: "/modules/justice",
    color: "#8b5cf6",
    icon: "⚖️",
  },
  {
    name: "Uplift Community",
    tagline: "We are each other's infrastructure.",
    description:
      "Mutual aid request board, neighborhood resource map, volunteer matching, and civic engagement tools.",
    href: "/modules/community",
    color: "#a855f7",
    icon: "🤝",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a]">
      {/* Hero Section */}
      <header className="relative overflow-hidden px-4 py-24 text-center text-white sm:px-6 lg:px-8">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-[#0a0a0a] to-[#111111]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(34,197,94,0.08)_0%,_transparent_70%)]" />

        <div className="relative mx-auto max-w-4xl">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <Image
              src="/logo.svg"
              alt="The Uplift Lab logo"
              width={220}
              height={230}
              priority
              className="drop-shadow-2xl"
            />
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            The Uplift <span className="text-[#dc2626]">Lab</span>
          </h1>
          <p className="mt-6 text-xl font-medium text-[#22c55e] sm:text-2xl">
            The Operating System for Black Community Empowerment.
          </p>
          <p className="mt-4 text-lg text-white/50">
            A modular platform addressing education, health, finance, and justice — built for the community, owned by the community.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/modules"
              className="rounded-full bg-[#dc2626] px-8 py-3 text-lg font-bold text-white shadow-lg shadow-red-900/30 transition hover:bg-[#ef4444] focus:outline-none focus:ring-4 focus:ring-red-500/40"
            >
              Get Started Free
            </Link>
            <Link
              href="/about"
              className="rounded-full border border-white/10 bg-white/5 px-8 py-3 text-lg font-semibold text-white backdrop-blur-sm transition hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              Our Mission
            </Link>
          </div>
        </div>
      </header>

      {/* Impact Stats — moved above modules for better UX flow */}
      <section className="relative overflow-hidden py-20">
        <div className="absolute inset-0 bg-gradient-to-r from-[#dc2626]/10 via-transparent to-[#22c55e]/10" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">Bridging the <span className="text-[#dc2626]">Gap</span></h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              { stat: "$1.15M", label: "Mean wealth gap to bridge", color: "#22c55e" },
              { stat: "3x", label: "Maternal mortality disparity", color: "#dc2626" },
              { stat: "6x", label: "Incarceration rate disparity", color: "#dc2626" },
            ].map((item) => (
              <div key={item.stat} className="glass-card p-8">
                <div className="text-5xl font-extrabold" style={{ color: item.color }}>{item.stat}</div>
                <p className="mt-3 text-white/50">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-12 italic text-white/30 max-w-2xl mx-auto">
            &ldquo;The Uplift Lab is not just a platform; it&rsquo;s infrastructure for systemic change.&rdquo;
          </p>
        </div>
      </section>

      {/* Free Membership Banner */}
      <MembershipBanner />

      {/* Modules Section */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
            Six Domains of <span className="text-[#22c55e]">Empowerment</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/40">
            Every module is free to access. Choose where you want to start your journey today.
          </p>
        </div>

        <div className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.name}
              href={module.href}
              className="group glass-card flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1"
            >
              <div
                className="flex h-40 items-center justify-center text-6xl transition-transform duration-500 group-hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${module.color}15, ${module.color}05)` }}
              >
                {module.icon}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="text-lg font-bold text-white group-hover:text-[#22c55e] transition-colors">
                  {module.name}
                </h3>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color: module.color }}>
                  {module.tagline}
                </p>
                <p className="mt-3 flex-1 text-white/40 text-sm leading-relaxed">
                  {module.description}
                </p>
                <div className="mt-6 flex items-center text-sm font-bold text-[#22c55e]">
                  Explore Module <span className="ml-2 transition-transform group-hover:translate-x-1">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="relative overflow-hidden py-24 text-center">
        <div className="absolute inset-0 bg-gradient-to-t from-[#111111] to-[#0a0a0a]" />
        <div className="relative mx-auto max-w-2xl px-4">
          <h2 className="text-3xl font-bold text-white">Ready to join the <span className="text-[#dc2626]">movement</span>?</h2>
          <p className="mt-4 text-lg text-white/40">
            Create your free account today and get full access to all modules, resources, and community tools.
          </p>
          <div className="mt-10">
            <Link
              href="/auth/signup"
              className="rounded-full bg-[#22c55e] px-10 py-4 text-xl font-bold text-[#0a0a0a] shadow-xl shadow-green-900/30 transition hover:bg-[#4ade80] focus:outline-none focus:ring-4 focus:ring-green-500/40"
            >
              Sign Up Now — It&rsquo;s Free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
