import type { Metadata } from "next";
import { DeathwatchView } from "@/components/DeathwatchView";
import {
  getAlerts,
  getReceipts,
  getStats,
  type AlertEntry,
  type DeathwatchStats,
  type ReceiptEntry,
} from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deathwatch — RugRadar",
  description:
    "The public receipts ledger: tokens RugRadar flagged, the exact time it flagged them, and the exact time they rugged. Timestamped, permanent, verifiable.",
};

const EMPTY_STATS: DeathwatchStats = {
  watched: 0,
  receipts: 0,
  flaggedReceipts: 0,
  flaggedHitRate: null,
};

export default async function AlertsPage() {
  let alerts: AlertEntry[] = [];
  let calledIt: ReceiptEntry[] = [];
  let stats: DeathwatchStats = EMPTY_STATS;
  try {
    [alerts, calledIt, stats] = await Promise.all([
      getAlerts(),
      getReceipts(),
      getStats(),
    ]);
  } catch {
    // Watch state unavailable — render the empty states.
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-2">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          Around-the-clock watch — public receipts ledger
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
          Death<span className="text-danger">watch</span>
        </h1>
        <p className="text-zinc-400 text-sm max-w-xl">
          The public record. Watched tokens are monitored around the clock;
          when liquidity drains, the alert fires on Telegram first — and when
          a token the radar flagged later rugs, the receipt lands here,
          timestamped and permanent. Observations, not prophecies.
        </p>
      </section>
      <DeathwatchView alerts={alerts} calledIt={calledIt} stats={stats} />
    </div>
  );
}
