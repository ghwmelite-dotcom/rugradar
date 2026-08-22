import { SearchBox } from "@/components/SearchBox";
import { TrendingFeed } from "@/components/TrendingFeed";
import { getTrending } from "@/lib/trending";
import { EMPTY_FEED, getFeed, type Feed } from "@/lib/scanlog";
import {
  getAlerts,
  getStats,
  type AlertEntry,
  type DeathwatchStats,
} from "@/lib/watchlist";
import Link from "next/link";

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
  let alerts: AlertEntry[] = [];
  try {
    [feed, stats, alerts] = await Promise.all([
      getFeed(),
      getStats(),
      getAlerts(),
    ]);
  } catch {
    // Scan log / watch state unavailable — show the zero state.
  }
  const latestAlert = alerts[0] ?? null;

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

      {/* Deathwatch — the key seller. Prominent by design. */}
      <section>
        <div className="card relative overflow-hidden border-red-400/20 bg-red-400/[0.03] p-6 sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/50 to-transparent"
          />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex-1 space-y-3">
              <p className="eyebrow border-red-400/25 bg-red-400/[0.07] text-red-300">
                <span className="eyebrow-dot bg-red-400" />
                Deathwatch — 24/7 rug alarms
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
                It texts you{" "}
                <span
                  className="text-danger"
                  style={{ textShadow: "0 0 24px rgb(255 92 92 / 0.4)" }}
                >
                  before the rug.
                </span>
              </h2>
              <p className="text-sm text-zinc-400 max-w-md">
                Watched tokens are monitored around the clock. The moment
                liquidity starts draining, the alert hits our Telegram — and
                when a flagged token dies, the timestamped receipt is public
                forever. Observations, not prophecies.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/alerts"
                  className="btn-brand rounded-xl px-4 py-2 text-sm"
                >
                  Open Deathwatch
                </Link>
                <a
                  href="https://t.me/+B2z7qkzpjAUwYmQ0"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:border-brand-cyan/40 hover:text-brand-cyan"
                >
                  Get alerts on Telegram
                </a>
              </div>
            </div>
            {/* live status panel */}
            <div className="card w-full shrink-0 space-y-3 border-white/[0.06] bg-black/30 p-4 sm:w-64">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Radar status
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-400">
                  <span className="live-dot" />
                  Live
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="font-display text-3xl font-bold text-brand-cyan"
                  style={{ textShadow: "0 0 20px rgb(0 229 255 / 0.35)" }}
                >
                  {stats.watched}
                </span>
                <span className="text-xs text-zinc-500">
                  tokens under watch
                </span>
              </div>
              {latestAlert ? (
                <Link
                  href={`/report/${latestAlert.chain}/${latestAlert.address}`}
                  className="block rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-2 transition-colors hover:border-red-400/50"
                >
                  <div className="text-[10px] uppercase tracking-widest text-red-400">
                    Latest alert · {latestAlert.severity}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-300">
                    {latestAlert.symbol ?? "Unknown"} — {latestAlert.text}
                  </div>
                </Link>
              ) : (
                <p className="rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-zinc-500">
                  No alerts yet — the radar is watching. Watch any token from
                  its report page.
                </p>
              )}
            </div>
          </div>
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
