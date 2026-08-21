import Link from "next/link";
import { proxiedImage } from "@/lib/imageProxy";
import type { TrendingItem } from "@/lib/trending";

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function TrendingFeed({
  items,
  error,
}: {
  items: TrendingItem[];
  error: boolean;
}) {
  if (error) {
    return (
      <p className="text-sm text-zinc-500">
        Trending feed unavailable right now — the scanner above still works.
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">No trending tokens found.</p>;
  }
  return (
    <div className="card card-hover divide-y divide-white/[0.06] overflow-hidden">
      {items.map((t, i) => (
        <Link
          key={`${t.chain}:${t.address}`}
          href={`/report/${t.chain}/${t.address}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
        >
          <span className="w-6 text-xs text-zinc-600 text-right font-display">{i + 1}</span>
          {proxiedImage(t.imageUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxiedImage(t.imageUrl)!} alt="" className="h-7 w-7 rounded-full" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-white/[0.06]" />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate">
              {t.name ?? "Unknown"}
            </span>{" "}
            <span className="text-xs text-zinc-500">{t.symbol ?? ""}</span>
          </div>
          <span className="hidden sm:inline-block rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-400">
            {t.chain}
          </span>
          <span className="text-xs text-zinc-400 w-16 text-right">
            {fmtUsd(t.liquidityUsd)}
          </span>
          <span className="text-xs text-brand-cyan/80 w-14 text-right">
            +{t.boostAmount}
          </span>
        </Link>
      ))}
    </div>
  );
}
