import type { Metadata } from "next";
import Link from "next/link";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RugRadar — memecoin risk scanner",
  description:
    "Paste a contract address or coin name and get an instant plain-English risk report: honeypot checks, LP lock status, holder concentration.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="min-h-screen flex flex-col font-sans">
        <header className="relative border-b border-white/5">
          {/* cyan gradient hairline under the header border */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-brand-cyan/40 to-transparent"
          />
          <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-bold tracking-tight font-display"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" className="h-6 w-6" />
              Rug<span className="text-brand-gradient">Radar</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/feed"
                className="text-xs text-zinc-400 hover:text-brand-cyan transition-colors"
              >
                Live feed
              </Link>
              <Link
                href="/alerts"
                className="text-xs text-zinc-400 hover:text-brand-cyan transition-colors"
              >
                Deathwatch
              </Link>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-zinc-500">
                <span className="live-dot" />
                Live
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-8">
          {children}
        </main>
        <footer className="relative border-t border-white/5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-brand-cyan/20 to-transparent"
          />
          <div className="mx-auto max-w-3xl px-4 py-4 text-xs text-zinc-500">
            Not financial advice. RugRadar flags red flags from public
            on-chain data — it cannot predict price. Always do your own
            research.
          </div>
        </footer>
      </body>
    </html>
  );
}
