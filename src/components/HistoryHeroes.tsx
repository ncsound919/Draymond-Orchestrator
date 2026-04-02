"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * HistoryHeroes — Part of Uplift Learn Module
 *
 * An interactive, culturally rich component celebrating Black historical figures,
 * movements, and innovations across every era and domain.
 */

interface Hero {
  id: number;
  name: string;
  years: string;
  domain: string;
  domainColor: string;
  title: string;
  bio: string;
  impact: string;
  quote: string;
}

const heroes: Hero[] = [
  {
    id: 1,
    name: "Harriet Tubman",
    years: "1822–1913",
    domain: "Liberation & Justice",
    domainColor: "#3a2a6b",
    title: "Conductor of the Underground Railroad",
    bio: "Harriet Tubman escaped slavery and then returned to the South at least 13 times, personally leading approximately 70 enslaved people to freedom via the Underground Railroad. She later served as a spy, scout, and nurse for the Union Army during the Civil War.",
    impact:
      "Freed at least 70 enslaved people directly, never lost a passenger. Her courage laid the foundation for generations of civil rights activism.",
    quote: "I never ran my train off the track, and I never lost a passenger.",
  },
  {
    id: 2,
    name: "Frederick Douglass",
    years: "1818–1895",
    domain: "Education & Advocacy",
    domainColor: "#1a4a7a",
    title: "Abolitionist, Orator & Statesman",
    bio: "Frederick Douglass taught himself to read and write while enslaved, escaped bondage, and became one of the most influential voices in American history. His autobiographies exposed the brutal reality of slavery to the world.",
    impact:
      "His writing and oratory are credited with shifting public opinion on slavery and advancing the case for emancipation and Black suffrage.",
    quote: "Once you learn to read, you will be forever free.",
  },
  {
    id: 3,
    name: "Madam C.J. Walker",
    years: "1867–1919",
    domain: "Entrepreneurship",
    domainColor: "#c04a2a",
    title: "America's First Female Self-Made Millionaire",
    bio: "Born to formerly enslaved parents, Sarah Breedlove built a haircare empire from scratch. She became the first self-made female millionaire in America, employing thousands of Black women as sales agents at a time of profound economic exclusion.",
    impact:
      "Created economic opportunity for Black women nationally through her agent network, donated generously to the NAACP and community causes, and demonstrated that Black entrepreneurship could thrive.",
    quote: "I had to make my own living and my own opportunity.",
  },
  {
    id: 4,
    name: "Dr. Martin Luther King Jr.",
    years: "1929–1968",
    domain: "Civil Rights",
    domainColor: "#6b2137",
    title: "Leader of the Civil Rights Movement",
    bio: "Dr. King led the American civil rights movement through nonviolent civil disobedience. He organized the Montgomery Bus Boycott, the March on Washington, and countless campaigns that dismantled legal segregation in America.",
    impact:
      "The Civil Rights Act of 1964 and the Voting Rights Act of 1965 are the legislative legacy of his leadership. His vision of the Beloved Community continues to inspire movements worldwide.",
    quote: "Injustice anywhere is a threat to justice everywhere.",
  },
  {
    id: 5,
    name: "Katherine Johnson",
    years: "1918–2020",
    domain: "Science & Technology",
    domainColor: "#1a4a7a",
    title: "NASA Mathematician & Space Pioneer",
    bio: "Katherine Johnson's orbital mechanics calculations were critical to the success of NASA's first crewed spaceflights, including John Glenn's orbital mission. She overcame both racial segregation and gender discrimination to become one of the most important mathematicians of the 20th century.",
    impact:
      "Her calculations enabled the success of America's space program. She broke barriers for Black women in STEM and proved that excellence transcends any barrier.",
    quote:
      "I counted everything. I counted the steps to the road, the steps up to church, the number of dishes and silverware I washed… anything that could be counted, I did.",
  },
  {
    id: 6,
    name: "Ida B. Wells",
    years: "1862–1931",
    domain: "Justice & Journalism",
    domainColor: "#3a2a6b",
    title: "Investigative Journalist & Anti-Lynching Crusader",
    bio: "Ida B. Wells conducted investigative research into lynching in America at enormous personal risk, publishing findings that exposed the economic and racial motives behind the violence. She co-founded the NAACP and was a leading figure in both the civil rights and women's suffrage movements.",
    impact:
      "Her anti-lynching campaigns raised international awareness, pressured the U.S. government, and saved lives. She laid the groundwork for modern investigative journalism on racial injustice.",
    quote: "The way to right wrongs is to turn the light of truth upon them.",
  },
  {
    id: 7,
    name: "Thurgood Marshall",
    years: "1908–1993",
    domain: "Justice & Law",
    domainColor: "#3a2a6b",
    title: "First Black U.S. Supreme Court Justice",
    bio: "Thurgood Marshall argued and won Brown v. Board of Education, the landmark Supreme Court case that declared racial segregation in public schools unconstitutional. He later became the first Black Justice on the U.S. Supreme Court, serving from 1967 to 1991.",
    impact:
      "Brown v. Board of Education dismantled the legal basis for segregation in America. As a Justice, he was a consistent champion for civil liberties and equal justice.",
    quote:
      "In recognizing the humanity of our fellow beings, we pay ourselves the highest tribute.",
  },
  {
    id: 8,
    name: "Maya Angelou",
    years: "1928–2014",
    domain: "Arts & Literature",
    domainColor: "#5a2a6b",
    title: "Poet, Memoirist & Civil Rights Activist",
    bio: 'Maya Angelou\'s 1969 memoir "I Know Why the Caged Bird Sings" broke barriers as one of the first nonfiction bestsellers by a Black woman. A poet, actress, and activist, she was a friend and collaborator of Dr. Martin Luther King Jr. and Malcolm X.',
    impact:
      "Her writing has been translated into dozens of languages and has given voice to the Black experience for generations worldwide. She read \"On the Pulse of Morning\" at President Clinton's 1993 inauguration.",
    quote:
      "You may not control all the events that happen to you, but you can decide not to be reduced by them.",
  },
];

