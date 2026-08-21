import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemeScanner — memecoin risk scanner",
  description:
    "Paste a contract address or coin name and get an instant plain-English risk report: honeypot checks, LP lock status, holder concentration.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-zinc-800">
          <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Meme<span className="text-emerald-400">Scanner</span>
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
            Not financial advice. MemeScanner flags red flags from public
            on-chain data — it cannot predict price. Always do your own
            research.
          </div>
        </footer>
      </body>
    </html>
  );
}
