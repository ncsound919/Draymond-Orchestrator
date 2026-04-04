import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import { Toaster } from "sonner";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";

export const metadata: Metadata = {
  title: {
    default: "Draymond Orchestrator",
    template: "%s | Draymond",
  },
  description:
    "24/7 autonomous business system — agent fleet, chains, monitors, and pipeline orchestration.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
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
        <footer className="border-t border-white/5 px-6 py-4">
          <p className="text-center text-xs text-white/20">
            Draymond Orchestrator &mdash; Autonomous Business System
          </p>
        </footer>
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
