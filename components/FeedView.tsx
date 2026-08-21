import Link from "next/link";
import { proxiedImage } from "@/lib/imageProxy";
import type { Feed, ScanLogEntry } from "@/lib/scanlog";

function bandClasses(band: ScanLogEntry["band"]): string {
  switch (band) {
    case "AVOID":
      return "text-red-400";
    case "CAUTION":
      return "text-amber-400";
    case "LOWER_RISK":
      return "text-emerald-400";
    default:
      return "text-zinc-500";
  }
}

function bandLabel(band: ScanLogEntry["band"]): string {
  return band ? band.replace("_", " ") : "UNSCORED";
}

function timeAgo(iso: string): string {
  const mins = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function TokenRow({
  entry,
  right,
}: {
  entry: ScanLogEntry;
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={`/report/${entry.chain}/${entry.address}`}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
    >
      {proxiedImage(entry.imageUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxiedImage(entry.imageUrl)!}
          alt=""
          className="h-7 w-7 rounded-full"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-white/[0.06]" />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">
          {entry.name ?? "Unknown"}
        </span>{" "}
        <span className="text-xs text-zinc-500">{entry.symbol ?? ""}</span>
        {entry.honeypot && (
          <span className="ml-2 rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
            HONEYPOT
          </span>
        )}
      </div>
      <span className="hidden sm:inline-block rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-400">
        {entry.chain}
      </span>
      <span
        className={`text-xs font-semibold w-28 text-right ${bandClasses(entry.band)}`}
      >
        {entry.score !== null ? `${entry.score}/100 ` : ""}
        {bandLabel(entry.band)}
      </span>
      {right}
    </Link>
  );
}

function Section({
  title,
  titleClass = "text-zinc-400",
  entries,
  empty,
  renderRight,
}: {
  title: string;
  titleClass?: string;
  entries: ScanLogEntry[];
  empty: string;
  renderRight?: (entry: ScanLogEntry & { count?: number }) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2
        className={`text-sm font-semibold uppercase tracking-wider ${titleClass}`}
      >
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <div className="card card-hover divide-y divide-white/[0.06] overflow-hidden">
          {entries.map((e, i) => (
            <TokenRow
              key={`${e.chain}:${e.address}:${e.scannedAt}:${i}`}
              entry={e}
              right={renderRight?.(e)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function FeedView({ feed }: { feed: Feed }) {
  return (
    <>
      <Section
        title="Honeypots caught"
        titleClass="text-red-400"
        entries={feed.honeypots}
        empty="No honeypots caught yet — the radar is watching."
      />
      <Section
        title="Most scanned (last 24h)"
        entries={feed.mostScanned}
        empty="No scans yet — be the first."
        renderRight={(e) => (
          <span className="text-xs text-zinc-400 w-16 text-right">
            {e.count !== undefined
              ? `${e.count} scan${e.count === 1 ? "" : "s"}`
              : ""}
          </span>
        )}
      />
      <Section
        title="Latest scans"
        entries={feed.recent}
        empty="No scans yet — be the first."
        renderRight={(e) => (
          <span className="text-xs text-zinc-500 w-16 text-right">
            {timeAgo(e.scannedAt)}
          </span>
        )}
      />
    </>
  );
}
