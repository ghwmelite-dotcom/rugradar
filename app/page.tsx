import { SearchBox } from "@/components/SearchBox";
import { TrendingFeed } from "@/components/TrendingFeed";
import { getTrending } from "@/lib/trending";
import { EMPTY_FEED, getFeed, type Feed } from "@/lib/scanlog";
import { getStats, type DeathwatchStats } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

const EMPTY_STATS: DeathwatchStats = {
  watched: 0,
  receipts: 0,
  flaggedReceipts: 0,
  flaggedHitRate: null,
};

export default async function HomePage() {
  let trending: Awaited<ReturnType<typeof getTrending>> = [];
  let trendingError = false;
  try {
    trending = await getTrending();
  } catch {
    trendingError = true;
  }

  // Live numbers for the stat strip — best-effort, degrade to zeros.
  let feed: Feed = EMPTY_FEED;
  let stats: DeathwatchStats = EMPTY_STATS;
  try {
    [feed, stats] = await Promise.all([getFeed(), getStats()]);
  } catch {
    // Scan log / watch state unavailable — show the zero state.
  }

  const statItems: [string, string][] = [
    [stats.watched.toLocaleString(), "tokens watched"],
    [feed.recent.length.toLocaleString(), "scans · 24h"],
    [feed.honeypots.length.toLocaleString(), "honeypots caught · 24h"],
    ["6", "chains covered"],
  ];

  return (
    <div className="space-y-12">
      <section className="text-center space-y-6 pt-8">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          Free memecoin risk scanner — SOL · ETH · BSC · BASE · ARB · POLY
        </p>
        <h1 className="font-display text-5xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
          Is that memecoin
          <br />a{" "}
          <span
            className="text-danger"
            style={{ textShadow: "0 0 32px rgb(255 92 92 / 0.45)" }}
          >
            rug
          </span>
          ?
        </h1>
        <p className="text-zinc-400 text-sm sm:text-base max-w-xl mx-auto">
          Paste a contract address or coin name. Get an instant plain-English
          risk report — honeypot checks, LP lock status, holder concentration —
          across Solana, Ethereum, BSC, Base, Arbitrum and Polygon.
        </p>
        <SearchBox />
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          Not financial advice — this tool flags red flags, it cannot predict
          price.
        </p>

        {/* stat strip — live numbers from the scan log and watchlist */}
        <div className="card mx-auto grid max-w-xl grid-cols-2 divide-white/[0.06] max-sm:gap-y-4 sm:grid-cols-4 sm:divide-x px-2 py-4">
          {statItems.map(([value, label]) => (
            <div key={label} className="px-3">
              <div
                className="font-display text-xl font-bold text-brand-cyan"
                style={{ textShadow: "0 0 20px rgb(0 229 255 / 0.35)" }}
              >
                {value}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-500">
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">
            Trending now
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-zinc-500">
            <span className="live-dot" />
            Live
          </span>
        </div>
        <TrendingFeed items={trending} error={trendingError} />
      </section>
    </div>
  );
}
