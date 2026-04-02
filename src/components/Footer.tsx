import Link from "next/link";
import Image from "next/image";
import FooterYear from "@/components/FooterYear";

const modules = [
  { name: "Learn", href: "/modules/learn" },
  { name: "Health", href: "/modules/health" },
  { name: "Wealth", href: "/modules/wealth" },
  { name: "Ventures", href: "/modules/ventures" },
  { name: "Justice", href: "/modules/justice" },
  { name: "Community", href: "/modules/community" },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Image
                src="/logo-mark.svg"
                alt="The Uplift Lab"
                width={36}
                height={36}
              />
              <span className="font-bold text-lg text-white">
                The Uplift <span className="text-[#dc2626]">Lab</span>
              </span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed">
              The community operating system for Black empowerment. Built by and
              with the community — never extracting, always uplifting.
            </p>
          </div>

          {/* Modules */}
          <div>
            <h3 className="font-semibold text-[#22c55e] mb-4 text-sm uppercase tracking-wider">
              Modules
            </h3>
            <ul className="space-y-2">
              {modules.map((mod) => (
                <li key={mod.name}>
                  <Link
                    href={mod.href}
                    className="text-white/40 hover:text-[#22c55e] text-sm transition-colors"
                  >
                    Uplift {mod.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Mission */}
          <div>
            <h3 className="font-semibold text-[#22c55e] mb-4 text-sm uppercase tracking-wider">
              Our Mission
            </h3>
            <p className="text-white/40 text-sm leading-relaxed mb-4">
              To become the definitive operating system for Black community
              empowerment — open-source, extensible, and community-governed.
            </p>
            <Link
              href="/about"
              className="inline-block text-sm font-medium text-white bg-[#dc2626] px-4 py-2 rounded-full hover:bg-[#ef4444] transition-colors shadow-lg shadow-red-900/20"
            >
              Learn More
            </Link>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-white/30 text-xs">
            © <FooterYear />{" "}The Uplift Lab. Community-owned &amp;
            community-governed.
          </p>
          <p className="text-white/30 text-xs">
            Open-source under AGPL license.
          </p>
        </div>
      </div>
    </footer>
  );
}
