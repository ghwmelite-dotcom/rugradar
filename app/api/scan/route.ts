// GET /api/scan?chain=<chain>&address=<address>
// Runs the full scan (providers -> normalize -> score) and returns JSON.
// Rate-limited: 30 scans/min per IP (design doc) — uses the Workers
// rate-limiting binding (SCAN_RATE_LIMITER, see wrangler.jsonc) in
// production, falling back to the in-memory token bucket in local dev.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChain, type Chain } from "@/lib/chains";
import { checkRateLimit } from "@/lib/ratelimit";
import { scanToken, type ScanResult } from "@/lib/scan";
import { recordScan } from "@/lib/scanlog";

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
  try {
    const env = getCloudflareContext().env as unknown as {
      SCAN_RATE_LIMITER?: RateLimitBinding;
    };
    if (env.SCAN_RATE_LIMITER) {
      const { success } = await env.SCAN_RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return NextResponse.json(
          { error: "Rate limit exceeded — max 30 scans per minute." },
          { status: 429 },
        );
      }
      return null;
    }
  } catch {
    // Not in a Cloudflare request context — fall through to in-memory.
  }

  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 30 scans per minute." },
      { status: 429 },
    );
  }
  return null;
}

// F3: record to the Wall of Shame feed without delaying the response —
// ctx.waitUntil on Workers, fire-and-forget elsewhere. recordScan never
// throws; the .catch is belt-and-braces.
function scheduleScanLog(chain: Chain, address: string, result: ScanResult) {
  const logged = recordScan(chain, address, result.report, result.score);
  try {
    getCloudflareContext().ctx.waitUntil(logged);
  } catch {
    void logged.catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? "";
  const address = searchParams.get("address") ?? "";

  // Public read-only data; ACAO:* lets the RugRadar browser extension (F6)
  // call this endpoint from dexscreener/pump.fun/axiom pages.
  const CORS = { "Access-Control-Allow-Origin": "*" } as const;

  if (!isChain(chain) || !address) {
    return NextResponse.json(
      { error: "Missing or invalid chain/address." },
      { status: 400, headers: CORS },
    );
  }

  const limited = await enforceRateLimit(clientIp(req));
  if (limited) return limited;

  try {
    const result = await scanToken(chain, address);
    scheduleScanLog(chain, address, result);
    return NextResponse.json(result, { headers: CORS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed." },
      { status: 500, headers: CORS },
    );
  }
}