const domains = [
  "All",
  "Liberation & Justice",
  "Education & Advocacy",
  "Entrepreneurship",
  "Civil Rights",
  "Science & Technology",
  "Justice & Journalism",
  "Justice & Law",
  "Arts & Literature",
];

export default function HistoryHeroes() {
  const [selectedDomain, setSelectedDomain] = useState("All");
  const [selectedHero, setSelectedHero] = useState<Hero | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closeModal = useCallback(() => {
    setSelectedHero(null);
  }, []);

  const openModal = useCallback(
    (hero: Hero, trigger: HTMLButtonElement) => {
      triggerRef.current = trigger;
      setSelectedHero(hero);
    },
    []
  );

  // Focus the close button when the modal opens
  useEffect(() => {
    if (selectedHero && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [selectedHero]);

  // Restore focus to the triggering card when the modal closes
  useEffect(() => {
    if (!selectedHero && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [selectedHero]);

  // Close on Escape key
  useEffect(() => {
    if (!selectedHero) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedHero, closeModal]);

  // Trap focus inside the modal
  useEffect(() => {
    if (!selectedHero) return;

    const modalEl = document.getElementById("history-hero-modal");
    if (!modalEl) return;

    const focusable = modalEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [selectedHero]);

  const filtered =
    selectedDomain === "All"
      ? heroes
      : heroes.filter((h) => h.domain === selectedDomain);

  return (
    <section className="py-16 px-4 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-block mb-2 px-3 py-0.5 rounded-full bg-blue-900/30 text-blue-400 text-xs font-semibold">
            Uplift Learn
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            History Heroes
          </h2>
          <p className="text-white/40 max-w-xl text-base">
            Celebrating the brilliance, courage, and vision of Black historical
            figures who changed the world.
          </p>
        </div>

        {/* Filter */}
        <div
          className="flex flex-wrap gap-2 mb-8"
          role="group"
          aria-label="Filter by domain"
        >
          {domains.map((domain) => (
            <button
              key={domain}
              onClick={() => setSelectedDomain(domain)}
              aria-pressed={selectedDomain === domain}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedDomain === domain
                  ? "bg-[#22c55e] text-[#0a0a0a]"
                  : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
              }`}
            >
              {domain}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((hero) => (
            <button
              key={hero.id}
              onClick={(e) =>
                openModal(hero, e.currentTarget as HTMLButtonElement)
              }
              aria-label={`View details about ${hero.name}`}
              className="text-left glass-card p-5 group"
            >
              <div
                className="w-12 h-12 rounded-full mb-3 flex items-center justify-center text-white font-bold text-lg"
                style={{ backgroundColor: hero.domainColor }}
              >
                {hero.name.charAt(0)}
              </div>
              <h3 className="font-bold text-white text-base mb-0.5 group-hover:text-[#22c55e] transition-colors">
                {hero.name}
              </h3>
              <p className="text-xs text-white/40 mb-1">{hero.years}</p>
              <span
                className="inline-block text-xs font-medium px-2 py-0.5 rounded-full text-white mb-2"
                style={{ backgroundColor: hero.domainColor }}
              >
                {hero.domain}
              </span>
              <p className="text-sm text-white/50 leading-snug line-clamp-2">
                {hero.title}
              </p>
            </button>
          ))}
        </div>

        {/* Modal */}
        {selectedHero && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={closeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-modal-title"
            id="history-hero-modal"
          >
            <div
              className="glass-card max-w-lg w-full p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                ref={closeButtonRef}
                onClick={closeModal}
                className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors text-xl leading-none"
                aria-label="Close dialog"
              >
                ✕
              </button>

              <div
                className="w-16 h-16 rounded-full mb-4 flex items-center justify-center text-white font-bold text-2xl"
                style={{ backgroundColor: selectedHero.domainColor }}
              >
                {selectedHero.name.charAt(0)}
              </div>

              <div className="mb-1">
                <span
                  className="inline-block text-xs font-medium px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: selectedHero.domainColor }}
                >
                  {selectedHero.domain}
                </span>
              </div>

              <h2
                id="hero-modal-title"
                className="text-2xl font-bold text-white mt-2 mb-0.5"
              >
                {selectedHero.name}
              </h2>
              <p className="text-sm text-white/40 mb-1">
                {selectedHero.years}
              </p>
              <p
                className="text-sm font-medium mb-4"
                style={{ color: selectedHero.domainColor }}
              >
                {selectedHero.title}
              </p>

              <blockquote
                className="pl-4 mb-4 italic text-white/70 text-sm leading-relaxed"
                style={{ borderLeft: `4px solid ${selectedHero.domainColor}` }}
              >
                &ldquo;{selectedHero.quote}&rdquo;
              </blockquote>

              <p className="text-sm text-white/60 leading-relaxed mb-4">
                {selectedHero.bio}
              </p>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#22c55e] mb-2">
                  Legacy &amp; Impact
                </h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {selectedHero.impact}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
