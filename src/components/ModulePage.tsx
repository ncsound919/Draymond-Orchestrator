import Link from "next/link";
import type { ReactNode } from "react";

interface Feature {
  title: string;
  description: string;
  icon?: string;
}

interface ModulePageProps {
  name: string;
  tagline: string;
  description: string;
  color: string;
  bg: string;
  icon: string;
  features: Feature[];
  comingSoon?: boolean;
  targetUsers: string[];
  children?: ReactNode;
}

export default function ModulePage({
  name,
  tagline,
  description,
  color,
  bg,
  icon,
  features,
  comingSoon,
  targetUsers,
  children,
}: ModulePageProps) {
  return (
    <>
      {/* Hero */}
      <section
        className="relative py-20 px-4 text-white overflow-hidden"
      >
        <div className="absolute inset-0 bg-[#0a0a0a]" />
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: `radial-gradient(ellipse at center, ${color}40, transparent 70%)` }}
        />
        <div className="relative max-w-4xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-white/40 hover:text-white text-sm mb-6 transition-colors"
          >
            ← Back to Platform
          </Link>
          <div className="flex items-center gap-4 mb-4">
            <span className="text-5xl">{icon}</span>
            {comingSoon && (
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/10 text-white border border-white/10">
                Coming Soon
              </span>
            )}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">{name}</h1>
          <p className="text-xl italic text-white/50 mb-6">&ldquo;{tagline}&rdquo;</p>
          <p className="text-lg text-white/50 max-w-2xl leading-relaxed">
            {description}
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-8">
            Module Features
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass-card p-6"
              >
                <div
                  className="w-2 h-6 rounded-full mb-3"
                  style={{ backgroundColor: color }}
                />
                <h3
                  className="font-bold text-lg mb-2"
                  style={{ color }}
                >
                  {feature.title}
                </h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Target Users */}
      <section className="py-16 px-4" style={{ backgroundColor: bg }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6" style={{ color }}>
            Who This Module Serves
          </h2>
          <div className="flex flex-wrap gap-3">
            {targetUsers.map((user) => (
              <span
                key={user}
                className="px-4 py-2 rounded-full text-sm font-medium text-white border border-white/10"
                style={{ backgroundColor: `${color}20`, borderColor: `${color}40` }}
              >
                {user}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Module-specific content */}
      {children && (
        <section className="py-16 px-4 bg-[#0a0a0a]">
          <div className="max-w-5xl mx-auto">{children}</div>
        </section>
      )}

      {/* CTA */}
      <section className="py-16 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-[#111111] to-[#0a0a0a]" />
        <div className="relative max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4 text-white">
            {comingSoon
              ? "This Module Is In Development"
              : "Ready to Get Started?"}
          </h2>
          <p className="text-white/40 mb-6 text-sm">
            {comingSoon
              ? "Join our community to be notified when this module launches and to have input on its development."
              : "The Uplift Lab is community-owned and community-governed. Your voice shapes the platform."}
          </p>
          <Link
            href="/#modules"
            className="inline-block px-6 py-2.5 bg-[#22c55e] text-[#0a0a0a] font-semibold rounded-full hover:bg-[#4ade80] transition-colors text-sm shadow-lg shadow-green-900/20"
          >
            Explore All Modules
          </Link>
        </div>
      </section>
    </>
  );
}
