// Wall of Shame scan log (roadmap F3): a best-effort record of every
// completed scan, powering GET /api/feed and the /feed page.
//
// Storage keys (KV in prod, in-memory Map in dev — via lib/cache.ts):
//   scanlog:recent                list of ScanLogEntry, newest first
//                                 (capped at 100, 24h TTL)
//   scancount:<chain>:<addrLower> per-token scan counter (24h TTL)
//   feed:recent                   cached getFeed() aggregate (60s TTL)
//
// Best-effort contract: recordScan NEVER throws, and callers must not let it
// delay the scan response (ctx.waitUntil in the route, fire-and-forget
// elsewhere). A logging failure loses a feed row, never a scan.

import { getCache } from "./cache";
import type { Chain } from "./chains";
import type { Band, ScoreResult } from "./scoring";
import type { TokenReport } from "./types";

export interface ScanLogEntry {
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  score: number | null; // null when unscored (0/3 coverage)
  band: Band | null;
  honeypot: boolean; // honeypot override or confirmed honeypot signal
  scannedAt: string; // ISO timestamp
  // F5: deployer/creator address from the report. Optional because entries
  // logged before F5 lack it — readers must handle undefined.
  deployerAddress?: string | null;
}

export interface MostScannedEntry extends ScanLogEntry {
  count: number; // scans in the last 24h
}

export interface Feed {
  recent: ScanLogEntry[];
  honeypots: ScanLogEntry[];
  mostScanned: MostScannedEntry[];
}

export const EMPTY_FEED: Feed = { recent: [], honeypots: [], mostScanned: [] };

const RECENT_KEY = "scanlog:recent";
// Exported for lib/deployer.ts (F5), which reads the same recent window.
export const SCANLOG_RECENT_KEY = RECENT_KEY;
const FEED_KEY = "feed:recent";
const SCANLOG_TTL = 24 * 60 * 60; // 24h, per roadmap
const FEED_TTL = 60; // 60s aggregate cache
const MAX_RECENT = 100; // stored entries
const MAX_SECTION_ROWS = 20; // rows per feed section
const MAX_MOST_SCANNED = 10;

function countKey(chain: Chain, address: string): string {
  return `scancount:${chain}:${address.toLowerCase()}`;
}

// Append a scan to the log and bump its 24h counter. Never throws.
export async function recordScan(
  chain: Chain,
  address: string,
  report: TokenReport,
  score: ScoreResult,
): Promise<void> {
  try {
    const cache = getCache();
    const entry: ScanLogEntry = {
      chain,
      address,
      name: report.name,
      symbol: report.symbol,
      imageUrl: report.imageUrl,
      score: score.score,
      band: score.band,
      honeypot: score.honeypotOverride || report.honeypot === true,
      scannedAt: report.scannedAt,
      deployerAddress: report.deployerAddress ?? null,
    };

    const recent = (await cache.get<ScanLogEntry[]>(RECENT_KEY)) ?? [];
    recent.unshift(entry);
    await cache.set(RECENT_KEY, recent.slice(0, MAX_RECENT), SCANLOG_TTL);

    const count =
      ((await cache.get<number>(countKey(chain, address))) ?? 0) + 1;
    await cache.set(countKey(chain, address), count, SCANLOG_TTL);
    // Note: the feed:recent aggregate is intentionally not invalidated —
    // the CacheStore interface has no delete, and ≤60s staleness is fine
    // for a public feed.
  } catch {
    // Logging must never break a scan.
  }
}

// Build (or return the cached) feed aggregate. Throws only if the cache
// backend itself fails — callers should degrade to EMPTY_FEED.
export async function getFeed(): Promise<Feed> {
  const cache = getCache();
  const cached = await cache.get<Feed>(FEED_KEY);
  if (cached) return cached;

  const recent = (await cache.get<ScanLogEntry[]>(RECENT_KEY)) ?? [];

  // Wall of shame: confirmed honeypots plus anything scored AVOID.
  const honeypots = recent
    .filter((e) => e.honeypot || e.band === "AVOID")
    .slice(0, MAX_SECTION_ROWS);

  // Rank unique tokens in the recent window by their 24h scan counters.
  const byToken = new Map<string, ScanLogEntry>();
  for (const e of recent) {
    const key = `${e.chain}:${e.address.toLowerCase()}`;
    if (!byToken.has(key)) byToken.set(key, e);
  }
  const counted: MostScannedEntry[] = await Promise.all(
    [...byToken.values()].map(async (entry) => ({
      ...entry,
      count:
        (await cache.get<number>(countKey(entry.chain, entry.address))) ?? 0,
    })),
  );
  const mostScanned = counted
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_MOST_SCANNED);

  const feed: Feed = {
    recent: recent.slice(0, MAX_SECTION_ROWS),
    honeypots,
    mostScanned,
  };
  await cache.set(FEED_KEY, feed, FEED_TTL);
  return feed;
}
