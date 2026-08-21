import Link from "next/link";
import type { AlertEntry, DeathwatchStats, ReceiptEntry } from "@/lib/watchlist";

// Deathwatch presentation. The page is the public credibility layer:
// permanent, timestamped receipts that the radar flagged tokens before they
// rugged — so absolute timestamps are shown prominently next to relative
// ones, and the Called It ledger leads the live alerts.

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

// Absolute UTC timestamp — the receipt's proof. "21 Aug 2026, 14:03 UTC".
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

function bandClasses(band: ReceiptEntry["flaggedBand"]): string {
  switch (band) {
    case "AVOID":
      return "bg-red-950 text-red-400";
    case "CAUTION":
      return "bg-amber-950 text-amber-400";
    case "LOWER_RISK":
      return "bg-emerald-950 text-emerald-400";
    default:
      return "bg-zinc-800 text-zinc-400";
  }
}

const SEVERITY: Record<
  AlertEntry["severity"],
  { icon: string; label: string; chip: string }
> = {
  rug: { icon: "💀", label: "RUG", chip: "bg-red-950 text-red-400" },
  critical: {
    icon: "🚨",
    label: "CRITICAL",
    chip: "bg-red-950 text-red-400",
  },
  warning: {
    icon: "⚠️",
    label: "WARNING",
    chip: "bg-amber-950 text-amber-400",
  },
};

const MIN_SAMPLE = 5; // hide the hit rate below this many receipts

function AccuracyStrip({ stats }: { stats: DeathwatchStats }) {
  const enough = stats.receipts >= MIN_SAMPLE;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Track record
      </h2>
      <div className="grid grid-cols-3 gap-2">
        <div className="card px-3 py-2">
          <div className="text-xs text-zinc-500">Watching now</div>
          <div className="text-sm font-medium">{stats.watched}</div>
        </div>
        <div className="card px-3 py-2">
          <div className="text-xs text-zinc-500">Confirmed rugs</div>
          <div className="text-sm font-medium">{stats.receipts}</div>
        </div>
        <div className="card px-3 py-2">
          <div className="text-xs text-zinc-500">Flagged first</div>
          {enough ? (
            <div className="text-sm font-medium text-emerald-400">
              {stats.flaggedReceipts} of {stats.receipts}{" "}
              <span className="font-normal text-zinc-500">
                ({Math.round((stats.flaggedHitRate ?? 0) * 100)}%)
              </span>
            </div>
          ) : (
            <div className="text-sm font-medium text-zinc-400">
              gathering data
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        {enough
          ? `${stats.flaggedReceipts} of ${stats.receipts} tracked rugs had been flagged AVOID/CAUTION before liquidity disappeared. n=${stats.receipts} — small samples are noisy; the receipts below are the verifiable part.`
          : `Not enough receipts to quote a hit rate yet (n=${stats.receipts}, shown from ${MIN_SAMPLE}). The number stays hidden until the sample means something.`}
      </p>
    </section>
  );
}

function CalledItLedger({ receipts }: { receipts: ReceiptEntry[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-red-400">
        Called It — the receipts
      </h2>
      <p className="text-xs text-zinc-500 max-w-xl">
        Each receipt is written when a watched token&rsquo;s liquidity
        disappears — and only exists when the radar had flagged the token
        first. Flag time comes from the watch metadata, rug time from the
        monitor. Both are public and permanent. These are timestamped
        observations of what the data showed, not predictions.
      </p>
      {receipts.length === 0 ? (
        <p className="card px-4 py-3 text-sm text-zinc-500">
          No receipts yet. One is recorded the first time a token flagged
          AVOID/CAUTION (or a confirmed honeypot) loses its liquidity while
          watched.
        </p>
      ) : (
        <div className="card card-hover divide-y divide-white/[0.06] overflow-hidden">
          {receipts.map((r, i) => {
            const flaggedMs = new Date(r.flaggedAt).getTime();
            const ruggedMs = new Date(r.ruggedAt).getTime();
            const ttr =
              Number.isNaN(flaggedMs) || Number.isNaN(ruggedMs)
                ? null
                : fmtDuration(ruggedMs - flaggedMs);
            return (
              <Link
                key={`${r.chain}:${r.address}:${r.ruggedAt}:${i}`}
                href={`/report/${r.chain}/${r.address}`}
                className="block px-4 py-3 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {r.symbol ?? "Unknown token"}
                    </span>{" "}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {r.chain}
                    </span>
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${bandClasses(r.flaggedBand)}`}
                  >
                    {r.flaggedBand
                      ? `FLAGGED ${r.flaggedBand.replace("_", " ")}`
                      : "FLAGGED HONEYPOT"}
                  </span>
                  {ttr && (
                    <span className="hidden sm:inline-block text-xs font-medium text-red-400">
                      rugged {ttr} later
                    </span>
                  )}
                </div>
                <div className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-zinc-500">Flagged: </span>
                    <span className="font-medium text-amber-400">
                      {stamp(r.flaggedAt)}
                    </span>{" "}
                    <span className="text-zinc-600">
                      ({timeAgo(r.flaggedAt)})
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Rugged: </span>
                    <span className="font-medium text-red-400">
                      {stamp(r.ruggedAt)}
                    </span>{" "}
                    <span className="text-zinc-600">
                      ({timeAgo(r.ruggedAt)})
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-zinc-500 truncate">{r.rule}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LiveAlerts({ alerts }: { alerts: AlertEntry[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Live alerts <span className="normal-case font-normal">(last 7 days)</span>
      </h2>
      {alerts.length === 0 ? (
        <p className="card px-4 py-3 text-sm text-zinc-500">
          No alerts yet — watched tokens are checked every couple of minutes
          and anything that moves lands here and on Telegram. Quiet is good.
        </p>
      ) : (
        <div className="card card-hover divide-y divide-white/[0.06] overflow-hidden">
          {alerts.map((a, i) => {
            const sev = SEVERITY[a.severity] ?? SEVERITY.warning;
            return (
              <Link
                key={`${a.chain}:${a.address}:${a.ts}:${i}`}
                href={`/report/${a.chain}/${a.address}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
              >
                <span aria-hidden>{sev.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {a.symbol ?? "Unknown token"}
                  </span>{" "}
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {a.chain}
                  </span>
                  <p className="text-xs text-zinc-400 truncate">{a.text}</p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sev.chip}`}
                >
                  {sev.label}
                </span>
                <span className="w-36 text-right text-xs">
                  <span className="text-zinc-400">{stamp(a.ts)}</span>{" "}
                  <span className="text-zinc-600">({timeAgo(a.ts)})</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function DeathwatchView({
  alerts,
  calledIt,
  stats,
}: {
  alerts: AlertEntry[];
  calledIt: ReceiptEntry[];
  stats: DeathwatchStats;
}) {
  return (
    <>
      <AccuracyStrip stats={stats} />
      <CalledItLedger receipts={calledIt} />
      <LiveAlerts alerts={alerts} />
    </>
  );
}
