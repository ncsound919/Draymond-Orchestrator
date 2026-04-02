import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Modules | The Uplift Lab",
  description:
    "Explore all six empowerment modules: Learn, Health, Wealth, Ventures, Justice, and Community.",
};

const modules = [
  {
    name: "Uplift Learn",
    tagline: "Knowledge is liberation. Access is the key.",
    description:
      "Culturally relevant education, life skills training, scholarship finder, and mentorship matching built to close the achievement gap.",
    href: "/modules/learn",
    color: "#1a4a7a",
    bg: "#e8f0f8",
    icon: "📚",
  },
  {
    name: "Uplift Health",
    tagline: "Your health. Your culture. Your care.",
    description:
      "Telehealth connections, food access mapping, mental health screening, maternal health tracker, and a culturally competent provider directory.",
    href: "/modules/health",
    color: "#1a6b5a",
    bg: "#e6f4f0",
    icon: "💚",
  },
  {
    name: "Uplift Wealth",
    tagline: "Build wealth. Break cycles.",
    description:
      "Free financial literacy curriculum, budgeting tools, credit education, CDFI connector, and pathways to economic mobility.",
    href: "/modules/wealth",
    color: "#b87514",
    bg: "#fdf4e0",
    icon: "💰",
  },
  {
    name: "Uplift Ventures",
    tagline: "From idea to impact. Build Black.",
    description:
      "Business plan builder with AI, grant and microloan finder, mentor matching, and supplier diversity marketplace.",
    href: "/modules/ventures",
    color: "#9a4a2a",
    bg: "#f8eee8",
    icon: "🚀",
  },
  {
    name: "Uplift Justice",
    tagline: "Know your rights. Reclaim your future.",
    description:
      "Know-your-rights library, legal aid directory, expungement checker, and reentry support resource hub.",
    href: "/modules/justice",
    color: "#4a3a8a",
    bg: "#f0eff8",
    icon: "⚖️",
  },
  {
    name: "Uplift Community",
    tagline: "We are each other's infrastructure.",
    description:
      "Mutual aid request board, neighborhood resource map, volunteer matching, and civic engagement tools.",
    href: "/modules/community",
    color: "#6a2a7a",
    bg: "#f8e8f8",
    icon: "🤝",
  },
];

export default function ModulesPage() {
  return (
    <div className="min-h-screen bg-[#faf6e6]">
      {/* Hero */}
      <section className="bg-[#2d4a1a] px-4 py-16 text-center text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Six Domains of Empowerment
          </h1>
          <p className="mt-4 text-lg text-green-200/80">
            Every module is free to access. Choose where you want to start your journey today.
          </p>
        </div>
      </section>

      {/* Module Grid */}
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <Link
              key={mod.name}
              href={mod.href}
              className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-[#c8a415]/50"
            >
              <div
                className="flex h-48 items-center justify-center text-7xl transition-transform duration-500 group-hover:scale-110"
                style={{ backgroundColor: mod.bg }}
              >
                {mod.icon}
              </div>
              <div className="flex flex-1 flex-col p-8">
                <h2 className="text-xl font-bold text-slate-900 group-hover:text-[#2d4a1a]">
                  {mod.name}
                </h2>
                <p
                  className="mt-2 text-sm font-semibold uppercase tracking-wider"
                  style={{ color: mod.color }}
                >
                  {mod.tagline}
                </p>
                <p className="mt-4 flex-1 text-slate-600 leading-relaxed">
                  {mod.description}
                </p>
                <div className="mt-8 flex items-center font-bold text-[#2d4a1a]">
                  Explore Module{" "}
                  <span className="ml-2 transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
