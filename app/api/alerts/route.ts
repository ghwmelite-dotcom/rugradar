// GET /api/alerts — public Deathwatch state (docs/DEATHWATCH.md): recent
// liquidity-drain alerts, the permanent Called It receipts ledger, and
// accuracy stats with honest sample sizes.

import { NextResponse } from "next/server";
import { getAlerts, getReceipts, getStats } from "@/lib/watchlist";
import { scheduleMonitorKick } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  // Traffic keeps the radar warm: viewing alerts kicks the throttled monitor.
  scheduleMonitorKick();
  const [alerts, calledIt, stats] = await Promise.all([
    getAlerts(),
    getReceipts(),
    getStats(),
  ]);
  return NextResponse.json({ alerts, calledIt, stats });
}
