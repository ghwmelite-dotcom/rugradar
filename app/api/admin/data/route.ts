// GET /api/admin/data
// Auth-gated aggregate powering the /admin content vault: scan-log feed
// counts, the verdict split, the riskiest token, and per-token insights for
// the Thread Studio. ScanLogEntry rows don't store flag text, so a bounded
// set of tokens (riskiest + top 4 most-scanned + top 4 wall-of-shame,
// deduped) is rescanned for real flags — that hits the normal provider
// cache (15min security TTL), so repeated loads are cheap. Everything
// degrades gracefully: an empty or unreachable scan log yields zeros, and
// a failed rescan yields an insight with no flags.

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  oneLinerFromFlags,
  pickRiskiest,
  reportUrl,
  type AdminData,
  type TokenInsight,
} from "@/lib/admin-content";
import { EMPTY_FEED, getFeed, type ScanLogEntry } from "@/lib/scanlog";
import { scanToken } from "@/lib/scan";

export const dynamic = "force-dynamic";

const MAX_LEADERBOARD = 4;
const MAX_WALL_OF_SHAME = 4;

// Build an insight from a log entry + a fresh (cached) scored scan. Never
// throws — a failed rescan returns the entry's own data with no flags.
async function toInsight(
  entry: ScanLogEntry,
  scanCount: number,
): Promise<TokenInsight> {
  const base: TokenInsight = {
    chain: entry.chain,
    address: entry.address,
    name: entry.name,
    symbol: entry.symbol,
    score: entry.score,
    band: entry.band,
    honeypot: entry.honeypot,
    scanCount,
    topFlag: null,
    flags: [],
    url: reportUrl(entry.chain, entry.address),
  };
  try {
    const result = await scanToken(entry.chain, entry.address);
    const flags = result.score.flags.map((f) => f.text);
    return {
      ...base,
      score: result.score.score,
      band: result.score.band,
      topFlag: flags[0] ?? null,
      flags,
    };
  } catch {
    return base;
  }
}

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
    bands: { AVOID: 0, CAUTION: 0, LOWER_RISK: 0, unscored: 0 },
    leaderboard: [],
    wallOfShame: [],
  };

  for (const e of recent) {
    if (e.band) data.bands[e.band] += 1;
    else data.bands.unscored += 1;
  }

  // Scan counters for wall-of-shame tokens (they may not be in mostScanned).
  const countByKey = new Map<string, number>(
    feed.mostScanned.map((e) => [
      `${e.chain}:${e.address.toLowerCase()}`,
      e.count,
    ]),
  );
  const countOf = (e: ScanLogEntry): number =>
    countByKey.get(`${e.chain}:${e.address.toLowerCase()}`) ?? 0;

  // Rescan the studio's token set in parallel; per-token failures degrade
  // to flag-less insights instead of failing the whole payload.
  const riskiestEntry = pickRiskiest(recent);
  const [leaderboard, wallOfShame] = await Promise.all([
    Promise.all(
      feed.mostScanned
        .slice(0, MAX_LEADERBOARD)
        .map((e) => toInsight(e, e.count)),
    ),
    Promise.all(
      feed.honeypots
        .slice(0, MAX_WALL_OF_SHAME)
        .map((e) => toInsight(e, countOf(e))),
    ),
  ]);
  data.leaderboard = leaderboard;
  data.wallOfShame = wallOfShame;

  if (riskiestEntry) {
    const insight = await toInsight(riskiestEntry, countOf(riskiestEntry));
    data.riskiest = {
      chain: insight.chain,
      address: insight.address,
      name: insight.name,
      symbol: insight.symbol,
      score: insight.score,
      band: insight.band,
      flagCount: insight.flags.length,
      flags: insight.flags,
      line:
        oneLinerFromFlags(insight.flags) ||
        (insight.score !== null
          ? `scored ${insight.score}/100 — see the full report for the breakdown`
          : "no red flags in the latest scan — verify before posting"),
      url: insight.url,
    };
  }

  return NextResponse.json(data);
}
