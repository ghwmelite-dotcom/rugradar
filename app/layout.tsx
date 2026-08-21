import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-zinc-800">
          <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" className="h-6 w-6" />
              Rug<span className="text-emerald-400">Radar</span>
            </Link>
            <span className="text-xs text-zinc-500">
              solana · ethereum · bsc · base · arbitrum · polygon
            </span>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-zinc-800">
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
