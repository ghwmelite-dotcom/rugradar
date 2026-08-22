import type { Metadata } from "next";
import Link from "next/link";
import { ViralBoardView } from "@/components/ViralBoardView";
import { getViralPicks, type ViralRadarData } from "@/lib/viral";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Viral Radar — RugRadar",
  description:
    "The memecoins going viral right now, pre-scanned for rugs: heat score, red flags, and a 0-100 verdict on every token heating up. Refreshed every 15 minutes.",
};

export default async function ViralPage() {
  let data: ViralRadarData = {
    generatedAt: new Date().toISOString(),
    today: "",
    picks: [],
    digest: null,
  };
  try {
    data = await getViralPicks();
  } catch {
    // Provider outage — render the quiet-horizon empty state.
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          Trending now — every token pre-scanned
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
          Viral <span className="text-brand-gradient">Radar</span>
        </h1>
        <p className="max-w-xl text-sm text-zinc-400">
          The memecoins going viral this minute — ranked by heat (promotion,
          volume, momentum, buy pressure, freshness) and already scanned for
          rugs. Viral isn&apos;t the same as safe. Check the verdict before
          the crowd finds out the hard way.
        </p>
      </section>

      <ViralBoardView data={data} />

      <section className="rounded-xl border border-white/8 bg-zinc-900/50 p-5 text-center">
        <p className="text-sm text-zinc-300">
          Holding something that&apos;s pumping?{" "}
          <Link
            href="/"
            className="font-semibold text-brand-cyan hover:underline"
          >
            Scan its contract
          </Link>{" "}
          — 10 seconds, free, no sign-up.
        </p>
      </section>
    </div>
  );
}
