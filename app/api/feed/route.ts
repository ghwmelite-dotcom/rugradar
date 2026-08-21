// GET /api/feed
// Wall of Shame aggregate (roadmap F3): recent scans, honeypots caught,
// most-scanned tokens. Served from the scan log (KV in prod, in-memory in
// dev); degraded to an empty feed if the log backend fails.

import { NextResponse } from "next/server";
import { EMPTY_FEED, getFeed } from "@/lib/scanlog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getFeed());
  } catch {
    return NextResponse.json(EMPTY_FEED);
  }
}
