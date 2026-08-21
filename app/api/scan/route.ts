// GET /api/scan?chain=<chain>&address=<address>
// Runs the full scan (providers -> normalize -> score) and returns JSON.
// Rate-limited: 30 scans/min per IP (design doc) — uses the Workers
// rate-limiting binding (SCAN_RATE_LIMITER, see wrangler.jsonc) in
// production, falling back to the in-memory token bucket in local dev.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChain } from "@/lib/chains";
import { checkRateLimit } from "@/lib/ratelimit";
import { scanToken } from "@/lib/scan";

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? "";
  const address = searchParams.get("address") ?? "";

  if (!isChain(chain) || !address) {
    return NextResponse.json(
      { error: "Missing or invalid chain/address." },
      { status: 400 },
    );
  }

  const limited = await enforceRateLimit(clientIp(req));
  if (limited) return limited;

  try {
    const result = await scanToken(chain, address);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed." },
      { status: 500 },
    );
  }
}
