import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import UpliftGuideLoader from "@/components/UpliftGuideLoader";
import { Toaster } from "sonner";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://theupliftlab.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "The Uplift Lab — Community Operating System for Black Empowerment",
    template: "%s | The Uplift Lab",
  },
  description:
    "The Uplift Lab is a modular digital platform engineered to directly address systemic barriers facing the Black community across six critical domains: education, health, finance, entrepreneurship, justice, and community support.",
  keywords: [
    "Black empowerment",
    "community platform",
    "education",
    "health equity",
    "financial empowerment",
    "entrepreneurship",
    "justice",
    "mutual aid",
  ],
  openGraph: {
    title: "The Uplift Lab — Community Operating System for Black Empowerment",
    description:
      "A modular digital platform dismantling systemic barriers across education, health, wealth, ventures, justice, and community.",
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "The Uplift Lab",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Uplift Lab",
    description: "Community OS for Black empowerment.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${BASE_URL}/#organization`,
      name: "The Uplift Lab",
      url: BASE_URL,
      description:
        "A community-owned digital platform dismantling systemic barriers across education, health, wealth, entrepreneurship, justice, and community support for the Black community.",
      foundingDate: "2024",
      areaServed: "US",
      knowsAbout: [
        "Black empowerment",
        "community organizing",
        "health equity",
        "financial literacy",
        "entrepreneurship",
        "criminal justice reform",
        "mutual aid",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${BASE_URL}/#website`,
      url: BASE_URL,
      name: "The Uplift Lab",
      publisher: { "@id": `${BASE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${BASE_URL}/network?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "SoftwareApplication",
      name: "The Uplift Lab",
      applicationCategory: "SocialNetworkingApplication",
      operatingSystem: "Web",
      url: BASE_URL,
      description:
        "Community operating system for Black empowerment across six domains: Learn, Health, Wealth, Ventures, Justice, Community.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-[#e5e7eb]">
        {/* Skip to main content — WCAG 2.2 bypass block */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-[#22c55e] focus:text-[#0a0a0a] focus:font-semibold focus:rounded-lg focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Header />
        <NuqsAdapter>
          <main id="main-content" className="flex-1">
            {children}
          </main>
        </NuqsAdapter>
        <Footer />
        <UpliftGuideLoader />
        <KeyboardShortcuts />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e5e7eb',
            },
          }}
        />
      </body>
    </html>
  );
}
