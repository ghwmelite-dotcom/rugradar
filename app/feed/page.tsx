import type { Metadata } from "next";
import { FeedView } from "@/components/FeedView";
import { EMPTY_FEED, getFeed, type Feed } from "@/lib/scanlog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wall of Shame — RugRadar",
  description:
    "What the radar is catching right now: latest memecoin scans, honeypots caught, and the most scanned tokens of the last 24 hours.",
};

export default async function FeedPage() {
  let feed: Feed = EMPTY_FEED;
  try {
    feed = await getFeed();
  } catch {
    // Scan log unavailable — render the empty state.
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Wall of <span className="text-red-400">Shame</span>
        </h1>
        <p className="text-zinc-400 text-sm max-w-xl">
          What the radar is catching right now — tokens scanned on RugRadar
          over the last 24 hours. This flags red flags; nothing here is a
          recommendation.
        </p>
      </section>
      <FeedView feed={feed} />
    </div>
  );
}
