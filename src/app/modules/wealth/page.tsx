import ModulePage from "@/components/ModulePage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uplift Wealth | The Uplift Lab",
  description:
    "Free financial literacy curriculum, budgeting tools, credit education, and CDFI connector built for Black community empowerment.",
};

export default function WealthPage() {
  return (
    <ModulePage
      name="Uplift Wealth"
      tagline="Build wealth. Break cycles."
      description="The mean wealth gap between Black and white households grew to $1.15 million by 2022. Uplift Wealth provides the tools to bridge that gap through education, ownership, and community-based finance."
      color="#b87514"
      bg="#fdf4e0"
      icon="💰"
      targetUsers={[
        "Financial Literacy Beginners",
        "First-Time Homebuyers",
        "Credit Rebuilders",
        "Savers & Investors",
        "Families Navigating Debt",
        "Entrepreneurs Seeking Capital",
      ]}
      features={[
        {
          title: "Financial Literacy Curriculum",
          description:
            "Gamified, self-paced courses covering budgeting, saving, investing, and credit — all at zero cost.",
        },
        {
          title: "Budgeting & Savings Tracker",
          description:
            "Visual tools to track your spending and hit your savings milestones without hidden fees.",
        },
        {
          title: "Credit Score Education",
          description:
            "Learn how to build and repair your credit with clear, step-by-step guides and predatory lending alerts.",
        },
        {
          title: "CDFI & Community Bank Connector",
          description:
            "Connect with Black-owned banks and Community Development Financial Institutions for fair lending.",
        },
      ]}
    >
      <div className="mt-12 space-y-16">
        {/* Course Preview */}
        <section aria-labelledby="wealth-courses-title" className="glass-card p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="wealth-courses-title" className="text-2xl font-bold text-[#f59e0b]">Financial Literacy Courses</h2>
              <p className="mt-2 text-white/40">Master your money with our community-vetted curriculum.</p>
            </div>
            <a href="https://www.mymoney.gov/" target="_blank" rel="noopener noreferrer"
              className="rounded-full bg-[#b87514] px-6 py-2 font-bold text-white shadow-md transition hover:bg-yellow-700">
              Start Learning Free
            </a>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Budgeting for Freedom", time: "45 min", lessons: 5 },
              { title: "The Credit Playbook", time: "60 min", lessons: 6 },
              { title: "Generational Wealth 101", time: "90 min", lessons: 8 },
            ].map((course) => (
              <div key={course.title} className="rounded-xl bg-white/5 border border-white/10 p-4 transition hover:bg-white/10">
                <h3 className="font-bold text-white">{course.title}</h3>
                <div className="mt-2 flex items-center gap-3 text-sm text-white/40">
                  <span>⏱ {course.time}</span>
                  <span>📚 {course.lessons} Lessons</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Homeownership Assessment CTA */}
        <section className="glass-card p-8 border-[#dc2626]/20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold text-white">Ready for Homeownership?</h2>
            <p className="mt-4 text-white/40">
              Take our free readiness assessment to see where you stand and get a personalized path
              to your first home, including down payment assistance matches.
            </p>
            <a href="https://www.consumerfinance.gov/owning-a-home/check-rates/" target="_blank" rel="noopener noreferrer"
              className="mt-8 inline-block rounded-full bg-white px-8 py-3 font-bold text-[#6b2137] transition hover:bg-rose-50">
              Check My Readiness
            </a>
          </div>
        </section>
      </div>
    </ModulePage>
  );
}
