import { SearchBox } from "@/components/SearchBox";
import { TrendingFeed } from "@/components/TrendingFeed";
import { getTrending } from "@/lib/trending";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let trending: Awaited<ReturnType<typeof getTrending>> = [];
  let trendingError = false;
  try {
    trending = await getTrending();
  } catch {
    trendingError = true;
  }

  return (
    <div className="space-y-10">
      <section className="text-center space-y-4 pt-6">
        <h1 className="text-3xl font-bold tracking-tight">
          Is that memecoin a <span className="text-red-400">rug</span>?
        </h1>
        <p className="text-zinc-400 text-sm max-w-xl mx-auto">
          Paste a contract address or coin name. Get an instant plain-English
          risk report — honeypot checks, LP lock status, holder concentration —
          across Solana, Ethereum, BSC, Base, Arbitrum and Polygon.
        </p>
        <SearchBox />
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          Not financial advice — this tool flags red flags, it cannot predict
          price.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Trending now
        </h2>
        <TrendingFeed items={trending} error={trendingError} />
      </section>
    </div>
  );
}
