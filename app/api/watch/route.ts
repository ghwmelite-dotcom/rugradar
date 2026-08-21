// POST /api/watch {chain,address}
// Adds a token to the Deathwatch watchlist (docs/DEATHWATCH.md), stamped
// with the current scan score/band/honeypot as flag metadata — that
// metadata (and its timestamp) is the receipt if the token later rugs.
// Public, rate-limited via the SCAN_RATE_LIMITER binding like /api/scan,
// keyed with a `watch:` prefix (in-memory token bucket fallback in dev).

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChain } from "@/lib/chains";
import { checkRateLimit } from "@/lib/ratelimit";
import { scanToken, type ScanResult } from "@/lib/scan";
import { addToWatchlist, type WatchEntry } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// Returns null if allowed, or a 429 response if the limit is hit.
async function enforceRateLimit(ip: string): Promise<NextResponse | null> {
  const key = `watch:${ip}`;
  try {
    const env = getCloudflareContext().env as unknown as {
      SCAN_RATE_LIMITER?: RateLimitBinding;
    };
    if (env.SCAN_RATE_LIMITER) {
      const { success } = await env.SCAN_RATE_LIMITER.limit({ key });
      if (!success) {
        return NextResponse.json(
          { error: "Rate limit exceeded — max 30 watch requests per minute." },
          { status: 429 },
        );
      }
      return null;
    }
  } catch {
    // Not in a Cloudflare request context — fall through to in-memory.
  }

  const rl = checkRateLimit(key);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 30 watch requests per minute." },
      { status: 429 },
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { chain, address } = (body ?? {}) as {
    chain?: unknown;
    address?: unknown;
  };
  if (
    typeof chain !== "string" ||
    !isChain(chain) ||
    typeof address !== "string" ||
    !address
  ) {
    return NextResponse.json(
      { error: "Missing or invalid chain/address." },
      { status: 400 },
    );
  }

  const limited = await enforceRateLimit(clientIp(req));
  if (limited) return limited;

  // Watching doesn't require a successful score — on scan failure the token
  // is still watched, with null score/band and a warning on the response.
  let scan: ScanResult | null = null;
  let warning: string | undefined;
  try {
    scan = await scanToken(chain, address);
  } catch (err) {
    warning = err instanceof Error ? err.message : "Scan failed.";
  }

  const entry: WatchEntry = {
    chain,
    address,
    symbol: scan?.report.symbol ?? null,
    name: scan?.report.name ?? null,
    addedAt: new Date().toISOString(),
    lastScore: scan?.score.score ?? null,
    lastBand: scan?.score.band ?? null,
    honeypot: scan
      ? scan.score.honeypotOverride || scan.report.honeypot === true
      : false,
  };
  await addToWatchlist(entry);

  return NextResponse.json({
    ok: true,
    watched: {
      chain,
      address,
      symbol: entry.symbol,
      score: entry.lastScore,
      band: entry.lastBand,
    },
    ...(warning
      ? { warning: `Scan failed (${warning}) — watching without a score.` }
      : {}),
  });
}
