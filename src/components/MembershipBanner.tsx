import Link from 'next/link';

export default function MembershipBanner() {
  return (
    <section
      aria-label="Free membership call to action"
      className="relative overflow-hidden border-y border-white/5"
    >
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#dc2626]/10 via-[#0a0a0a] to-[#22c55e]/10" />

      {/* Decorative background pattern */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #22c55e 0, #22c55e 1px, transparent 0, transparent 50%)',
          backgroundSize: '12px 12px',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-6 text-center lg:flex-row lg:text-left">
          {/* Badge */}
          <div className="flex-shrink-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#22c55e] px-5 py-2 text-sm font-bold text-[#0a0a0a] shadow-lg shadow-green-900/30">
              <span aria-hidden="true">★</span> Always Free. No Credit Card. No Catch.
            </span>
          </div>

          {/* Text */}
          <div className="flex-1">
            <h2 className="text-2xl font-bold leading-tight text-white sm:text-3xl">
              Membership is{' '}
              <span className="text-[#22c55e]">free — forever.</span>
            </h2>
            <p className="mt-2 text-base text-white/40 sm:text-lg">
              Access financial literacy courses, life skills training, community resources, and
              every Uplift Lab tool — at zero cost. This platform is built for you, owned by you.
            </p>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <Link
              href="/auth/signup"
              className="inline-block rounded-full bg-[#dc2626] px-8 py-3 text-center text-base font-bold text-white shadow-lg shadow-red-900/30 transition hover:bg-[#ef4444] focus:outline-none focus:ring-4 focus:ring-red-500/40"
            >
              Join Free Today
            </Link>
            <Link
              href="/modules"
              className="inline-block rounded-full border border-white/10 bg-white/5 px-8 py-3 text-center text-base font-semibold text-white backdrop-blur-sm transition hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              Explore Modules
            </Link>
          </div>
        </div>

        {/* Trust row */}
        <ul className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-white/30 lg:justify-start">
          {[
            { icon: '🎓', text: 'Financial Literacy Courses' },
            { icon: '🛠', text: 'Life Skills Training' },
            { icon: '🤝', text: 'Community Support' },
            { icon: '⚖️', text: 'Legal Know-Your-Rights' },
            { icon: '💼', text: 'Entrepreneurship Tools' },
            { icon: '🏥', text: 'Health Resources' },
          ].map(({ icon, text }) => (
            <li key={text} className="flex items-center gap-1.5">
              <span aria-hidden="true">{icon}</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
