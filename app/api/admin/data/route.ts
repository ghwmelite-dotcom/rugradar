// GET /api/admin/data
// Auth-gated aggregate powering the /admin content vault: scan-log feed
// counts, the riskiest token in the window, and — for that token — a fresh
// scored scan so the card/captions can quote real red flags. The rescan
// hits the normal provider cache (15min security TTL), so repeated loads
// are cheap. Everything degrades gracefully: an empty or unreachable scan
// log yields zeros and a null riskiest, and the dashboard fields stay
// editable.

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  oneLinerFromFlags,
  pickRiskiest,
  reportUrl,
  type AdminData,
} from "@/lib/admin-content";
import { EMPTY_FEED, getFeed } from "@/lib/scanlog";
import { scanToken } from "@/lib/scan";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let feed = EMPTY_FEED;
  try {
    feed = await getFeed();
  } catch {
    // Scan-log backend down — zeros are fine for a copy-drafting tool.
  }

  const recent = feed.recent;
  const scanned = recent.length;
  const honeypots = recent.filter((e) => e.honeypot).length;
  const flagged = recent.filter(
    (e) => e.band === "AVOID" || e.band === "CAUTION",
  ).length;

  const data: AdminData = {
    generatedAt: new Date().toISOString(),
    today: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    scanned,
    honeypots,
    flagged,
    flaggedPct: scanned > 0 ? Math.round((flagged / scanned) * 100) : 0,
    // The scan log retains a 24h window (see lib/scanlog.ts) — label it
    // honestly instead of implying weekly counters we don't keep.
    window: "24 hours",
    riskiest: null,
  };

  const candidate = pickRiskiest(recent);
  if (candidate) {
    const base = {
      chain: candidate.chain,
      address: candidate.address,
      name: candidate.name,
      symbol: candidate.symbol,
      score: candidate.score,
      band: candidate.band,
      url: reportUrl(candidate.chain, candidate.address),
    };
    try {
      const result = await scanToken(candidate.chain, candidate.address);
      const flagTexts = result.score.flags.map((f) => f.text);
      data.riskiest = {
        ...base,
        score: result.score.score,
        band: result.score.band,
        flagCount: flagTexts.length,
        flags: flagTexts,
        line:
          oneLinerFromFlags(flagTexts) ||
          "no red flags in the latest scan — verify before posting",
      };
    } catch {
      // Rescan failed — fall back to what the log entry already knows.
      data.riskiest = {
        ...base,
        flagCount: 0,
        flags: [],
        line:
          candidate.score !== null
            ? `scored ${candidate.score}/100 — see the full report for the breakdown`
            : "unscored — security data unavailable",
      };
    }
  }

  return NextResponse.json(data);
}
